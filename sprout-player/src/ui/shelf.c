/* The shelf; see shelf.h. */
#include "shelf.h"

#include <string.h>

#include "arrival.h"
#include "downloads.h"
#include "host/files.h"
#include "message.h"
#include "newest.h"
#include "sound.h"
#include "text.h"

#define CARTRIDGE ".sproutworld"
#define MORE_ROW "more worlds..."

static const char OPENS[] = "A opens it.";
static const char MORE[] = "A looks for more worlds to download.";
static const char EMPTY[] = "No worlds are on the shelf. ";
static const char SAVE_FAILED[] =
    "The save could not be written, so play has stopped and nothing since the last save was kept. Free some room "
    "on the console. This world stays greyed until its save can be written.";

/* ---- titles ---- */

static void copy_text(char *out, size_t size, const char *text) {
  text_buffer buffer;
  text_begin(&buffer, out, size);
  text_add(&buffer, text);
}

static bool is_letter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
static bool is_word(char c) { return is_letter(c) || (c >= '0' && c <= '9') || c == '\''; }

void player_world_title(const char *name, const char *title, char *out, size_t size) {
  size_t i;
  bool in_word = false;
  if (size == 0) return;
  if (title != NULL && title[0] != '\0') {
    copy_text(out, size, title);
    return;
  }
  for (i = 0; name[i] != '\0' && i + 1 < size; i++) {
    char c = name[i] == '_' ? ' ' : name[i];
    if (!in_word && is_letter(c)) {
      if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
      in_word = true;
    } else if (in_word && !is_word(c)) {
      in_word = false;
    }
    out[i] = c;
  }
  out[i] = '\0';
}

/* ---- listing ---- */

/* The cartridge paths found in the folders listed, growing as they come. */
typedef struct found_paths {
  PlaydateAPI *pd;
  const char *folder; /* "" or "worlds/" */
  char (*paths)[PLAYER_PATH_BYTES];
  size_t count, room;
  bool short_of_memory;
} found_paths;

static void consider(const char *name, void *ctx) {
  found_paths *found = (found_paths *)ctx;
  size_t n = strlen(name), suffix = sizeof CARTRIDGE - 1, at = strlen(found->folder), i;
  char path[PLAYER_PATH_BYTES];
  if (n <= suffix || at + n >= sizeof path || strcmp(name + n - suffix, CARTRIDGE) != 0) return;
  memcpy(path, found->folder, at);
  memcpy(path + at, name, n + 1);
  for (i = 0; i < found->count; i++)
    if (strcmp(found->paths[i], path) == 0) return; /* in the app and in the Data folder both */
  if (found->count == found->room) {
    size_t room = found->room == 0 ? 8 : found->room * 2;
    char(*grown)[PLAYER_PATH_BYTES] = player_alloc(found->pd, room * sizeof *grown);
    if (grown == NULL) {
      found->short_of_memory = true;
      return;
    }
    if (found->count > 0) memcpy(grown, found->paths, found->count * sizeof *grown);
    player_free(found->pd, found->paths);
    found->paths = grown;
    found->room = room;
  }
  memcpy(found->paths[found->count++], path, strlen(path) + 1);
}

static int by_path(const shelf_entry *a, const shelf_entry *b) { return strcmp(a->path, b->path); }

/* The entry already found at `path`, listed or not, or NULL. */
static shelf_entry *entry_at(const player_shelf *shelf, const char *path) {
  size_t i;
  for (i = 0; i < shelf->held; i++)
    if (strcmp(shelf->entries[i].path, path) == 0) return &shelf->entries[i];
  return NULL;
}

