/* The nickname screen; see nickname.h. */
#include "nickname.h"

#include <string.h>

#include "arrival.h"
#include "host/files.h"
#include "message.h"
#include "shelf.h"
#include "text.h"

const char *const nickname_pool[NICKNAME_POOL_SIZE] = {
    "Alder",  "Aster",   "Birch",   "Bramble", "Briar",   "Clover", "Cricket", "Dapple",  "Ember",
    "Fennel", "Fern",    "Finch",   "Flint",   "Gorse",   "Hazel",  "Heron",   "Ivy",     "Juniper",
    "Kestrel", "Larch",  "Linnet",  "Lupin",   "Maple",   "Marten", "Moss",    "Nettle",  "Newt",
    "Olive",  "Otter",   "Pebble",  "Pippin",  "Plover",  "Quill",  "Reed",    "Robin",   "Rowan",
    "Sorrel", "Sparrow", "Tansy",   "Thistle", "Tern",    "Vetch",  "Willow",  "Wren",    "Yarrow",
};

static const char NO_NAME[] = "Every name this world allows is taken.";
static const char NO_MEMORY[] = "The player ran out of memory bringing you into the world.";
static const char REFUSED[] = "That name cannot be taken here; choose another.";
static const char KEYS[] = "Crank or up/down to choose, A to enter, B to go back";
static const char GO_ON[] = "A to go on";
static const char NO_NAME_FREE[] = "No name is free.";

/* The top of the name, as the Lua app draws it. */
#define NAME_TOP 100

static char lower(char c) { return c >= 'A' && c <= 'Z' ? (char)(c - 'A' + 'a') : c; }
static bool space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

/* Whether the `length` bytes at `text`, folded, are the one word `name`. */
static bool folds_to(const char *name, const char *text, size_t length) {
  size_t at = 0, i = 0;
  while (at < length && space(text[at])) at++;
  for (; name[i] != '\0'; i++, at++)
    if (at >= length || lower(text[at]) != lower(name[i])) return false;
  while (at < length && space(text[at])) at++;
  return at == length;
}

size_t nickname_without_words(const char **names, size_t count, const char *const *words, size_t word_count) {
  size_t kept = 0, i, w;
  for (i = 0; i < count; i++) {
    bool collides = false;
    for (w = 0; w < word_count && !collides; w++) {
      size_t length = strlen(names[i]), j;
      collides = strlen(words[w]) == length;
      for (j = 0; collides && j < length; j++) collides = lower(words[w][j]) == lower(names[i][j]);
    }
    if (!collides) names[kept++] = names[i];
  }
  return kept;
}

size_t nickname_without_present(const char **names, size_t count, const sprout_str *present, size_t present_count) {
  size_t kept = 0, i, p;
  for (i = 0; i < count; i++) {
    bool held = false;
    for (p = 0; p < present_count && !held; p++) held = folds_to(names[i], present[p].bytes, present[p].length);
    if (!held) names[kept++] = names[i];
  }
  return kept;
}

size_t nickname_preferred(const char *const *names, size_t count, const sprout_str *preferred) {
  size_t i;
  if (preferred == NULL) return 0;
  for (i = 0; i < count; i++)
    if (folds_to(names[i], preferred->bytes, preferred->length)) return i;
  return 0;
}

player_nickname *player_nickname_new(player_app *app, const char *title) {
  player_nickname *n = (player_nickname *)player_alloc(app->pd, sizeof *n);
  text_buffer copy;
  if (n == NULL) return NULL;
  memset(n, 0, sizeof *n);
  text_begin(&copy, n->title, sizeof n->title);
  text_add(&copy, title);
  memcpy(n->names, nickname_pool, sizeof n->names);
  n->count = NICKNAME_POOL_SIZE;
  return n;
}

/* Stops with `words` on the message screen, and the world is closed. */
static void stop(player_app *app, const char *words) {
  player_message_show(app, words);
  player_close(app->session);
}

/* Moves a name on (`forward`) or back, round the names, with a tick. */
static void move(player_app *app, player_nickname *n, bool forward) {
  if (n->count == 0) return;
  n->selected = (n->selected + (forward ? 1 : n->count - 1)) % n->count;
  player_cue(app, PLAYER_CUE_TICK);
}

