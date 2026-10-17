/* The app; see app.h. */
#include "app.h"

#include <string.h>

#include "arrival.h"
#include "message.h"
#include "shelf.h"
#include "text.h"
#include "host/files.h"
#include "host/stack.h"

/* The system menu's callbacks, outside any frame: what was chosen waits for the next one, which runs on the own stack. */
static void leave_world_chosen(void *userdata) { ((player_app *)userdata)->leave_asked = true; }
static void start_over_chosen(void *userdata) { ((player_app *)userdata)->restart_asked = true; }
static void text_size_set(void *userdata) { ((player_app *)userdata)->text_asked = true; }

/* The notice when there is no memory to wrap one: one line in a block that is never freed. */
static char unwrapped_line[] = "The player ran out of memory.";
static const wrapped unwrapped = {unwrapped_line, 1, unwrapped_line, sizeof unwrapped_line - 1};

static void drop_notice(player_app *app) {
  if (app->notice.bytes == unwrapped_line)
    memset(&app->notice, 0, sizeof app->notice);
  else
    wrap_free(app->pd, &app->notice);
}

/* Puts `words` over the screen on show until A or B. */
static void tell_over(player_app *app, const char *words) {
  drop_notice(app);
  if (!wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen,
                  &app->notice))
    app->notice = unwrapped;
}

/* PLAYER_TEXT_KEPT and the system's `why`, over the screen. */
static void tell_kept(player_app *app, const char *why) {
  char words[256];
  text_buffer said;
  text_begin(&said, words, sizeof words);
  text_add(&said, PLAYER_TEXT_KEPT);
  text_add(&said, " ");
  text_add(&said, why);
  tell_over(app, words);
}

/* The pen takes the font of the size remembered; S where that one cannot be read, which the first frame tells. */
static bool load_pen(player_app *app, const char **why) {
  player_text_size remembered = player_text_size_read(app->pd);
  const char *kept = NULL;
  if (player_pen_init(&app->pen, app->pd, remembered, &kept)) return true;
  if (!player_pen_init(&app->pen, app->pd, PLAYER_TEXT_S, why)) return false;
  tell_kept(app, kept);
  return true;
}

player_app *player_app_new(PlaydateAPI *pd, const char **why) {
  player_app *app = (player_app *)player_alloc(pd, sizeof *app);
  if (app == NULL) {
    *why = "the player ran out of memory starting";
    return NULL;
  }
  memset(app, 0, sizeof *app);
  app->pd = pd;
  if (!load_pen(app, why)) {
    player_free(pd, app);
    return NULL;
  }
  player_sound_init(&app->sound, pd);
  player_clock_init(&app->clock);
  app->session = player_session_new(pd);
  app->shelf = app->session != NULL ? player_shelf_new(app) : NULL;
  if (app->shelf == NULL) {
    if (app->session != NULL) player_session_free(app->session);
    player_sound_free(&app->sound);
    drop_notice(app);
    player_pen_free(&app->pen);
    player_free(pd, app);
    *why = "the player ran out of memory starting";
    return NULL;
  }
  app->screen = &player_shelf_screen;
  app->ctx = app->shelf;
  app->leave_item = pd->system->addMenuItem("leave world", leave_world_chosen, app);
  app->restart_item = pd->system->addMenuItem("start over", start_over_chosen, app);
  /* The C API's titles parameter is not const, though the titles are only read. */
  app->text_item = pd->system->addOptionsMenuItem(PLAYER_TEXT_ITEM, (const char **)PLAYER_TEXT_SIZE_NAMES, PLAYER_TEXT_SIZES,
                                                  text_size_set, app);
  if (app->text_item != NULL) pd->system->setMenuItemValue(app->text_item, (int)app->pen.size);
  return app;
}

/* The screens are left and the visitor leaves; the departure is a turn, so it runs on the own stack. */
static void *close_thunk(void *ctx) {
  player_app *app = (player_app *)ctx;
  if (app->next != NULL) app->next->leave(app, app->next_ctx);
  app->screen->leave(app, app->ctx);
  player_close(app->session);
  return NULL;
}

