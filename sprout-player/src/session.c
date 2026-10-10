/* A world open on the device: shelving, loading the save, saving, closing; see session.h. */
#include <string.h>

#include "budgets.h"
#include "files.h"
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
  return session;
}

/* Releases the world, its state and the log tail; the session is ready to open another. */
static void release_world(player_session *session) {
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
  player_free(session->pd, session->reply);
  player_free(session->pd, session);
}

bool session_reply_begin(player_session *session, sprout_arena *arena, jb *builder) {
  memset(arena, 0, sizeof *arena);
  jb_begin(builder, arena);
  if (sprout_arena_init(arena, &session->host.record) == SPROUT_OK) return true;
  builder->ok = false;
  return false;
}

const char *session_reply_end(player_session *session, sprout_arena *arena, jb *builder, const sprout_json *root) {
  static const char FAILED[] = "{\"ok\":false,\"admitted\":false,\"committed\":false,\"ran\":false,"
                               "\"words\":\"The player ran out of memory telling you that.\",\"reason\":"
                               "\"The player ran out of memory telling you that.\",\"lines\":[]}";
  bool written = jb_finish(builder, session->pd, root, &session->reply);
  sprout_arena_reset(arena);
  return written ? session->reply : FAILED;
}

/* A reply that is an object of text members: { ok: false, reason: "..." } and the like. */
static const char *refuse(player_session *session, const char *flag, const char *key, const char *words) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 3);
  jb_set(&builder, root, flag, jb_bool(&builder, false));
  jb_set(&builder, root, key, jb_string(&builder, words));
  return session_reply_end(session, &arena, &builder, root);
}

/* ---- shelving ---- */

/* The title, the hash and the save's paths of the world just loaded. */
static void name_files(player_session *session) {
  text_buffer out;
  text_begin(&out, session->title, sizeof session->title);
  text_add(&out, session->world->header.name);
  text_begin(&out, session->hash, sizeof session->hash);
  text_add(&out, session->world->header.hash);
  text_begin(&out, session->state_path, sizeof session->state_path);
  text_add(&out, SAVES "/");
  text_add(&out, session->hash);
  text_add(&out, ".json");
  text_begin(&out, session->log_path, sizeof session->log_path);
  text_add(&out, SAVES "/");
  text_add(&out, session->hash);
  text_add(&out, ".log");
}

/*
 * Reads and loads the cartridge at `path` and checks it against the app's static caps. On
 * refusal `reason` says why, in words for the person holding the device.
 */
static bool shelve(player_session *session, const char *path, sprout_world **world, char *reason, size_t size) {
  size_t length = 0;
  char *bytes = player_read_file(session->pd, path, &length);
  sprout_refusal refusal;
  sprout_status status;
  text_buffer out;
  text_begin(&out, reason, size);
  if (bytes == NULL) {
    text_add(&out, "The file ");
    text_add(&out, path);
    text_add(&out, " cannot be read.");
    return false;
  }
  status = sprout_load_explained(&session->host.record, bytes, length, world, &refusal);
  player_free(session->pd, bytes);
  if (status == SPROUT_NO_MEMORY) {
    text_add(&out, "This world is too large for this device's memory.");
    return false;
  }
  if (status != SPROUT_OK) {
    text_add(&out, status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
    return false;
  }
  if (!player_caps_fit(*world, reason, size)) {
    sprout_world_free(*world);
    *world = NULL;
    return false;
  }
  return true;
}

const char *player_inspect(player_session *session, const char *path) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  sprout_world *world = NULL;
  char reason[512];
  const char *reply;
  bool fits;
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  fits = shelve(session, path, &world, reason, sizeof reason);
  root = jb_object(&builder, 3);
  jb_set(&builder, root, "ok", jb_bool(&builder, fits));
  jb_set(&builder, root, "name", fits ? jb_string(&builder, world->header.name) : jb_null(&builder));
  jb_set(&builder, root, "reason", fits ? jb_null(&builder) : jb_string(&builder, reason));
  reply = session_reply_end(session, &arena, &builder, root);
  if (world != NULL) sprout_world_free(world);
  return reply;
}

const char *player_open(player_session *session, const char *path) {
  sprout_arena arena;
  jb builder;
  sprout_json *root, *words;
  sprout_world *world = NULL;
  char reason[512];
  size_t i;
  release_world(session);
  if (!shelve(session, path, &world, reason, sizeof reason)) return refuse(session, "ok", "reason", reason);
  session->world = world;
  name_files(session);
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 5);
  words = jb_array(&builder, world->word_count);
  for (i = 0; i < world->word_count; i++) jb_set(&builder, words, NULL, jb_string(&builder, world->words[i]));
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  jb_set(&builder, root, "name", jb_string(&builder, session->title));
  jb_set(&builder, root, "hash", jb_string(&builder, session->hash));
  jb_set(&builder, root, "words", words);
  return session_reply_end(session, &arena, &builder, root);
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

