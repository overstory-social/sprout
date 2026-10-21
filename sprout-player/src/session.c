/* A world open on the device: shelving, loading the save, saving, closing; see session.h. */
#include <string.h>

#include "budgets.h"
#include "host/files.h"
#include "host/stack.h"
#include "newest.h"
#include "session_internal.h"
#include "text.h"
#include "world.h"

#define SAVES "saves"

static const char SAVE_FAILED[] = "The save could not be written. Is the device out of room?";

player_session *player_session_new(PlaydateAPI *pd) {
  player_session *session = (player_session *)player_alloc(pd, sizeof *session);
  if (session == NULL) return NULL;
  memset(session, 0, sizeof *session);
  session->pd = pd;
  player_host_init(&session->host, pd);
  sprout_arena_init(&session->answer, &session->host.record);
  return session;
}

/* Closes the cartridge being read, if one is. */
static void close_cartridge(player_session *session) {
  if (session->loading_file != NULL) player_file_close(session->pd, session->loading_file);
  session->loading_file = NULL;
}

/* The loader's source: the cartridge's next bytes, read from its file on the main stack. */
static bool read_cartridge(void *ctx, unsigned char *buffer, size_t bytes, size_t *got) {
  player_session *session = (player_session *)ctx;
  int n = player_file_read(session->pd, session->loading_file, buffer, bytes);
  if (n < 0) return false;
  *got = (size_t)n;
  return true;
}

/* A cartridge's file opened for a peek, apart from the one a load reads. */
typedef struct peeked_file {
  PlaydateAPI *pd;
  SDFile *file;
} peeked_file;

static bool read_peeked(void *ctx, unsigned char *buffer, size_t bytes, size_t *got) {
  peeked_file *p = (peeked_file *)ctx;
  int n = player_file_read(p->pd, p->file, buffer, bytes);
  if (n < 0) return false;
  *got = (size_t)n;
  return true;
}

/* Releases the world, its state and the log tail; the session is ready to open another. */
static void release_world(player_session *session) {
  session_save_abandon(session);
  session_drop_view(session);
  if (session->loading != NULL) sprout_load_abandon(session->loading);
  session->loading = NULL;
  close_cartridge(session);
  if (session->state != NULL) sprout_state_free(session->state);
  if (session->world != NULL) sprout_world_free(session->world);
  session->state = NULL;
  session->world = NULL;
  session->host.last_seconds = 0;
  session->host.ahead_seconds = 0;
  savelog_clear(session);
}

void player_session_free(player_session *session) {
  if (session == NULL) return;
  release_world(session);
  sprout_arena_reset(&session->answer);
  player_free(session->pd, session);
}

sprout_arena *session_answer(player_session *session) {
  sprout_arena_reset(&session->answer);
  return &session->answer;
}

const char *session_keep(player_session *session, const char *text) {
  const char *copy = sprout_arena_copy(&session->answer, text, strlen(text));
  return copy != NULL ? copy : "The player ran out of memory telling you that.";
}

/* A cartridge that cannot be shelved or opened, and why. */
static player_opening not_opened(player_session *session, const char *reason) {
  player_opening answer;
  memset(&answer, 0, sizeof answer);
  answer.reason = session_keep(session, reason);
  return answer;
}

/* ---- shelving ---- */

/* `saves/<hash><suffix>` into `out`, of `size` bytes. */
static void save_path(char *out, size_t size, const char *hash, const char *suffix) {
  text_buffer buffer;
  text_begin(&buffer, out, size);
  text_add(&buffer, SAVES "/");
  text_add(&buffer, hash);
  text_add(&buffer, suffix);
}

/* The name, the title, the hash and the save's paths of the world being opened, from its header. */
static void name_files(player_session *session, const sprout_cartridge_header *header) {
  text_buffer out;
  text_begin(&out, session->name, sizeof session->name);
  text_add(&out, header->name);
  text_begin(&out, session->title, sizeof session->title);
  if (header->title != NULL) text_add(&out, header->title);
  text_begin(&out, session->hash, sizeof session->hash);
  text_add(&out, header->hash);
  save_path(session->state_path, sizeof session->state_path, session->hash, ".json");
  save_path(session->log_path, sizeof session->log_path, session->hash, ".log");
}