void player_app_free(player_app *app) {
  if (app == NULL) return;
  if (app->leave_item != NULL) app->pd->system->removeMenuItem(app->leave_item);
  if (app->restart_item != NULL) app->pd->system->removeMenuItem(app->restart_item);
  if (app->text_item != NULL) app->pd->system->removeMenuItem(app->text_item);
  player_on_own_stack(app->pd, close_thunk, app);
  player_shelf_free(app, app->shelf);
  player_session_free(app->session);
  player_sound_free(&app->sound);
  drop_notice(app);
  player_pen_free(&app->pen);
  player_free(app->pd, app);
}

uint64_t player_app_seconds(const player_app *app) { return app->pd->system->getSecondsSinceEpoch(NULL); }

unsigned player_app_milliseconds(const player_app *app) { return app->pd->system->getCurrentTimeMilliseconds(); }

static void *settle_thunk(void *ctx) {
  player_save_settle(((player_app *)ctx)->session);
  return NULL;
}

/* The save owed is written whole, on the own stack, since its bytes are the runtime's to make; a failure is told by the next frame's step. */
static void settle(player_app *app) {
  if (player_saving(app->session)) player_on_own_stack(app->pd, settle_thunk, app);
}

void player_app_pause(player_app *app) { settle(app); }

void player_app_sleep(player_app *app) {
  settle(app);
  player_clock_sleep(&app->clock);
}

void player_app_wake(player_app *app) { player_clock_wake(&app->clock, player_app_seconds(app)); }

void player_cue(player_app *app, player_cue_name name) { player_sound_play(&app->sound, name); }

void player_app_show(player_app *app, const player_screen *screen, void *ctx) {
  if (app->next != NULL) app->next->leave(app, app->next_ctx);
  app->next = screen;
  app->next_ctx = ctx;
}

/* The visitor leaves the world for the shelf, as B on the nickname screen does. */
static void leave_world(player_app *app) {
  player_cue(app, PLAYER_CUE_BACK);
  if (player_close(app->session).saved)
    player_shelf_show(app);
  else
    player_shelf_unsaved(app);
}

/*
 * The world begun again: its save is gone and the nickname screen asks who the visitor is, the name
 * they had offered first. The world stays read, so no loading line comes between.
 */
static void start_over(player_app *app) {
  char title[128], remembered[64];
  player_restart restart = player_start_over(app->session);
  size_t length;
  if (!restart.ok) {
    player_message_show(app, restart.reason);
    player_close(app->session);
    return;
  }
  player_cue(app, PLAYER_CUE_PICK);
  player_world_title(restart.name, title, sizeof title);
  /* The name is the session's until its next call, which the load below is. */
  length = restart.nickname == NULL ? 0 : restart.nickname->length;
  if (length >= sizeof remembered) length = sizeof remembered - 1;
  if (length > 0) memcpy(remembered, restart.nickname->bytes, length);
  remembered[length] = '\0';
  player_arrival_pick(app, app->shelf->opened, title, restart.words, restart.word_count,
                      restart.nickname != NULL ? remembered : NULL);
}

/* The question whether to start over: A does, B goes back to the screen on show. */
static void ask_restart(player_app *app, const player_input *input) {
  if (input->pushed & kButtonA) {
    app->restart_question = false;
    start_over(app);
  } else if (input->pushed & kButtonB) {
    app->restart_question = false;
    player_cue(app, PLAYER_CUE_BACK);
  }
}

/*
 * The size the system menu was set to is applied: the pen's font changes, the choice is remembered
 * and the screen on show refits. A font that cannot be read leaves the pen as it was, puts the
 * menu back to its size and says so over the screen; a choice that could not be written is applied
 * and says so.
 */
