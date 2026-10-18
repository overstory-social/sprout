/* The download screen; see downloads.h. */
#include "downloads.h"

#include <string.h>

#include "host/files.h"
#include "message.h"
#include "publickey.h"
#include "shipping.h"
#include "text.h"

#define FOLDER "worlds/"
#define CARTRIDGE ".sproutworld"
#define PART ".part"

static const char NO_MEMORY[] = "The player ran out of memory opening the download screen.";
static const char INDEX_TOO_BIG[] = "The list of worlds is larger than this app reads, so it was not used.";
static const char INDEX_NO_MEMORY[] = "The player ran out of memory taking in the list of worlds.";
static const char OUT_OF_ROOM[] = " Is the Playdate out of room?";

/* The key the build baked in (the generated publickey.h), which `player_index_signed_by` reads. */
static char trusted_key[] = PLAYER_INDEX_PUBLIC_KEY;

/* ---- words ---- */

static void put(char *out, size_t size, const char *const *parts, size_t count) {
  text_buffer said;
  size_t i;
  text_begin(&said, out, size);
  for (i = 0; i < count; i++) text_add(&said, parts[i]);
}

#define SAY(out, ...)                                                       \
  do {                                                                      \
    const char *const said_parts_[] = {__VA_ARGS__};                       \
    put((out), sizeof(out), said_parts_, sizeof said_parts_ / sizeof said_parts_[0]); \
  } while (0)

static void number(char *out, size_t size, uint64_t n) {
  text_buffer said;
  text_begin(&said, out, size);
  text_add_number(&said, n);
}

/* What a server's answer other than 200 means, for `what`. */
static void status_words(char *out, size_t size, int status, const char *what) {
  char code[16];
  number(code, sizeof code, (uint64_t)(status < 0 ? 0 : status));
  if (status == 404) {
    const char *const parts[] = {"There is no ", what, " at that address (the server answered 404)."};
    put(out, size, parts, 3);
  } else {
    const char *const parts[] = {"The server answered ", code, " for the ", what, "."};
    put(out, size, parts, 5);
  }
}

static const char *text_of(const sprout_json *world, const char *name) {
  const sprout_json *value = sprout_json_get(world, name);
  return value != NULL && value->kind == SPROUT_JSON_STRING ? value->bytes : "";
}

static size_t count_of(const sprout_json *world, const char *name) {
  const sprout_json *value = sprout_json_get(world, name);
  return value != NULL && value->kind == SPROUT_JSON_NUMBER ? (size_t)value->number : 0;
}

/* ---- the shelf's view of the list ---- */

static bool on_shelf(const player_app *app, const sprout_json *world) {
  return player_shelf_holds(app->shelf, text_of(world, "hash"));
}

void player_downloads_stem(const char *title, char *out, size_t size) {
  size_t n = 0, most = size > 25 ? 24 : (size > 0 ? size - 1 : 0);
  bool hyphen = false;
  for (; *title != '\0' && n < most; title++) {
    char c = *title;
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
      if (hyphen && n > 0 && n + 1 < most) out[n++] = '-';
      hyphen = false;
      out[n++] = c;
    } else {
      hyphen = true;
    }
  }
  if (size == 0) return;
  out[n] = '\0';
  if (n == 0) {
    text_buffer said;
    text_begin(&said, out, size);
    text_add(&said, "world");
  }
}

/* ---- the list of worlds ---- */

/* The index address: the Data folder's settings, else the built-in one. */
static void configure(player_app *app, player_downloads *d) {
  size_t length = 0;
  char *text = player_read_file(app->pd, PLAYER_DOWNLOADS_SETTINGS, &length);
  sprout_json *root = NULL;
  sprout_json_error error;
  const sprout_json *url;
  SAY(d->index_url, PLAYER_INDEX_URL);
  if (text == NULL) return;
  if (sprout_json_read(&d->arena, text, length, &root, &error) == SPROUT_OK && root->kind == SPROUT_JSON_OBJECT) {
    url = sprout_json_get(root, "indexUrl");
    if (url != NULL && url->kind == SPROUT_JSON_STRING && url->length > 0 && url->length < sizeof d->index_url)
      SAY(d->index_url, url->bytes);
  }
  player_free(app->pd, text);
  sprout_arena_reset(&d->arena);
}

static void drop_text(player_app *app, player_downloads *d) {
  player_free(app->pd, d->text);
  d->text = NULL;
  d->length = d->room = 0;
}