/* The words of a load that failed, for the person holding the device. */
static void load_failed(sprout_status status, const sprout_refusal *refusal, text_buffer *out) {
  if (status == SPROUT_NO_MEMORY) text_add(out, "This world is too large for this device's memory.");
  else text_add(out, status == SPROUT_BAD_INPUT ? refusal->text : sprout_status_text(status));
}

/*
 * Peeks at the header and caps of the cartridge at `path`, read from its file only as far as its
 * preamble, and checks them against the app's static caps: cheap however large the world or its
 * pictures. On refusal `reason` says why. `peeked` (when given back) is the caller's to free.
 */
static bool peek(player_session *session, const char *path, sprout_world **peeked, char *reason, size_t size) {
  sprout_refusal refusal;
  sprout_status status;
  sprout_source source;
  peeked_file file;
  text_buffer out;
  text_begin(&out, reason, size);
  *peeked = NULL;
  file.pd = session->pd;
  file.file = player_file_open(session->pd, path);
  if (file.file == NULL) {
    text_add(&out, "The file ");
    text_add(&out, path);
    text_add(&out, " cannot be read.");
    return false;
  }
  source.ctx = &file;
  source.read = read_peeked;
  status = sprout_peek(&session->host.record, &source, peeked, &refusal);
  player_file_close(session->pd, file.file);
  if (status != SPROUT_OK) {
    load_failed(status, &refusal, &out);
    return false;
  }
  if (!player_caps_fit(*peeked, reason, size)) {
    sprout_world_free(*peeked);
    *peeked = NULL;
    return false;
  }
  return true;
}

player_opening player_inspect(player_session *session, const char *path) {
  player_opening answer;
  sprout_world *world = NULL;
  char reason[512];
  session_answer(session);
  if (!peek(session, path, &world, reason, sizeof reason)) {
    answer = not_opened(session, reason);
  } else {
    memset(&answer, 0, sizeof answer);
    answer.ok = true;
    answer.name = session_keep(session, world->header.name);
    answer.title = world->header.title == NULL ? NULL : session_keep(session, world->header.title);
    answer.hash = session_keep(session, world->header.hash);
    answer.author = session_keep(session, world->header.author);
    answer.version = session_keep(session, world->header.version);
  }
  if (world != NULL) sprout_world_free(world);
  return answer;
}

player_opening player_open(player_session *session, const char *path) {
  player_opening answer;
  sprout_world *peeked = NULL;
  sprout_refusal refusal;
  sprout_status status;
  sprout_source source;
  char reason[512];
  text_buffer out;
  session_answer(session);
  release_world(session);
  if (!peek(session, path, &peeked, reason, sizeof reason)) return not_opened(session, reason);
  name_files(session, &peeked->header);
  sprout_world_free(peeked);
  text_begin(&out, reason, sizeof reason);
  session->loading_file = player_file_open(session->pd, path);
  if (session->loading_file == NULL) {
    text_add(&out, "The file ");
    text_add(&out, path);
    text_add(&out, " cannot be read.");
    return not_opened(session, reason);
  }
  source.ctx = session;
  source.read = read_cartridge;
  status = sprout_load_begin(&session->host.record, &source, &session->loading, &refusal);
  if (status != SPROUT_OK) {
    load_failed(status, &refusal, &out);
    close_cartridge(session);
    return not_opened(session, reason);
  }
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.name = session->name;
  answer.title = session->title[0] == '\0' ? NULL : session->title;
  answer.hash = session->hash;
  return answer;
}

/*
 * How much of a world one step reads: bytes of its body inflated, from the pieces of the file the
 * loader reads as it needs them. The caverns' 2.7 MB body takes about 85 steps, which the app
 * spreads one a frame behind its loading line, each well inside what the system allows a frame on
 * the console.
 */
#define STEP_BYTES (32u * 1024u)

player_opening player_step(player_session *session) {
  player_opening answer;
  sprout_refusal refusal;
  sprout_status status;
  size_t read = 0, counted = 0;
  bool done = false;
  session_answer(session);
  if (session->loading == NULL) return not_opened(session, "No world is being opened.");
  status = sprout_load_step(session->loading, STEP_BYTES, &done, &refusal);
  if (status != SPROUT_OK) {
    char reason[512];
    text_buffer out;
    text_begin(&out, reason, sizeof reason);
    load_failed(status, &refusal, &out);
    session->loading = NULL;
    close_cartridge(session);
    return not_opened(session, reason);
  }
  sprout_load_progress(session->loading, &read, &counted);
  if (done) {
    session->world = sprout_load_finish(session->loading);
    session->loading = NULL;
    close_cartridge(session);
  }
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.done = done;
  answer.read = read;
  answer.counted = counted;
  if (done) {
    answer.name = session->name;
    answer.title = session->title[0] == '\0' ? NULL : session->title;
    answer.hash = session->hash;
    answer.word_count = session->world->word_count;
    answer.words = session->world->words;
  }
  return answer;
}

