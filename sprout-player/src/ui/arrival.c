/* Opening the first shipped world and arriving in it; see arrival.h. */
#include "arrival.h"

#include <string.h>

#include "host/files.h"
#include "reader.h"
#include "text.h"

#define CARTRIDGE ".sproutworld"

static const char NO_WORLD[] = "No world is shipped with this player.";
static const char NO_MEMORY[] = "The player ran out of memory bringing you into the world.";
static const char SAVE_FAILED[] =
    "The save could not be written, so play has stopped. Free some room on the console.";

typedef struct first_found {
  char name[PLAYER_PATH_BYTES];
} first_found;

static void consider(const char *name, void *ctx) {
  first_found *first = (first_found *)ctx;
  size_t n = strlen(name), suffix = sizeof CARTRIDGE - 1;
  if (n <= suffix || n >= sizeof first->name || strcmp(name + n - suffix, CARTRIDGE) != 0) return;
  if (first->name[0] == '\0' || strcmp(name, first->name) < 0) memcpy(first->name, name, n + 1);
}

bool player_first_world(PlaydateAPI *pd, const char *folder, char *path, size_t size) {
  first_found first;
  text_buffer out;
  first.name[0] = '\0';
  if (!player_list_files(pd, folder, consider, &first) || first.name[0] == '\0') return false;
  if (strlen(folder) + 1 + strlen(first.name) >= size) return false;
  text_begin(&out, path, size);
  text_add(&out, folder);
  text_add(&out, "/");
  text_add(&out, first.name);
  return true;
}

static bool is_letter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
static bool is_word(char c) { return is_letter(c) || (c >= '0' && c <= '9') || c == '\''; }

void player_world_title(const char *name, char *title, size_t size) {
  size_t i;
  bool in_word = false;
  if (size == 0) return;
  for (i = 0; name[i] != '\0' && i + 1 < size; i++) {
    char c = name[i] == '_' ? ' ' : name[i];
    if (!in_word && is_letter(c)) {
      if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
      in_word = true;
    } else if (in_word && !is_word(c)) {
      in_word = false;
    }
    title[i] = c;
  }
  title[i] = '\0';
}

player_arrival *player_arrival_new(player_app *app) {
  player_arrival *arrival = (player_arrival *)player_alloc(app->pd, sizeof *arrival);
  if (arrival == NULL) return NULL;
  memset(arrival, 0, sizeof *arrival);
  if (!player_first_world(app->pd, PLAYER_WORLDS_FOLDER, arrival->path, sizeof arrival->path)) arrival->path[0] = '\0';
  return arrival;
}

static bool stopped(const player_arrival *arrival) { return arrival->words.bytes != NULL; }

/* Stops with `words` on the screen. */
static void stop(player_app *app, player_arrival *arrival, const char *words) {
  if (stopped(arrival)) return;
  if (words == NULL || words[0] == '\0') words = "The world could not be opened.";
  arrival->words_held = wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN,
                                   player_pen_width, &app->pen, &arrival->words);
  if (!arrival->words_held) {
    /* No memory to wrap the words: the one line that needs none says what stopped it. */
    static char unwrapped[] = "The player ran out of memory.";
    arrival->words.bytes = unwrapped;
    arrival->words.line_count = 1;
  }
}

/* A copy of `text` from the device's allocator, or NULL. */
static char *copy_of(PlaydateAPI *pd, const char *text, size_t length) {
  char *copy = (char *)player_alloc(pd, length + 1);
  if (copy == NULL) return NULL;
  memcpy(copy, text, length);
  copy[length] = '\0';
  return copy;
}

/* The reader with the arrival told: who the visitor is, what the save had to say, what the arrival told, the status. */
static player_reader *tell_arrival(player_app *app, const player_arrival *arrival, const char *nickname, const char *notice,
                                   const told_list *lines) {
  player_reader *reader = player_reader_new(app);
  char said[256];
  text_buffer you;
  if (reader == NULL) return NULL;
  text_begin(&you, said, sizeof said);
  text_add(&you, "You are in ");
  text_add(&you, arrival->title);
  text_add(&you, " as ");
  text_add(&you, nickname);
  text_add(&you, ".");
  if (transcript_push(&reader->lines, "client", said, strlen(said)) &&
      (notice == NULL || transcript_push(&reader->lines, "notice", notice, strlen(notice))) &&
      transcript_tell(&reader->lines, lines) && player_reader_look(app, reader))
    return reader;
  player_reader_screen.leave(app, reader);
  return NULL;
}