static void fail_index(player_app *app, player_downloads *d, const char *reason) {
  d->phase = DOWNLOADS_FAILED;
  SAY(d->failure, reason);
  drop_text(app, d);
  player_net_finish(app->pd);
}

static bool take_index(void *ctx, const char *bytes, size_t length) {
  player_downloads *d = (player_downloads *)ctx;
  PlaydateAPI *pd = d->app->pd;
  if (d->length + length > PLAYER_INDEX_MOST_BYTES) {
    d->too_big = true;
    return false;
  }
  if (d->length + length > d->room) {
    size_t room = d->room == 0 ? 8192 : d->room;
    char *grown;
    while (room < d->length + length) room *= 2;
    if (room > PLAYER_INDEX_MOST_BYTES) room = PLAYER_INDEX_MOST_BYTES;
    grown = (char *)pd->system->realloc(d->text, room);
    if (grown == NULL) {
      d->short_of_memory = true;
      return false;
    }
    d->text = grown;
    d->room = room;
  }
  memcpy(d->text + d->length, bytes, length);
  d->length += length;
  return true;
}

static void cleanup_world(player_app *app, player_downloads *d);

/* Stops whatever is running and leaves nothing half written. */
static void cancel(player_app *app, player_downloads *d) {
  if (d->fetching) player_fetch_cancel(&d->fetch);
  d->fetching = false;
  cleanup_world(app, d);
  drop_text(app, d);
}

/* Fetches the list afresh. */
static void open_index(player_app *app, player_downloads *d) {
  char why[PLAYER_NET_REASON_BYTES];
  cancel(app, d);
  sprout_arena_reset(&d->arena);
  d->worlds = NULL;
  d->selected = 0;
  d->words_made++;
  d->failure[0] = d->notice[0] = '\0';
  d->too_big = d->short_of_memory = false;
  if (!player_net_ready(app->pd, why, sizeof why)) {
    fail_index(app, d, why);
    return;
  }
  d->phase = DOWNLOADS_INDEX;
  if (!player_fetch_start(&d->fetch, app->pd, d->index_url, PLAYER_NETWORK_PURPOSE, take_index, d,
                          player_app_seconds(app))) {
    fail_index(app, d, d->fetch.reason);
    return;
  }
  d->fetching = true;
}

static void index_arrived(player_app *app, player_downloads *d, player_fetch_state state) {
  player_index read;
  char why[PLAYER_REASON_BYTES];
  if (state == PLAYER_FETCH_FAILED) {
    fail_index(app, d, d->fetch.reason);
    return;
  }
  if (d->fetch.status != 200) {
    status_words(why, sizeof why, d->fetch.status, "list of worlds");
    fail_index(app, d, why);
    return;
  }
  if (state == PLAYER_FETCH_STOPPED) {
    fail_index(app, d, d->too_big ? INDEX_TOO_BIG : INDEX_NO_MEMORY);
    return;
  }
  read = player_index_read(&d->arena, d->text != NULL ? d->text : "", d->length, d->trusts, d->trust_ctx);
  if (!read.ok) {
    fail_index(app, d, read.reason);
    return;
  }
  drop_text(app, d); /* the tree holds copies of its strings */
  d->worlds = read.worlds;
  d->words_made++;
  d->phase = DOWNLOADS_LIST;
}

/* ---- one world ---- */

static void cleanup_world(player_app *app, player_downloads *d) {
  if (d->world == NULL) return;
  if (d->file != NULL) player_file_close(app->pd, d->file);
  d->file = NULL;
  if (d->cartridge.part[0] != '\0') player_file_remove(app->pd, d->cartridge.part);
  d->world = NULL;
}

static void fail_world(player_app *app, player_downloads *d, const char *reason) {
  char said[sizeof d->failure];
  SAY(said, "Could not download ", d->world != NULL ? text_of(d->world, "title") : "that world", ". ", reason);
  if (d->fetching) player_fetch_cancel(&d->fetch);
  d->fetching = false;
  cleanup_world(app, d);
  d->phase = DOWNLOADS_LIST;
  SAY(d->failure, said);
  d->notice[0] = '\0';
  player_cue(app, PLAYER_CUE_REFUSED);
}