/* ---- the save ---- */

bool player_has_save(player_session *session, const char *hash) {
  char path[PATH_BYTES];
  save_path(path, sizeof path, hash, ".json");
  if (player_file_exists(session->pd, path)) return true;
  save_path(path, sizeof path, hash, ".json.tmp");
  return player_file_exists(session->pd, path);
}

const sprout_stored_visitor *session_visitor(const player_session *session) {
  sprout_str key = {PLAYER_VISIT, sizeof PLAYER_VISIT - 1};
  return session->state == NULL ? NULL : sprout_state_find_visitor(session->state, key);
}

bool session_visitor_present(const player_session *session, const sprout_stored_visitor *visitor) {
  const sprout_stored_instance *person = sprout_state_find(session->state, visitor->instance);
  return person != NULL && person->has_container;
}

/* `<path><suffix>` into `out`, of `size` bytes. */
static void path_with(char *out, size_t size, const char *path, const char *suffix) {
  text_buffer buffer;
  text_begin(&buffer, out, size);
  text_add(&buffer, path);
  text_add(&buffer, suffix);
}

/* A write failed: the slices under way are dropped, the state is owed still, and play stops. */
static bool save_failed(player_session *session) {
  session_writer *w = &session->writer;
  char part[PATH_BYTES + 8];
  if (w->file != NULL) player_file_close(session->pd, w->file);
  w->file = NULL;
  if (w->live) {
    path_with(part, sizeof part, session->state_path, ".part");
    player_file_remove(session->pd, part);
    sprout_arena_reset(&w->arena);
    session->owed = true;
  }
  w->live = false;
  session->unsaved = true;
  return false;
}

/* The state's bytes made and `<state>.part` opened: the write's first step, a frame of its own. */
static bool save_begin(player_session *session) {
  session_writer *w = &session->writer;
  char part[PATH_BYTES + 8];
  if (sprout_arena_init(&w->arena, &session->host.record) != SPROUT_OK) return save_failed(session);
  w->live = true;
  session->owed = false;
  session->waiting = false;
  session->save_began = player_host_seconds(&session->host);
  w->written = 0;
  if (sprout_state_write(session->state, &w->arena, &w->bytes, &w->length) != SPROUT_OK) return save_failed(session);
  path_with(part, sizeof part, session->state_path, ".part");
  w->file = player_file_create(session->pd, part);
  return w->file != NULL || save_failed(session);
}

/*
 * Up to `bytes` more of the state into `<state>.part`; once all are, the part becomes `<state>.tmp`
 * and then the save, so a save on disk is only ever replaced by a whole one, and a read finds the
 * `.tmp` in the moment between.
 */
static bool save_slice(player_session *session, size_t bytes) {
  session_writer *w = &session->writer;
  char part[PATH_BYTES + 8], temp[PATH_BYTES + 8];
  size_t count = w->length - w->written < bytes ? w->length - w->written : bytes;
  if (count > 0 && !player_file_append(session->pd, w->file, w->bytes + w->written, count)) return save_failed(session);
  w->written += count;
  if (w->written < w->length) return true;
  if (!player_file_close(session->pd, w->file)) {
    w->file = NULL;
    return save_failed(session);
  }
  w->file = NULL;
  path_with(part, sizeof part, session->state_path, ".part");
  path_with(temp, sizeof temp, session->state_path, ".tmp");
  if (!player_file_move(session->pd, part, temp) || !player_file_move(session->pd, temp, session->state_path))
    return save_failed(session);
  sprout_arena_reset(&w->arena);
  w->live = false;
  session->unsaved = false;
  return true;
}

/* A tick's save that has waited its time is owed now. */
static void save_if_waited(player_session *session) {
  if (session->waiting && player_host_seconds(&session->host) - session->save_began >= PLAYER_SAVE_WAIT_SECONDS) {
    session->waiting = false;
    session->owed = true;
  }
}

/* One step of the save: its beginning, or a slice of `bytes`. */
static bool save_step(player_session *session, size_t bytes) {
  if (session->writer.live) return save_slice(session, bytes);
  save_if_waited(session);
  if (session->owed && session->state != NULL) return save_begin(session);
  return true;
}