/* A new entry for the cartridge at `path`, asked of the session. */
static void inspect(player_app *app, const char *path, shelf_entry *entry) {
  player_opening verdict = player_inspect(app->session, path);
  const char *base = strrchr(path, '/');
  char name[PLAYER_PATH_BYTES];
  const char *title = NULL;
  memset(entry, 0, sizeof *entry);
  copy_text(entry->path, sizeof entry->path, path);
  copy_text(name, sizeof name, base != NULL ? base + 1 : path);
  if (verdict.ok && verdict.name != NULL) {
    copy_text(name, sizeof name, verdict.name);
    title = verdict.title;
  } else {
    name[strlen(name) - (sizeof CARTRIDGE - 1)] = '\0';
  }
  player_world_title(name, title, entry->title, sizeof entry->title);
  entry->ok = verdict.ok;
  if (verdict.ok && verdict.hash != NULL) copy_text(entry->hash, sizeof entry->hash, verdict.hash);
  entry->ranked = verdict.ok && verdict.author != NULL && verdict.version != NULL &&
                  strlen(verdict.author) < sizeof entry->author && strlen(verdict.version) < sizeof entry->version;
  if (entry->ranked) {
    copy_text(entry->author, sizeof entry->author, verdict.author);
    copy_text(entry->version, sizeof entry->version, verdict.version);
  }
  if (!verdict.ok) copy_text(entry->reason, sizeof entry->reason, verdict.reason != NULL ? verdict.reason : "");
}

/* ---- the newest build of each world ---- */

static player_build build_at(void *ctx, size_t i) {
  const shelf_entry *entry = &((const shelf_entry *)ctx)[i];
  player_build build;
  build.title = player_text_of(entry->title);
  build.author = player_text_of(entry->ranked ? entry->author : NULL);
  build.version = player_text_of(entry->ranked ? entry->version : NULL);
  return build;
}

static void swap_builds(void *ctx, size_t i, size_t j) {
  shelf_entry *entries = (shelf_entry *)ctx, moving = entries[i];
  entries[i] = entries[j];
  entries[j] = moving;
}

/* Puts the newest build of each world first among the `count` entries, and returns how many worlds there are. */
static size_t keep_newest(shelf_entry *entries, size_t count) {
  player_builds list;
  list.ctx = entries;
  list.count = count;
  list.at = build_at;
  list.swap = swap_builds;
  return player_newest_builds(&list);
}

static void forget_panel(player_app *app, player_shelf *shelf) { wrap_free(app->pd, &shelf->panel); }

/* Lists the shelf again, inspecting only the cartridges it has not seen. */
static void list(player_app *app, player_shelf *shelf) {
  found_paths found;
  shelf_entry *entries;
  size_t i, j;
  memset(&found, 0, sizeof found);
  found.pd = app->pd;
  found.folder = "";
  player_list_files(app->pd, "/", consider, &found);
  found.folder = "worlds/";
  player_list_files(app->pd, "worlds", consider, &found);
  shelf->listed = true;
  shelf->words_made++;
  forget_panel(app, shelf);
  entries = found.count > 0 ? (shelf_entry *)player_alloc(app->pd, found.count * sizeof *entries) : NULL;
  if (found.count > 0 && entries == NULL) found.short_of_memory = true;
  for (i = 0; entries != NULL && i < found.count; i++) {
    const shelf_entry *seen = entry_at(shelf, found.paths[i]);
    if (seen != NULL)
      entries[i] = *seen;
    else
      inspect(app, found.paths[i], &entries[i]);
  }
  /* In path order, an insertion at a time: a shelf is a handful of worlds. */
  for (i = 1; entries != NULL && i < found.count; i++) {
    shelf_entry moving = entries[i];
    for (j = i; j > 0 && by_path(&entries[j - 1], &moving) > 0; j--) entries[j] = entries[j - 1];
    entries[j] = moving;
  }
  player_free(app->pd, found.paths);
  if (entries == NULL && found.short_of_memory) return; /* the shelf stays as it was */
  player_free(app->pd, shelf->entries);
  shelf->entries = entries;
  shelf->held = entries != NULL ? found.count : 0;
  shelf->count = keep_newest(entries, shelf->held);
  if (shelf->selected > shelf->count) shelf->selected = shelf->count;
}

/* ---- the shelf ---- */

player_shelf *player_shelf_new(player_app *app) {
  player_shelf *shelf = (player_shelf *)player_alloc(app->pd, sizeof *shelf);
  if (shelf != NULL) memset(shelf, 0, sizeof *shelf);
  return shelf;
}