bool session_save_if_dirty(player_session *session) {
  const char *bytes;
  size_t length;
  if (session->state == NULL || !session->dirty) return true;
  session->pd->file->mkdir(SAVES);
  if (sprout_state_write(session->state, &bytes, &length) != SPROUT_OK) return false;
  if (!player_write_file(session->pd, session->state_path, bytes, length)) return false;
  if (!savelog_write(session)) return false;
  session->dirty = false;
  return true;
}

const char *player_save(player_session *session) {
  bool saved;
  if (session->state == NULL) return refuse(session, "ok", "words", "No world is open.");
  session->dirty = true;
  saved = session_save_if_dirty(session);
  if (!saved) return refuse(session, "ok", "words", "The save could not be written. Is the device out of room?");
  {
    sprout_arena arena;
    jb builder;
    sprout_json *root;
    if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
    root = jb_object(&builder, 2);
    jb_set(&builder, root, "ok", jb_bool(&builder, true));
    jb_set(&builder, root, "words", jb_string(&builder, ""));
    return session_reply_end(session, &arena, &builder, root);
  }
}

/* A save that cannot be read is set aside, so the next opening starts the world again. */
static void set_aside(player_session *session) {
  char aside[PATH_BYTES + 16];
  text_buffer out;
  text_begin(&out, aside, sizeof aside);
  text_add(&out, session->state_path);
  text_add(&out, ".damaged");
  session->pd->file->unlink(aside, 0);
  session->pd->file->rename(session->state_path, aside);
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

const char *player_load(player_session *session) {
  sprout_arena arena;
  jb builder;
  sprout_json *root, *present;
  const sprout_stored_visitor *visitor;
  bool fresh = true, recovered = false;
  char words[640];
  size_t i, others = 0;
  if (session->world == NULL) return refuse(session, "ok", "words", "No world is open.");
  if (session->state != NULL) {
    sprout_state_free(session->state);
    session->state = NULL;
  }
  savelog_clear(session);
  session->host.last_seconds = 0;
  words[0] = '\0';
  if (!open_state(session, &fresh, words, sizeof words)) return refuse(session, "ok", "words", words);
  savelog_read(session);
  visitor = session_visitor(session);
  if (visitor != NULL && session_visitor_present(session, visitor)) {
    /* The last session ended without leaving: the visitor leaves now, and nothing is narrated. */
    sprout_outcome outcome;
    if (turns_depart(session, &outcome)) sprout_outcome_free(&outcome);
    session_save_if_dirty(session);
    recovered = true;
    visitor = session_visitor(session);
  }
  for (i = 0; i < session->state->visitor_count; i++) {
    const sprout_stored_visitor *other = &session->state->visitors[i];
    if (!sprout_str_is(other->visit, PLAYER_VISIT) && session_visitor_present(session, other)) others++;
  }
  if (!session_reply_begin(session, &arena, &builder)) return session_reply_end(session, &arena, &builder, NULL);
  root = jb_object(&builder, 7);
  present = jb_array(&builder, others);
  for (i = 0; i < session->state->visitor_count; i++) {
    const sprout_stored_visitor *other = &session->state->visitors[i];
    if (!sprout_str_is(other->visit, PLAYER_VISIT) && session_visitor_present(session, other))
      jb_set(&builder, present, NULL, jb_str(&builder, other->nickname));
  }
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  jb_set(&builder, root, "fresh", jb_bool(&builder, fresh));
  jb_set(&builder, root, "nickname", visitor == NULL ? jb_null(&builder) : jb_str(&builder, visitor->nickname));
  jb_set(&builder, root, "present", present);
  jb_set(&builder, root, "last", jb_number(&builder, (double)session->host.last_seconds));
  jb_set(&builder, root, "recovered", jb_bool(&builder, recovered));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  return session_reply_end(session, &arena, &builder, root);
}

const char *player_close(player_session *session) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  sprout_outcome outcome;
  told_list lines = {0};
  const char *reply;
  if (!session_reply_begin(session, &arena, &builder)) {
    reply = session_reply_end(session, &arena, &builder, NULL);
  } else {
    if (session->state != NULL && turns_depart(session, &outcome)) {
      told_collect(&arena, &lines, &outcome, PLAYER_VISIT);
      sprout_outcome_free(&outcome);
    }
    session_save_if_dirty(session);
    root = jb_object(&builder, 1);
    jb_set(&builder, root, "lines", jb_told(&builder, &lines));
    reply = session_reply_end(session, &arena, &builder, root);
  }
  release_world(session);
  return reply;
}