static void *mkdir_saves(void *pd) {
  ((PlaydateAPI *)pd)->file->mkdir(SAVES);
  return NULL;
}

/* The log tail written for the turns that changed the state. */
static void log_changed(player_session *session) {
  session->dirty = false;
  player_on_main_stack(mkdir_saves, session->pd);
  if (!savelog_write(session)) session->unsaved = true;
}

bool session_save_soon(player_session *session) {
  if (session->state != NULL && (session->dirty || session->waiting)) {
    if (session->dirty) log_changed(session);
    session->waiting = false;
    session->owed = true;
  }
  return !session->unsaved;
}

bool session_save_later(player_session *session) {
  if (session->state != NULL && session->dirty) {
    log_changed(session);
    session->waiting = !session->owed;
  }
  save_if_waited(session);
  return !session->unsaved;
}

bool session_save_finish(player_session *session) {
  while (session->writer.live || (session->owed && session->state != NULL))
    if (!save_step(session, (size_t)-1)) return false;
  return !session->unsaved;
}

bool session_save_settle(player_session *session) {
  session_save_soon(session);
  if (session->unsaved && session->state != NULL && !savelog_write(session)) return false;
  return session_save_finish(session);
}

void session_save_abandon(player_session *session) {
  session_writer *w = &session->writer;
  char part[PATH_BYTES + 8];
  if (w->file != NULL) player_file_close(session->pd, w->file);
  if (w->live) {
    path_with(part, sizeof part, session->state_path, ".part");
    player_file_remove(session->pd, part);
    sprout_arena_reset(&w->arena);
  }
  memset(w, 0, sizeof *w);
  session->dirty = false;
  session->owed = false;
  session->waiting = false;
  session->unsaved = false;
}

player_result player_save_step(player_session *session, size_t bytes) {
  player_result answer = {true, ""};
  if (!save_step(session, bytes) || session->unsaved) {
    answer.ok = false;
    answer.words = SAVE_FAILED;
  }
  return answer;
}

player_result player_save_settle(player_session *session) {
  player_result answer = {true, ""};
  if (!session_save_settle(session)) {
    answer.ok = false;
    answer.words = SAVE_FAILED;
  }
  return answer;
}

bool player_saving(const player_session *session) {
  return session->writer.live || session->owed || session->waiting || session->dirty;
}

player_result player_save(player_session *session) {
  player_result answer = {false, ""};
  session_answer(session);
  if (session->state == NULL) {
    answer.words = "No world is open.";
    return answer;
  }
  session->dirty = true;
  if (!session_save_settle(session)) {
    answer.words = SAVE_FAILED;
    return answer;
  }
  answer.ok = true;
  return answer;
}

typedef struct set_aside_call {
  PlaydateAPI *pd;
  const char *from, *to;
} set_aside_call;

static void *set_aside_direct(void *ctx) {
  set_aside_call *c = (set_aside_call *)ctx;
  c->pd->file->unlink(c->to, 0);
  c->pd->file->rename(c->from, c->to);
  return NULL;
}

/* A save that cannot be read is set aside, so the next opening starts the world again. */
static void set_aside(player_session *session) {
  char aside[PATH_BYTES + 16];
  text_buffer out;
  set_aside_call c = {session->pd, session->state_path, aside};
  text_begin(&out, aside, sizeof aside);
  text_add(&out, session->state_path);
  text_add(&out, ".damaged");
  player_on_main_stack(set_aside_direct, &c);
}

/* A new world's state, opened against the world. */
static bool empty_state(player_session *session) {
  if (sprout_state_empty(&session->host.record, session->world->header.name, &session->state) != SPROUT_OK) return false;
  if (sprout_state_open(session->state, session->world, NULL) == SPROUT_OK) return true;
  sprout_state_free(session->state);
  session->state = NULL;
  return false;
}

/* A new world's state, or false with the words for why there is no room for one. */
static bool new_world(player_session *session, text_buffer *out) {
  if (empty_state(session)) return true;
  if (out->length > 0) text_add(out, " ");
  text_add(out, "There is no room on this device for a new world.");
  return false;
}