void player_shelf_free(player_app *app, player_shelf *shelf) {
  if (shelf == NULL) return;
  forget_panel(app, shelf);
  wheel_free(app, &shelf->wheel);
  player_free(app->pd, shelf->entries);
  player_free(app->pd, shelf);
}

void player_shelf_show(player_app *app) {
  list(app, app->shelf);
  player_app_show(app, &player_shelf_screen, app->shelf);
}

void player_shelf_list(player_app *app) { list(app, app->shelf); }

bool player_shelf_holds(const player_shelf *shelf, const char *hash) {
  size_t i;
  for (i = 0; i < shelf->held; i++)
    if (shelf->entries[i].ok && strcmp(shelf->entries[i].hash, hash) == 0) return true;
  return false;
}

/* Whether `other` is a build of the world `entry` is a build of, and `entry` outranks it. */
static bool outranked_by(const shelf_entry *other, const shelf_entry *entry) {
  return other != entry && other->ranked && strcmp(other->hash, entry->hash) != 0 && strcmp(other->title, entry->title) == 0 &&
         strcmp(other->author, entry->author) == 0 &&
         player_version_order(player_text_of(other->version), player_text_of(entry->version)) <= 0;
}

const shelf_entry *player_shelf_earlier(player_app *app, const player_shelf *shelf, const shelf_entry *entry) {
  const shelf_entry *best = NULL;
  size_t i;
  if (!entry->ranked) return NULL;
  for (i = 0; i < shelf->held; i++) {
    const shelf_entry *other = &shelf->entries[i];
    int order;
    if (!outranked_by(other, entry) || !player_has_save(app->session, other->hash)) continue;
    order = best == NULL ? 1 : player_version_order(player_text_of(other->version), player_text_of(best->version));
    if (order > 0 || (order == 0 && by_path(other, best) < 0)) best = other;
  }
  return best;
}

void player_shelf_note_more(player_shelf *shelf, const char *failure) {
  copy_text(shelf->more_note, sizeof shelf->more_note, failure != NULL ? failure : "");
}

void player_shelf_refuse(player_shelf *shelf, const char *path, const char *reason) {
  shelf_entry *entry = entry_at(shelf, path);
  if (entry == NULL) return;
  entry->ok = false;
  entry->blocked = false;
  copy_text(entry->reason, sizeof entry->reason, reason);
  shelf->words_made++;
}

void player_shelf_block(player_shelf *shelf, const char *path, const char *reason) {
  shelf_entry *entry = entry_at(shelf, path);
  if (entry == NULL || !entry->ok) return;
  entry->blocked = true;
  copy_text(entry->reason, sizeof entry->reason, reason);
  shelf->words_made++;
}

void player_shelf_unblock(player_shelf *shelf, const char *path) {
  shelf_entry *entry = entry_at(shelf, path);
  if (entry == NULL || !entry->blocked) return;
  entry->blocked = false;
  entry->reason[0] = '\0';
  shelf->words_made++;
}

bool player_shelf_blocked(const player_shelf *shelf, const char *path) {
  const shelf_entry *entry = entry_at(shelf, path);
  return entry != NULL && entry->blocked;
}

void player_shelf_unsaved(player_app *app) {
  player_close(app->session);
  player_shelf_block(app->shelf, app->shelf->opened, SAVE_FAILED);
  player_message_show(app, SAVE_FAILED);
}

/* ---- the screen ---- */

int player_shelf_header(int frame_height) { return frame_height + 4; }
int player_shelf_panel(int frame_height) { return PLAYER_SCREEN_HEIGHT - (frame_height * 3 + 8); }

/* Whether the entry can be opened as it stands. */
static bool can_open(const shelf_entry *entry) { return entry->ok && !entry->blocked; }