/* The engine refused the name: its words are shown over the screen until A or B. */
static void refuse(player_app *app, player_nickname *n, const char *words) {
  if (words == NULL || words[0] == '\0') words = REFUSED;
  player_cue(app, PLAYER_CUE_REFUSED);
  if (!wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen,
                  &n->refused)) {
    n->refused.bytes = NULL;
    n->refused.line_count = 0;
    stop(app, words);
  }
}

/* Asks the session to admit the name chosen. */
static void admit(player_app *app, player_nickname *n) {
  const char *name;
  player_told admitted;
  if (n->count == 0) {
    player_cue(app, PLAYER_CUE_REFUSED);
    stop(app, NO_NAME);
    return;
  }
  name = n->names[n->selected];
  admitted = player_admit(app->session, name);
  if (!admitted.ok) {
    stop(app, admitted.words);
  } else if (!admitted.saved) {
    player_shelf_unsaved(app);
  } else if (!admitted.admitted) {
    refuse(app, n, admitted.words);
  } else {
    player_cue(app, PLAYER_CUE_PICK);
    if (!player_arrival_tell(app, n->title, name, n->notice, &admitted.lines)) stop(app, NO_MEMORY);
  }
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_nickname *n = (player_nickname *)ctx;
  if (n->refused.line_count > 0) {
    if (input->pushed & (kButtonA | kButtonB)) {
      player_free(app->pd, n->refused.bytes);
      n->refused.bytes = NULL;
      n->refused.line_count = 0;
    }
    return;
  }
  n->crank += input->crank;
  while (n->crank >= NICKNAME_DEGREES_PER_STEP) {
    n->crank -= NICKNAME_DEGREES_PER_STEP;
    move(app, n, true);
  }
  while (n->crank <= -NICKNAME_DEGREES_PER_STEP) {
    n->crank += NICKNAME_DEGREES_PER_STEP;
    move(app, n, false);
  }
  if (input->pushed & kButtonDown) move(app, n, true);
  if (input->pushed & kButtonUp) move(app, n, false);
  if (input->pushed & kButtonA) {
    admit(app, n);
  } else if (input->pushed & kButtonB) {
    player_cue(app, PLAYER_CUE_BACK);
    if (player_close(app->session).saved)
      player_shelf_show(app);
    else
      player_shelf_unsaved(app);
  }
}

static void draw(player_app *app, void *ctx) {
  player_nickname *n = (player_nickname *)ctx;
  const player_pen *pen = &app->pen;
  int bottom = PLAYER_SCREEN_HEIGHT - pen->line_height - 2;
  if (n->refused.line_count > 0) {
    const char *line = n->refused.bytes;
    size_t i;
    int y = MESSAGE_TOP;
    for (i = 0; i < n->refused.line_count; i++, line = wrap_next(line), y += pen->line_height)
      player_pen_say(pen, line, PLAYER_MARGIN, y);
    player_pen_say(pen, GO_ON, PLAYER_MARGIN, bottom);
    return;
  }
  {
    char said[200];
    text_buffer who;
    text_begin(&who, said, sizeof said);
    text_add(&who, "Who are you in ");
    text_add(&who, n->title);
    text_add(&who, "?");
    player_pen_say(pen, said, PLAYER_MARGIN, 0);
    app->pd->graphics->drawLine(0, pen->line_height + 3, PLAYER_SCREEN_WIDTH, pen->line_height + 3, 1, kColorBlack);
    if (n->count == 0) {
      player_pen_say(pen, NO_NAME_FREE, PLAYER_MARGIN, NAME_TOP);
    } else {
      text_begin(&who, said, sizeof said);
      text_add(&who, "< ");
      text_add(&who, n->names[n->selected]);
      text_add(&who, " >");
      player_pen_say(pen, said, PLAYER_MARGIN, NAME_TOP);
    }
    player_pen_say(pen, KEYS, PLAYER_MARGIN, bottom);
  }
}

static void leave(player_app *app, void *ctx) {
  player_nickname *n = (player_nickname *)ctx;
  player_free(app->pd, n->refused.bytes);
  player_free(app->pd, n->notice);
  player_free(app->pd, n);
}

const player_screen player_nickname_screen = {update, draw, leave};