/* The cartridge of `world`, named for its title and the first eight digits of its bundle hash; false when the name will not fit. */
static bool plan(player_downloads *d, const sprout_json *world) {
  download_file *file = &d->cartridge;
  char stem[32], hash[9];
  text_buffer said;
  memset(file, 0, sizeof *file);
  d->world = world;
  player_downloads_stem(text_of(world, "title"), stem, sizeof stem);
  memcpy(hash, text_of(world, "hash"), 8);
  hash[8] = '\0';
  file->label = text_of(world, "title");
  file->url = text_of(world, "url");
  file->sha256 = text_of(world, "sha256");
  file->bytes = count_of(world, "bytes");
  text_begin(&said, file->final, sizeof file->final);
  text_add(&said, FOLDER);
  text_add(&said, stem);
  text_add(&said, "-");
  text_add(&said, hash);
  text_add(&said, CARTRIDGE);
  if (said.length + 1 >= sizeof file->final) return false;
  SAY(file->part, file->final, PART);
  return true;
}

static bool take_piece(void *ctx, const char *bytes, size_t length) {
  player_downloads *d = (player_downloads *)ctx;
  const download_file *file = &d->cartridge;
  if (d->written + length > file->bytes) {
    d->overrun = true;
    return false;
  }
  if (!player_file_append(d->app->pd, d->file, bytes, length)) {
    d->write_failed = true;
    return false;
  }
  d->written += length;
  return true;
}

/* Starts fetching the cartridge. */
static void start_file(player_app *app, player_downloads *d) {
  const download_file *file = &d->cartridge;
  char url[PLAYER_URL_BYTES], said[PLAYER_REASON_BYTES];
  d->written = 0;
  d->overrun = d->write_failed = false;
  d->file = player_file_create(app->pd, file->part);
  if (d->file == NULL) {
    SAY(said, "The file ", file->part, " could not be made.", OUT_OF_ROOM);
    fail_world(app, d, said);
    return;
  }
  if (!player_url_resolve(d->index_url, file->url, url, sizeof url)) {
    SAY(said, "The address of ", file->label, " is longer than this app reads.");
    fail_world(app, d, said);
    return;
  }
  if (!player_fetch_start(&d->fetch, app->pd, url, PLAYER_NETWORK_PURPOSE, take_piece, d,
                          player_app_seconds(app))) {
    fail_world(app, d, d->fetch.reason);
    return;
  }
  d->fetching = true;
}

static void finish_world(player_app *app, player_downloads *d);

static void file_arrived(player_app *app, player_downloads *d, player_fetch_state state) {
  const download_file *file = &d->cartridge;
  char said[PLAYER_REASON_BYTES], digest[65], got[24], listed[24];
  size_t length = 0;
  const char *why;
  if (!player_file_close(app->pd, d->file)) d->write_failed = true;
  d->file = NULL;
  /* The server's answer first: the body of a 404 page is no measure of the file. */
  if (state == PLAYER_FETCH_FAILED) {
    SAY(said, d->fetch.reason);
    fail_world(app, d, said);
    return;
  }
  if (d->fetch.status != 200) {
    status_words(said, sizeof said, d->fetch.status, file->label);
    fail_world(app, d, said);
    return;
  }
  if (d->overrun) {
    SAY(said, file->label, " is longer than the list says it is, so it was thrown away.");
    fail_world(app, d, said);
    return;
  }
  if (d->write_failed) {
    SAY(said, "The file ", file->part, " could not be written.", OUT_OF_ROOM);
    fail_world(app, d, said);
    return;
  }
  if (d->written != file->bytes) {
    number(got, sizeof got, d->written);
    number(listed, sizeof listed, file->bytes);
    SAY(said, file->label, " arrived as ", got, " bytes, and the list says ", listed, ".");
    fail_world(app, d, said);
    return;
  }
  why = player_digest(app->pd, file->part, digest, &length);
  if (why != NULL || length != file->bytes || strcmp(digest, file->sha256) != 0) {
    SAY(said, file->label, " does not match the checksum in the list, so it was thrown away.");
    fail_world(app, d, said);
    return;
  }
  finish_world(app, d);
}

