/* A world open on the device: shelving, loading the save, saving, closing; see session.h. */
#include <string.h>

#include "budgets.h"
#include "host/files.h"
#include "host/stack.h"
#include "session_internal.h"
#include "text.h"
#include "world.h"

#define SAVES "saves"

player_session *player_session_new(PlaydateAPI *pd) {
  player_session *session = (player_session *)player_alloc(pd, sizeof *session);
  if (session == NULL) return NULL;
  memset(session, 0, sizeof *session);
  session->pd = pd;
  player_host_init(&session->host, pd);
  sprout_arena_init(&session->answer, &session->host.record);
  return session;
}

/* Releases the world, its state and the log tail; the session is ready to open another. */
static void release_world(player_session *session) {
  session_drop_view(session);
  if (session->loading != NULL) sprout_load_abandon(session->loading);
  player_free(session->pd, session->loading_bytes);
  session->loading = NULL;
  session->loading_bytes = NULL;
  if (session->state != NULL) sprout_state_free(session->state);
  if (session->world != NULL) sprout_world_free(session->world);
  session->state = NULL;
  session->world = NULL;
  session->dirty = false;
  session->host.last_seconds = 0;
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

/* The title, the hash and the save's paths of the world being opened, from its header. */
static void name_files(player_session *session, const sprout_cartridge_header *header) {
  text_buffer out;
  text_begin(&out, session->title, sizeof session->title);
  text_add(&out, header->name);
  text_begin(&out, session->hash, sizeof session->hash);
  text_add(&out, header->hash);
  text_begin(&out, session->state_path, sizeof session->state_path);
  text_add(&out, SAVES "/");
  text_add(&out, session->hash);
  text_add(&out, ".json");
  text_begin(&out, session->log_path, sizeof session->log_path);
  text_add(&out, SAVES "/");
  text_add(&out, session->hash);
  text_add(&out, ".log");
}

/* The words of a load that failed, for the person holding the device. */
static void load_failed(sprout_status status, const sprout_refusal *refusal, text_buffer *out) {
  if (status == SPROUT_NO_MEMORY) text_add(out, "This world is too large for this device's memory.");
  else text_add(out, status == SPROUT_BAD_INPUT ? refusal->text : sprout_status_text(status));
}

/*
 * Reads the cartridge at `path` and peeks at its header and caps, checked against the app's
 * static caps: cheap however large the world. On refusal `reason` says why. The bytes are the
 * caller's to free, and `peeked` (when given back) likewise.
 */
static bool peek(player_session *session, const char *path, char **bytes, size_t *length, sprout_world **peeked,
                 char *reason, size_t size) {
  sprout_refusal refusal;
  sprout_status status;
  text_buffer out;
  text_begin(&out, reason, size);
  *peeked = NULL;
  *bytes = player_read_file(session->pd, path, length);
  if (*bytes == NULL) {
    text_add(&out, "The file ");
    text_add(&out, path);
    text_add(&out, " cannot be read.");
    return false;
  }
  status = sprout_peek(&session->host.record, *bytes, *length, peeked, &refusal);
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
  char *bytes = NULL;
  size_t length = 0;
  char reason[512];
  session_answer(session);
  if (!peek(session, path, &bytes, &length, &world, reason, sizeof reason)) {
    answer = not_opened(session, reason);
  } else {
    memset(&answer, 0, sizeof answer);
    answer.ok = true;
    answer.name = session_keep(session, world->header.name);
    answer.hash = session_keep(session, world->header.hash);
  }
  if (world != NULL) sprout_world_free(world);
  player_free(session->pd, bytes);
  return answer;
}

player_opening player_open(player_session *session, const char *path) {
  player_opening answer;
  sprout_world *peeked = NULL;
  sprout_refusal refusal;
  sprout_status status;
  char *bytes = NULL;
  size_t length = 0;
  char reason[512];
  session_answer(session);
  release_world(session);
  if (!peek(session, path, &bytes, &length, &peeked, reason, sizeof reason)) {
    player_free(session->pd, bytes);
    return not_opened(session, reason);
  }
  name_files(session, &peeked->header);
  sprout_world_free(peeked);
  status = sprout_load_begin(&session->host.record, bytes, length, &session->loading, &refusal);
  if (status != SPROUT_OK) {
    text_buffer out;
    text_begin(&out, reason, sizeof reason);
    load_failed(status, &refusal, &out);
    player_free(session->pd, bytes);
    return not_opened(session, reason);
  }
  session->loading_bytes = bytes;
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.name = session->title;
  answer.hash = session->hash;
  return answer;
}

/*
 * How much of a world one step reads: bytes of its body inflated. The caverns' 4.8 MB body takes
 * about 150 steps, which the app spreads one a frame behind its loading line, each well inside
 * what the system allows a frame on the console.
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
    player_free(session->pd, session->loading_bytes);
    session->loading_bytes = NULL;
    return not_opened(session, reason);
  }
  sprout_load_progress(session->loading, &read, &counted);
  if (done) {
    session->world = sprout_load_finish(session->loading);
    session->loading = NULL;
    player_free(session->pd, session->loading_bytes);
    session->loading_bytes = NULL;
  }
  memset(&answer, 0, sizeof answer);
  answer.ok = true;
  answer.done = done;
  answer.read = read;
  answer.counted = counted;
  if (done) {
    answer.name = session->title;
    answer.hash = session->hash;
    answer.word_count = session->world->word_count;
    answer.words = session->world->words;
  }
  return answer;
}

/* ---- the save ---- */

const sprout_stored_visitor *session_visitor(const player_session *session) {
  sprout_str key = {PLAYER_VISIT, sizeof PLAYER_VISIT - 1};
  return session->state == NULL ? NULL : sprout_state_find_visitor(session->state, key);
}

bool session_visitor_present(const player_session *session, const sprout_stored_visitor *visitor) {
  const sprout_stored_instance *person = sprout_state_find(session->state, visitor->instance);
  return person != NULL && person->has_container;
}

static void *mkdir_saves(void *pd) {
  ((PlaydateAPI *)pd)->file->mkdir(SAVES);
  return NULL;
}

bool session_save_if_dirty(player_session *session) {
  const char *bytes;
  size_t length;
  sprout_arena scratch;
  bool written;
  if (session->state == NULL || !session->dirty) return true;
  player_on_main_stack(mkdir_saves, session->pd);
  if (sprout_arena_init(&scratch, &session->host.record) != SPROUT_OK) return false;
  written = sprout_state_write(session->state, &scratch, &bytes, &length) == SPROUT_OK &&
            player_write_file(session->pd, session->state_path, bytes, length);
  sprout_arena_reset(&scratch);
  if (!written) return false;
  if (!savelog_write(session)) return false;
  session->dirty = false;
  return true;
}

player_result player_save(player_session *session) {
  player_result answer = {false, ""};
  session_answer(session);
  if (session->state == NULL) {
    answer.words = "No world is open.";
    return answer;
  }
  session->dirty = true;
  if (!session_save_if_dirty(session)) {
    answer.words = "The save could not be written. Is the device out of room?";
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
  if (sprout_state_open(session->state, session->world, NULL, NULL) == SPROUT_OK) return true;
  sprout_state_free(session->state);
  session->state = NULL;
  return false;
}

/*
 * The stored state for this world, or a new one when there is none or the save cannot be read.
 * False, with `words`, when no state can be made: the save is too big for the device, which
 * leaves it where it is, or there is no room for even a new one.
 */
static bool open_state(player_session *session, bool *fresh, char *words, size_t size) {
  size_t length = 0;
  char *bytes = player_read_file(session->pd, session->state_path, &length);
  sprout_refusal refusal;
  sprout_status status;
  text_buffer out;
  text_begin(&out, words, size);
  *fresh = true;
  if (bytes == NULL) {
    if (empty_state(session)) return true;
    text_add(&out, "There is no room on this device for a new world.");
    return false;
  }
  status = sprout_state_read(&session->host.record, bytes, length, &session->state, &refusal);
  player_free(session->pd, bytes);
  if (status == SPROUT_OK) status = sprout_state_open(session->state, session->world, NULL, &refusal);
  if (status == SPROUT_OK) {
    *fresh = false;
    return true;
  }
  if (session->state != NULL) sprout_state_free(session->state);
  session->state = NULL;
  if (status == SPROUT_NO_MEMORY) {
    text_add(&out, "This world's save is too large for this device's memory.");
    return false;
  }
  text_add(&out, "The save for this world could not be read: ");
  text_add(&out, status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
  text_add(&out, " It has been set aside, and the world starts again.");
  set_aside(session);
  if (empty_state(session)) return true;
  text_add(&out, " There is no room on this device for a new world.");
  return false;
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

player_loaded player_load(player_session *session) {
  player_loaded answer;
  const sprout_stored_visitor *visitor;
  bool fresh = true;
  char words[640];
  memset(&answer, 0, sizeof answer);
  answer.words = "";
  session_answer(session);
  if (session->world == NULL) {
    answer.words = "No world is open.";
    return answer;
  }
  session_drop_view(session);
  if (session->state != NULL) {
    sprout_state_free(session->state);
    session->state = NULL;
  }
  savelog_clear(session);
  session->host.last_seconds = 0;
  words[0] = '\0';
  if (!open_state(session, &fresh, words, sizeof words)) {
    answer.words = session_keep(session, words);
    return answer;
  }
  savelog_read(session);
  visitor = session_visitor(session);
  if (visitor != NULL && session_visitor_present(session, visitor)) {
    /* The last session ended without leaving: the visitor leaves now, and nothing is narrated. */
    sprout_outcome outcome;
    if (turns_depart(session, &outcome)) sprout_outcome_free(&outcome);
    session_save_if_dirty(session);
    answer.recovered = true;
    visitor = session_visitor(session);
  }
  answer.ok = true;
  answer.fresh = fresh;
  answer.last = session->host.last_seconds;
  answer.words = session_keep(session, words);
  if (visitor != NULL) answer.nickname = kept_str(session, visitor->nickname);
  others_present(session, &answer);
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
  answer.saved = session_save_if_dirty(session);
  release_world(session);
  return answer;
}