static void choose(player_app *app, player_shelf *shelf) {
  const shelf_entry *entry;
  player_arrival *arrival;
  if (shelf->selected == shelf->count) {
    player_downloads_open(app);
    return;
  }
  entry = &shelf->entries[shelf->selected];
  if (!entry->ok) {
    player_cue(app, PLAYER_CUE_REFUSED);
    player_message_show(app, entry->reason);
    return;
  }
  arrival = player_arrival_new(app, entry->path, entry->title, player_shelf_earlier(app, shelf, entry));
  if (arrival == NULL) {
    player_cue(app, PLAYER_CUE_REFUSED);
    player_message_show(app, "The player ran out of memory opening the world.");
    return;
  }
  player_cue(app, PLAYER_CUE_PICK);
  copy_text(shelf->opened, sizeof shelf->opened, entry->path);
  player_app_show(app, &player_arrival_screen, arrival);
}

static void update(player_app *app, void *ctx, const player_input *input) {
  player_shelf *shelf = (player_shelf *)ctx;
  if (!shelf->listed) list(app, shelf);
  wheel_hold_font(app);
  if (wheel_steer(app, &shelf->wheel, shelf->count + 1, &shelf->selected, input)) forget_panel(app, shelf);
  if (input->pushed & kButtonA) choose(app, shelf);
}

/* The words under the rows for the row selected. */
static void panel_words(const player_shelf *shelf, char *out, size_t size) {
  text_buffer words;
  text_begin(&words, out, size);
  if (shelf->selected < shelf->count) {
    const shelf_entry *entry = &shelf->entries[shelf->selected];
    text_add(&words, can_open(entry) ? OPENS : entry->reason);
    if (entry->blocked) text_add(&words, " A tries again.");
    return;
  }
  if (shelf->more_note[0] != '\0') {
    text_add(&words, shelf->more_note);
    text_add(&words, " A tries again.");
    return;
  }
  if (shelf->count == 0) text_add(&words, EMPTY);
  text_add(&words, MORE);
}

/* Entry `index` of the shelf as the wheel says it: a world's title, or "more worlds..." last. */
static wheel_word shelf_word(const void *ctx, size_t index) {
  const player_shelf *shelf = (const player_shelf *)ctx;
  wheel_word word;
  word.text = index < shelf->count ? shelf->entries[index].title : MORE_ROW;
  word.greyed = index < shelf->count && !can_open(&shelf->entries[index]);
  return word;
}

static void draw(player_app *app, void *ctx) {
  player_shelf *shelf = (player_shelf *)ctx;
  const player_pen *pen = &app->pen;
  int frame_height = pen->frame_height, header = player_shelf_header(frame_height), panel = player_shelf_panel(frame_height), y;
  size_t i;
  player_pen_frame_say(pen, "Shelf", PLAYER_MARGIN, 0);
  app->pd->graphics->drawLine(0, header - 1, PLAYER_SCREEN_WIDTH, header - 1, 1, kColorBlack);
  wheel_draw(app, &shelf->wheel, shelf->count + 1, shelf->selected, shelf_word, shelf, shelf->words_made, header, panel);
  app->pd->graphics->drawLine(0, panel, PLAYER_SCREEN_WIDTH, panel, 1, kColorBlack);
  if (shelf->panel.bytes == NULL || shelf->panel_for != shelf->selected) {
    char words[PLAYER_REASON_BYTES + 256];
    forget_panel(app, shelf);
    panel_words(shelf, words, sizeof words);
    if (!wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_frame_width,
                    &app->pen, &shelf->panel))
      shelf->panel.bytes = NULL;
    shelf->panel_for = shelf->selected;
  }
  if (shelf->panel.bytes != NULL) {
    const char *line = shelf->panel.bytes;
    y = panel + 2;
    for (i = 0; i < shelf->panel.line_count; i++, line = wrap_next(line), y += frame_height) player_pen_frame_say(pen, line, PLAYER_MARGIN, y);
  } else {
    player_pen_frame_say(pen, "The player ran out of memory.", PLAYER_MARGIN, panel + 2);
  }
}

/* The app holds the shelf, so leaving its screen keeps it; the wheel's labels are made again when it is next drawn. */
static void leave(player_app *app, void *ctx) { wheel_free(app, &((player_shelf *)ctx)->wheel); }

/* The panel is wrapped afresh by the next draw. */
static void refit(player_app *app, void *ctx) { forget_panel(app, (player_shelf *)ctx); }

const player_screen player_shelf_screen = {update, draw, leave, refit};