/* The cartridge is here whole: the engine is asked about it, and it goes on the shelf. */
static void finish_world(player_app *app, player_downloads *d) {
  const download_file *cartridge = &d->cartridge;
  player_opening verdict = player_inspect(app->session, cartridge->part);
  const char *title = text_of(d->world, "title");
  char notice[sizeof d->notice];
  if (verdict.ok && (verdict.hash == NULL || strcmp(verdict.hash, text_of(d->world, "hash")) != 0)) {
    fail_world(app, d,
               "The cartridge that arrived is not the build the list describes (its bundle hash differs), so it was "
               "thrown away.");
    return;
  }
  if (verdict.ok)
    SAY(notice, title, " is on your shelf.");
  else
    SAY(notice, title, " is on your shelf, greyed: ", verdict.reason != NULL ? verdict.reason : "this app cannot play it.");
  if (!player_file_move(app->pd, cartridge->part, cartridge->final)) {
    fail_world(app, d, "The finished file could not be put on the shelf. Is the Playdate out of room?");
    return;
  }
  cleanup_world(app, d);
  d->phase = DOWNLOADS_LIST;
  d->failure[0] = '\0';
  SAY(d->notice, notice);
  player_shelf_list(app);
  d->words_made++; /* the world is on the shelf now, and greyed */
  player_cue(app, PLAYER_CUE_PICK);
}

/* Downloads the world selected, unless it is on the shelf already. */
static void choose(player_app *app, player_downloads *d) {
  const sprout_json *world;
  if (d->worlds == NULL || d->worlds->count == 0) {
    player_cue(app, PLAYER_CUE_REFUSED);
    return;
  }
  world = d->worlds->items[d->selected];
  d->failure[0] = d->notice[0] = '\0';
  if (on_shelf(app, world)) {
    SAY(d->notice, text_of(world, "title"), " is already on your shelf.");
    player_cue(app, PLAYER_CUE_REFUSED);
    return;
  }
  if (!plan(d, world)) {
    fail_world(app, d, "Its file would have a name too long for this app to store.");
    return;
  }
  player_cue(app, PLAYER_CUE_PICK);
  d->phase = DOWNLOADS_WORLD;
  start_file(app, d);
}

/* ---- the screen ---- */

void player_downloads_open(player_app *app) {
  player_downloads *d = (player_downloads *)player_alloc(app->pd, sizeof *d);
  if (d == NULL) {
    player_cue(app, PLAYER_CUE_REFUSED);
    player_message_show(app, NO_MEMORY);
    return;
  }
  memset(d, 0, sizeof *d);
  d->app = app;
  player_host_init(&d->host, app->pd);
  sprout_arena_init(&d->arena, &d->host.record);
  d->trusts = player_index_signed_by;
  d->trust_ctx = trusted_key;
  configure(app, d);
  wheel_hold_font(app);
  player_cue(app, PLAYER_CUE_PICK);
  open_index(app, d);
  player_app_show(app, &player_downloads_screen, d);
}

static bool busy(const player_downloads *d) { return d->phase == DOWNLOADS_INDEX || d->phase == DOWNLOADS_WORLD; }

static void back_to_shelf(player_app *app, player_downloads *d) {
  player_shelf_note_more(app->shelf, d->phase == DOWNLOADS_FAILED ? d->failure : NULL);
  player_shelf_show(app);
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_downloads *d = (player_downloads *)ctx;
  if (d->fetching) {
    player_fetch_state state = player_fetch_poll(&d->fetch, player_app_seconds(app));
    if (state != PLAYER_FETCH_RUNNING) {
      d->fetching = false;
      if (d->phase == DOWNLOADS_INDEX)
        index_arrived(app, d, state);
      else
        file_arrived(app, d, state);
    }
  }
  if (input->pushed & kButtonB) {
    back_to_shelf(app, d);
    return;
  }
  if (busy(d)) {
    /* The wheel stands still while a fetch runs, settling on the world chosen. */
    if (disc_update(&d->wheel.disc, false)) player_cue(app, PLAYER_CUE_CLACK);
    return;
  }
  if (wheel_steer(app, &d->wheel, d->worlds != NULL ? d->worlds->count : 0, &d->selected, input))
    d->failure[0] = d->notice[0] = '\0';
  if (input->pushed & kButtonA) {
    if (d->phase == DOWNLOADS_FAILED) {
      player_cue(app, PLAYER_CUE_PICK);
      open_index(app, d);
    } else {
      choose(app, d);
    }
  }
}

/* World `index` of the list as the wheel says it: its title, greyed where it is on the shelf already. */
static wheel_word world_word(const void *ctx, size_t index) {
  const player_downloads *d = (const player_downloads *)ctx;
  wheel_word word;
  word.text = text_of(d->worlds->items[index], "title");
  word.greyed = on_shelf(d->app, d->worlds->items[index]);
  return word;
}