static void resize_text(player_app *app) {
  player_text_size size;
  const char *why = NULL;
  if (app->text_item == NULL) return;
  size = (player_text_size)app->pd->system->getMenuItemValue(app->text_item);
  if (size == app->pen.size) return;
  if (!player_pen_resize(&app->pen, size, &why)) {
    app->pd->system->setMenuItemValue(app->text_item, (int)app->pen.size);
    tell_kept(app, why);
    return;
  }
  if (app->screen->refit != NULL) app->screen->refit(app, app->ctx);
  if (app->notice.bytes != NULL && app->notice.bytes != unwrapped_line)
    wrap_again(app->pd, &app->notice, PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen);
  if (!player_text_size_write(app->pd, size)) tell_over(app, PLAYER_TEXT_UNKEPT);
}

/* The notice over the screen: A or B takes it down. */
static void read_notice(player_app *app, const player_input *input) {
  if (input->pushed & (kButtonA | kButtonB)) {
    drop_notice(app);
    player_cue(app, PLAYER_CUE_BACK);
  }
}

static void draw_notice(player_app *app) {
  const player_pen *pen = &app->pen;
  const char *line = app->notice.bytes;
  size_t i;
  int y = MESSAGE_TOP;
  for (i = 0; i < app->notice.line_count; i++, line = wrap_next(line), y += pen->line_height)
    player_pen_say(pen, line, PLAYER_MARGIN, y);
  player_pen_say(pen, PLAYER_NOTICE_KEYS, PLAYER_MARGIN, PLAYER_SCREEN_HEIGHT - pen->line_height - 2);
}

static void draw_restart_question(player_app *app) {
  const player_pen *pen = &app->pen;
  player_pen_say(pen, PLAYER_RESTART_QUESTION, PLAYER_MARGIN, MESSAGE_TOP);
  player_pen_say(pen, PLAYER_RESTART_WARNING, PLAYER_MARGIN, MESSAGE_TOP + pen->line_height);
  player_pen_say(pen, PLAYER_RESTART_KEYS, PLAYER_MARGIN, PLAYER_SCREEN_HEIGHT - pen->line_height - 2);
}

void player_app_frame(player_app *app, const player_input *input) {
  if (app->text_asked) resize_text(app);
  app->text_asked = false;
  /* Input on any screen is the hands at work: a due tick waits for them to rest (clock.h). */
  if (input->held != 0 || input->pushed != 0 || input->crank != 0.0f)
    player_clock_touch(&app->clock, player_app_milliseconds(app));
  if (!player_save_step(app->session, PLAYER_SAVE_SLICE).ok) {
    app->restart_question = false;
    player_shelf_unsaved(app);
  } else if (app->leave_asked && app->reading) {
    app->restart_question = false;
    leave_world(app);
  } else if (app->restart_asked && app->reading) {
    app->restart_question = true;
  } else if (app->notice.bytes != NULL) {
    read_notice(app, input);
  } else if (app->restart_question) {
    ask_restart(app, input);
  } else {
    app->screen->update(app, app->ctx, input);
  }
  app->leave_asked = false;
  app->restart_asked = false;
  if (app->next != NULL) {
    app->screen->leave(app, app->ctx);
    app->screen = app->next;
    app->ctx = app->next_ctx;
    app->next = NULL;
    app->next_ctx = NULL;
  }
  app->pd->graphics->clear(kColorWhite);
  if (app->notice.bytes != NULL)
    draw_notice(app);
  else if (app->restart_question)
    draw_restart_question(app);
  else
    app->screen->draw(app, app->ctx);
}

typedef struct frame_call {
  player_app *app;
  const player_input *input;
} frame_call;

static void *frame_thunk(void *ctx) {
  frame_call *call = (frame_call *)ctx;
  player_app_frame(call->app, call->input);
  return NULL;
}

int player_app_update(void *userdata) {
  player_app *app = (player_app *)userdata;
  player_input input;
  PDButtons released;
  frame_call call;
  memset(&input, 0, sizeof input);
  app->pd->system->getButtonState(&input.held, &input.pushed, &released);
  input.crank = app->pd->system->isCrankDocked() ? 0.0f : app->pd->system->getCrankChange();
  call.app = app;
  call.input = &input;
  player_on_own_stack(app->pd, frame_thunk, &call);
  return 1;
}