/* The save `bytes` (released here) read and opened against the world; its state is let go where it will not open. */
static sprout_status read_state(player_session *session, char *bytes, size_t length, sprout_refusal *refusal) {
  sprout_status status = sprout_state_read(&session->host.record, bytes, length, &session->state, refusal);
  player_free(session->pd, bytes);
  if (status == SPROUT_OK) status = sprout_state_open(session->state, session->world, refusal);
  if (status != SPROUT_OK && session->state != NULL) sprout_state_free(session->state);
  if (status != SPROUT_OK) session->state = NULL;
  return status;
}

static const char TOO_LARGE[] = "This world's save is too large for this device's memory.";

/*
 * The world has no save of its own, and `earlier` names a build that has one: that save is read where
 * its version keeps it (the spec's State › Across versions), and otherwise the world starts anew. The
 * player is told either way, and the earlier save is never set aside or changed, so it can be read again.
 */
static bool open_earlier(player_session *session, const player_earlier *earlier, player_loaded *answer, text_buffer *out) {
  const char *version = session->world->header.version;
  char path[PATH_BYTES];
  char *bytes;
  size_t length = 0;
  sprout_refusal refusal;
  sprout_status status;
  if (!player_version_keeps_saves(player_text_of(earlier->version), player_text_of(version))) {
    text_add(out, "This world has changed too much since version ");
    text_add(out, earlier->version);
    text_add(out, " for your old save, so it starts again from the beginning. Your old save is kept.");
    answer->outgrown = true;
    return new_world(session, out);
  }
  save_path(path, sizeof path, earlier->hash, ".json");
  bytes = player_read_file(session->pd, path, &length);
  if (bytes == NULL) return new_world(session, out);
  status = read_state(session, bytes, length, &refusal);
  if (status == SPROUT_OK) {
    text_add(out, "This world is now version ");
    text_add(out, version);
    text_add(out, ", and your place in it carries over from version ");
    text_add(out, earlier->version);
    text_add(out, ".");
    answer->carried = true;
    answer->fresh = false;
    return true;
  }
  if (status == SPROUT_NO_MEMORY) {
    text_add(out, TOO_LARGE);
    return false;
  }
  text_add(out, "Your save from version ");
  text_add(out, earlier->version);
  text_add(out, " could not be opened in version ");
  text_add(out, version);
  text_add(out, ": ");
  text_add(out, status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
  text_add(out, " The world starts again from the beginning, and your old save is kept.");
  answer->outgrown = true;
  return new_world(session, out);
}

/*
 * The stored state for this world, or the earlier build's, or a new one when there is none or the
 * save cannot be read. False, with `words`, when no state can be made: the save is too big for the
 * device, which leaves it where it is, or there is no room for even a new one.
 */
static bool open_state(player_session *session, const player_earlier *earlier, player_loaded *answer, char *words, size_t size) {
  size_t length = 0;
  char *bytes = player_read_file(session->pd, session->state_path, &length);
  sprout_refusal refusal;
  sprout_status status;
  text_buffer out;
  text_begin(&out, words, size);
  answer->fresh = true;
  if (bytes == NULL && earlier != NULL) return open_earlier(session, earlier, answer, &out);
  if (bytes == NULL) return new_world(session, &out);
  status = read_state(session, bytes, length, &refusal);
  if (status == SPROUT_OK) {
    answer->fresh = false;
    return true;
  }
  if (status == SPROUT_NO_MEMORY) {
    text_add(&out, TOO_LARGE);
    return false;
  }
  text_add(&out, "The save for this world could not be read: ");
  text_add(&out, status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
  text_add(&out, " It has been set aside, and the world starts again.");
  set_aside(session);
  return new_world(session, &out);
}

/* A copy of `text` in the answer's arena, or NULL where there is no room. */
static const sprout_str *kept_str(player_session *session, sprout_str text) {
  sprout_str *copy = (sprout_str *)sprout_arena_take(&session->answer, sizeof *copy);
  if (copy == NULL) return NULL;
  copy->bytes = sprout_arena_copy(&session->answer, text.bytes, text.length);
  copy->length = text.length;
  return copy->bytes == NULL ? NULL : copy;
}

/* The nicknames of the visitors other than the device's who stand in the world, copied into the answer. */
static void others_present(player_session *session, player_loaded *answer) {
  sprout_str *present;
  size_t i, count = 0;
  for (i = 0; i < session->state->visitor_count; i++) {
    const sprout_stored_visitor *other = &session->state->visitors[i];
    if (!sprout_str_is(other->visit, PLAYER_VISIT) && session_visitor_present(session, other)) count++;
  }
  present = (sprout_str *)sprout_arena_take(&session->answer, (count + 1) * sizeof *present);
  if (present == NULL) return;
  answer->present = present;
  for (i = 0; i < session->state->visitor_count; i++) {
    const sprout_stored_visitor *other = &session->state->visitors[i];
    const sprout_str *nickname;
    if (sprout_str_is(other->visit, PLAYER_VISIT) || !session_visitor_present(session, other)) continue;
    nickname = kept_str(session, other->nickname);
    if (nickname == NULL) return;
    present[answer->present_count++] = *nickname;
  }
}

player_loaded player_load(player_session *session, const player_earlier *earlier) {
  player_loaded answer;
  const sprout_stored_visitor *visitor;
  char words[640];
  memset(&answer, 0, sizeof answer);
  answer.words = "";
  session_answer(session);
  if (session->world == NULL) {
    answer.words = "No world is open.";
    return answer;
  }
  session_save_settle(session);
  session_save_abandon(session);
  session_drop_view(session);
  if (session->state != NULL) {
    sprout_state_free(session->state);
    session->state = NULL;
  }
  savelog_clear(session);
  session->host.last_seconds = 0;
  session->host.ahead_seconds = 0;
  words[0] = '\0';
  if (!open_state(session, earlier, &answer, words, sizeof words)) {
    answer.fresh = answer.carried = answer.outgrown = false;
    answer.words = session_keep(session, words);
    return answer;
  }
  if (answer.carried) {
    char log_path[PATH_BYTES];
    save_path(log_path, sizeof log_path, earlier->hash, ".log");
    savelog_read(session, log_path, earlier->hash);
  } else {
    savelog_read(session, session->log_path, session->hash);
  }
  /* The save becomes this build's at its next write, the redeploy logged. */
  if (answer.carried || answer.outgrown) savelog_redeploy(session, answer.carried);
  visitor = session_visitor(session);
  if (visitor != NULL && session_visitor_present(session, visitor)) {
    /* The last session ended without leaving: the visitor leaves now, and nothing is narrated. */
    sprout_outcome outcome;
    if (turns_depart(session, &outcome)) sprout_outcome_free(&outcome);
    session_save_settle(session);
    answer.recovered = true;
    visitor = session_visitor(session);
  }
  answer.ok = true;
  answer.last = session->host.last_seconds;
  answer.words = session_keep(session, words);
  if (visitor != NULL) answer.nickname = kept_str(session, visitor->nickname);
  others_present(session, &answer);
  return answer;
}

/* Removes the file at `path` and the `.tmp` beside it that a write cut short may have left. */
static void remove_save_file(player_session *session, const char *path) {
  char temp[PATH_BYTES + 8];
  path_with(temp, sizeof temp, path, ".tmp");
  player_file_remove(session->pd, path);
  player_file_remove(session->pd, temp);
}

player_restart player_start_over(player_session *session) {
  player_restart answer;
  const sprout_stored_visitor *visitor;
  char part[PATH_BYTES + 8];
  memset(&answer, 0, sizeof answer);
  session_answer(session);
  if (session->world == NULL || session->state == NULL) {
    answer.reason = "No world is open.";
    return answer;
  }
  visitor = session_visitor(session);
  if (visitor != NULL) answer.nickname = kept_str(session, visitor->nickname);
  session_save_abandon(session);
  session_drop_view(session);
  sprout_state_free(session->state);
  session->state = NULL;
  session->host.last_seconds = 0;
  session->host.ahead_seconds = 0;
  savelog_clear(session);
  remove_save_file(session, session->state_path);
  remove_save_file(session, session->log_path);
  path_with(part, sizeof part, session->state_path, ".part");
  player_file_remove(session->pd, part);
  answer.ok = true;
  answer.name = session->name;
  answer.title = session->title[0] == '\0' ? NULL : session->title;
  answer.word_count = session->world->word_count;
  answer.words = session->world->words;
  return answer;
}

player_told player_close(player_session *session) {
  player_told answer;
  sprout_outcome outcome;
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.result = SPROUT_RESULT_DONE;
  answer.words = "";
  session_answer(session);
  if (session->state != NULL && turns_depart(session, &outcome)) {
    told_collect(&session->answer, &answer.lines, &outcome, PLAYER_VISIT);
    sprout_outcome_free(&outcome);
  }
  answer.saved = session_save_settle(session);
  release_world(session);
  return answer;
}