/* The words under the list: what is happening, what went wrong, what happened, or what the selected world is. */
static void panel_words(const player_app *app, const player_downloads *d, char *out, size_t size) {
  char bytes[24], share[16];
  if (d->phase == DOWNLOADS_INDEX && d->fetch.asked != 0) {
    const char *const parts[] = {"Asking your permission to reach ", d->fetch.parts.server, "... B stops."};
    put(out, size, parts, 3);
  } else if (d->phase == DOWNLOADS_INDEX) {
    const char *const parts[] = {"Asking for the list of worlds... B stops."};
    put(out, size, parts, 1);
  } else if (d->phase == DOWNLOADS_WORLD) {
    const download_file *file = &d->cartridge;
    player_index_size(file->bytes, bytes, sizeof bytes);
    number(share, sizeof share, file->bytes > 0 ? (uint64_t)d->written * 100u / file->bytes : 0);
    {
      const char *const parts[] = {"Downloading ", text_of(d->world, "title"), " (", bytes, ")... ", share, "%. B stops."};
      put(out, size, parts, 7);
    }
  } else if (d->phase == DOWNLOADS_FAILED) {
    const char *const parts[] = {d->failure, " A tries again, B goes back."};
    put(out, size, parts, 2);
  } else if (d->failure[0] != '\0' || d->notice[0] != '\0') {
    const char *const parts[] = {d->failure[0] != '\0' ? d->failure : d->notice};
    put(out, size, parts, 1);
  } else if (d->worlds == NULL || d->worlds->count == 0) {
    const char *const parts[] = {"The list of worlds has none in it. B goes back to the shelf."};
    put(out, size, parts, 1);
  } else {
    const sprout_json *world = d->worlds->items[d->selected];
    player_index_size(count_of(world, "bytes"), bytes, sizeof bytes);
    {
      const char *const parts[] = {"by ", text_of(world, "author"), ", version ", text_of(world, "version"), ", ", bytes,
                                   on_shelf(app, world) ? ". It is on your shelf." : ". A downloads it."};
      put(out, size, parts, 7);
    }
  }
}

static void forget_panel(player_app *app, player_downloads *d) {
  wrap_free(app->pd, &d->panel);
  d->panel_said[0] = '\0';
}

static void draw(player_app *app, void *ctx) {
  player_downloads *d = (player_downloads *)ctx;
  const player_pen *pen = &app->pen;
  int frame_height = pen->frame_height, header = player_shelf_header(frame_height), panel = player_shelf_panel(frame_height), y;
  size_t i;
  char words[sizeof d->panel_said];
  player_pen_frame_say(pen, "More worlds", PLAYER_MARGIN, 0);
  app->pd->graphics->drawLine(0, header - 1, PLAYER_SCREEN_WIDTH, header - 1, 1, kColorBlack);
  if (d->worlds != NULL)
    wheel_draw(app, &d->wheel, d->worlds->count, d->selected, world_word, d, d->words_made, header, panel);
  app->pd->graphics->drawLine(0, panel, PLAYER_SCREEN_WIDTH, panel, 1, kColorBlack);
  panel_words(app, d, words, sizeof words);
  if (d->panel.bytes == NULL || strcmp(words, d->panel_said) != 0) {
    forget_panel(app, d);
    if (wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_frame_width, &app->pen,
                   &d->panel))
      SAY(d->panel_said, words);
    else
      d->panel.bytes = NULL;
  }
  if (d->panel.bytes != NULL) {
    const char *line = d->panel.bytes;
    y = panel + 2;
    for (i = 0; i < d->panel.line_count; i++, line = wrap_next(line), y += frame_height)
      player_pen_frame_say(pen, line, PLAYER_MARGIN, y);
  } else {
    player_pen_frame_say(pen, "The player ran out of memory.", PLAYER_MARGIN, panel + 2);
  }
}

/* The screen is left: what runs is stopped, the Wi-Fi may sleep, and the screen is freed. */
static void leave(player_app *app, void *ctx) {
  player_downloads *d = (player_downloads *)ctx;
  cancel(app, d);
  player_net_finish(app->pd);
  forget_panel(app, d);
  wheel_free(app, &d->wheel);
  sprout_arena_reset(&d->arena);
  player_free(app->pd, d);
}

/* The panel is wrapped afresh by the next draw. */
static void refit(player_app *app, void *ctx) { forget_panel(app, (player_downloads *)ctx); }

const player_screen player_downloads_screen = {update, draw, leave, refit};