/* The world is read: its save is loaded and the visitor admitted, and the reader takes over. */
static void arrive(player_app *app, player_arrival *arrival) {
  player_loaded loaded = player_load(app->session);
  player_told admitted;
  player_reader *reader;
  char *nickname, *notice = NULL;
  if (!loaded.ok) {
    stop(app, arrival, loaded.words);
    return;
  }
  nickname = loaded.nickname != NULL ? copy_of(app->pd, loaded.nickname->bytes, loaded.nickname->length)
                                     : copy_of(app->pd, PLAYER_FIXED_NICKNAME, strlen(PLAYER_FIXED_NICKNAME));
  if (loaded.words[0] != '\0') notice = copy_of(app->pd, loaded.words, strlen(loaded.words));
  if (nickname == NULL || (loaded.words[0] != '\0' && notice == NULL)) {
    stop(app, arrival, NO_MEMORY);
  } else {
    admitted = player_admit(app->session, nickname);
    if (!admitted.ok)
      stop(app, arrival, admitted.words);
    else if (!admitted.saved)
      stop(app, arrival, SAVE_FAILED);
    else if (!admitted.admitted)
      stop(app, arrival, admitted.words);
    else if ((reader = tell_arrival(app, arrival, nickname, notice, &admitted.lines)) == NULL)
      stop(app, arrival, NO_MEMORY);
    else
      player_app_show(app, &player_reader_screen, reader);
  }
  player_free(app->pd, nickname);
  player_free(app->pd, notice);
}

static void begin_opening(player_app *app, player_arrival *arrival) {
  player_opening opening;
  arrival->started = true;
  if (arrival->path[0] == '\0') {
    stop(app, arrival, NO_WORLD);
    return;
  }
  opening = player_open(app->session, arrival->path);
  if (!opening.ok) {
    stop(app, arrival, opening.reason);
    return;
  }
  player_world_title(opening.name, arrival->title, sizeof arrival->title);
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_arrival *arrival = (player_arrival *)ctx;
  player_opening step;
  (void)input;
  if (stopped(arrival)) return;
  if (!arrival->started) begin_opening(app, arrival);
  if (stopped(arrival)) return;
  step = player_step(app->session);
  if (!step.ok) {
    stop(app, arrival, step.reason);
    return;
  }
  arrival->read = step.read;
  arrival->counted = step.counted;
  if (step.done) arrive(app, arrival);
}

static void draw(player_app *app, void *ctx) {
  player_arrival *arrival = (player_arrival *)ctx;
  const player_pen *pen = &app->pen;
  if (stopped(arrival)) {
    const char *line = arrival->words.bytes;
    size_t i;
    int y = 40;
    for (i = 0; i < arrival->words.line_count; i++, line = wrap_next(line), y += pen->line_height)
      player_pen_say(pen, line, PLAYER_MARGIN, y);
  } else {
    char said[200];
    text_buffer loading;
    uint64_t share = arrival->counted > 0 ? (uint64_t)arrival->read * 100u / arrival->counted : 0;
    int width = PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN;
    text_begin(&loading, said, sizeof said);
    text_add(&loading, "Loading ");
    text_add(&loading, arrival->title);
    text_add(&loading, "... ");
    text_add_number(&loading, share);
    text_add(&loading, "%");
    player_pen_say(pen, said, PLAYER_MARGIN, 0);
    app->pd->graphics->drawLine(PLAYER_MARGIN, pen->line_height + 4, PLAYER_MARGIN + (int)(width * (int)share / 100),
                                pen->line_height + 4, 1, kColorBlack);
  }
}

static void leave(player_app *app, void *ctx) {
  player_arrival *arrival = (player_arrival *)ctx;
  if (arrival->words_held) player_free(app->pd, arrival->words.bytes);
  player_free(app->pd, arrival);
}

const player_screen player_arrival_screen = {update, draw, leave};
