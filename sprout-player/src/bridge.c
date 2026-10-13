/* The functions Lua calls, and the JSON they hand back; see bridge.h. */
#include "bridge.h"

#include <stdint.h>
#include <string.h>

#include "chips.h"
#include "host/pd_host.h"
#include "host/stack.h"
#include "reading_json.h"
#include "reply.h"
#include "session.h"
#include "shipping.h"
#include "view_json.h"

static PlaydateAPI *api;
static player_session *session;
static player_host host; /* the pages a reply is built in */
static char *reply_text; /* the text last handed to Lua */

/*
 * What every call answers once the session is gone: the system has told the app to stop and
 * the Lua side may still run a frame, so a call then is refused rather than run against nothing.
 */
#define SHUT_DOWN "{\"ok\":false,\"reason\":\"The engine has shut down.\",\"words\":\"The engine has shut down.\"}"

/* The same for a view, whose reply has one shape: nowhere, with nothing in it, and the words. */
#define SHUT_DOWN_VIEW                                                                                   \
  "{\"place\":{\"id\":\"\",\"name\":\"\"},\"description\":[],\"effects\":[],\"exits\":[],\"occupants\":[]," \
  "\"carried\":[],\"faulted\":false,\"words\":\"The engine has shut down.\"}"

/* What a call answers when its reply cannot be built for want of memory. */
#define FAILED                                                                                         \
  "{\"ok\":false,\"admitted\":false,\"committed\":false,\"ran\":false,\"words\":\"The player ran out of " \
  "memory telling you that.\",\"reason\":\"The player ran out of memory telling you that.\",\"lines\":[]}"

/* A string argument, or the empty string where Lua passed none. */
static const char *argument(int position) {
  const char *text = api->lua->getArgString(position);
  return text == NULL ? "" : text;
}

static int reply(const char *json) {
  api->lua->pushString(json);
  return 1;
}

/* ---- building a reply ---- */

/* A builder over a fresh arena for one reply. */
static void begin(sprout_arena *arena, jb *builder) {
  sprout_arena_init(arena, &host.record);
  jb_begin(builder, arena);
}

/* Hands `root` to Lua as its text, or FAILED where a page was refused, and releases the reply's arena. */
static int finish(sprout_arena *arena, jb *builder, const sprout_json *root) {
  bool written = jb_finish(builder, api, root, &reply_text);
  sprout_arena_reset(arena);
  return reply(written ? reply_text : FAILED);
}

/* Text, or null where there is none. */
static sprout_json *text_or_null(jb *builder, const char *text) {
  return text == NULL ? jb_null(builder) : jb_string(builder, text);
}

/* { <flag>: false, <key>: words }: a call refused, in the shape Lua reads for it. */
static int refused(const char *flag, const char *key, const char *words) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  begin(&arena, &builder);
  root = jb_object(&builder, 2);
  jb_set(&builder, root, flag, jb_bool(&builder, false));
  jb_set(&builder, root, key, jb_string(&builder, words));
  return finish(&arena, &builder, root);
}

/* { <flag>: false, committed: false, words, lines: [] }: a call of turns that could run none. */
static int cannot(const char *flag, const char *words) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  begin(&arena, &builder);
  root = jb_object(&builder, 4);
  jb_set(&builder, root, flag, jb_bool(&builder, false));
  jb_set(&builder, root, "committed", jb_bool(&builder, false));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  jb_set(&builder, root, "lines", jb_array(&builder, 0));
  return finish(&arena, &builder, root);
}

/* inspect and open: { ok, name, hash, reason }; an open refused is { ok: false, reason }. */
static int opening(const player_opening *answer, bool open) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (open && !answer->ok) return refused("ok", "reason", answer->reason);
  begin(&arena, &builder);
  root = jb_object(&builder, 4);
  jb_set(&builder, root, "ok", jb_bool(&builder, answer->ok));
  jb_set(&builder, root, "name", text_or_null(&builder, answer->name));
  jb_set(&builder, root, "hash", text_or_null(&builder, answer->hash));
  jb_set(&builder, root, "reason", text_or_null(&builder, answer->reason));
  return finish(&arena, &builder, root);
}

/* step: { ok, done, read, counted } and, once done, { name, hash, words }; refused, { ok: false, reason }. */
static int stepped(const player_opening *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root, *words;
  size_t i;
  if (!answer->ok) return refused("ok", "reason", answer->reason);
  begin(&arena, &builder);
  root = jb_object(&builder, 7);
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  jb_set(&builder, root, "done", jb_bool(&builder, answer->done));
  jb_set(&builder, root, "read", jb_number(&builder, (double)answer->read));
  jb_set(&builder, root, "counted", jb_number(&builder, (double)answer->counted));
  if (answer->done) {
    jb_set(&builder, root, "name", jb_string(&builder, answer->name));
    jb_set(&builder, root, "hash", jb_string(&builder, answer->hash));
    words = jb_array(&builder, answer->word_count);
    for (i = 0; i < answer->word_count; i++) jb_set(&builder, words, NULL, jb_string(&builder, answer->words[i]));
    jb_set(&builder, root, "words", words);
  }
  return finish(&arena, &builder, root);
}

/* load: { ok, fresh, nickname, present, last, recovered, words }; refused, { ok: false, words }. */
static int loaded(const player_loaded *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root, *present;
  size_t i;
  if (!answer->ok) return refused("ok", "words", answer->words);
  begin(&arena, &builder);
  root = jb_object(&builder, 7);
  present = jb_array(&builder, answer->present_count);
  for (i = 0; i < answer->present_count; i++) jb_set(&builder, present, NULL, jb_str(&builder, answer->present[i]));
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  jb_set(&builder, root, "fresh", jb_bool(&builder, answer->fresh));
  jb_set(&builder, root, "nickname", answer->nickname == NULL ? jb_null(&builder) : jb_str(&builder, *answer->nickname));
  jb_set(&builder, root, "present", present);
  jb_set(&builder, root, "last", jb_number(&builder, (double)answer->last));
  jb_set(&builder, root, "recovered", jb_bool(&builder, answer->recovered));
  jb_set(&builder, root, "words", jb_string(&builder, answer->words));
  return finish(&arena, &builder, root);
}

/* admit: { admitted, saved, words, visit, lines }. */
static int admitted(const player_told *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!answer->ok) return cannot("admitted", answer->words);
  begin(&arena, &builder);
  root = jb_object(&builder, 5);
  jb_set(&builder, root, "admitted", jb_bool(&builder, answer->admitted));
  jb_set(&builder, root, "saved", jb_bool(&builder, answer->saved));
  jb_set(&builder, root, "words", jb_string(&builder, answer->words));
  jb_set(&builder, root, "visit", jb_string(&builder, PLAYER_VISIT));
  jb_set(&builder, root, "lines", jb_told(&builder, &answer->lines));
  return finish(&arena, &builder, root);
}

/* turn: { committed, saved, result, words, lines }; one that could run nothing answers as a tick does. */
static int turned(const player_told *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!answer->ok) return cannot("ran", answer->words);
  begin(&arena, &builder);
  root = jb_object(&builder, 5);
  jb_set(&builder, root, "committed", jb_bool(&builder, answer->committed));
  jb_set(&builder, root, "saved", jb_bool(&builder, answer->saved));
  jb_set(&builder, root, "result", jb_string(&builder, result_name(answer->result)));
  jb_set(&builder, root, "words", text_or_null(&builder, answer->words));
  jb_set(&builder, root, "lines", jb_told(&builder, &answer->lines));
  return finish(&arena, &builder, root);
}

/* tick: { ran, saved, lines }. */
static int ticked(const player_told *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  if (!answer->ok) return cannot("ran", answer->words);
  begin(&arena, &builder);
  root = jb_object(&builder, 3);
  jb_set(&builder, root, "ran", jb_bool(&builder, answer->ran));
  jb_set(&builder, root, "saved", jb_bool(&builder, answer->saved));
  jb_set(&builder, root, "lines", jb_told(&builder, &answer->lines));
  return finish(&arena, &builder, root);
}

/* close: { lines, saved }. */
static int closed(const player_told *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  begin(&arena, &builder);
  root = jb_object(&builder, 2);
  jb_set(&builder, root, "lines", jb_told(&builder, &answer->lines));
  jb_set(&builder, root, "saved", jb_bool(&builder, answer->saved));
  return finish(&arena, &builder, root);
}

/* save: { ok, words }. */
static int saved(const player_result *answer) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  begin(&arena, &builder);
  root = jb_object(&builder, 2);
  jb_set(&builder, root, "ok", jb_bool(&builder, answer->ok));
  jb_set(&builder, root, "words", jb_string(&builder, answer->words));
  return finish(&arena, &builder, root);
}

/* ---- the view ---- */

/* A view that is only words: nowhere, with nothing in it. */
static int nothing_to_see(const char *words) {
  sprout_arena arena;
  jb builder;
  sprout_json *root, *place;
  begin(&arena, &builder);
  root = jb_object(&builder, 8);
  place = jb_object(&builder, 2);
  jb_set(&builder, place, "id", jb_string(&builder, ""));
  jb_set(&builder, place, "name", jb_string(&builder, ""));
  jb_set(&builder, root, "place", place);
  jb_set(&builder, root, "description", jb_array(&builder, 0));
  jb_set(&builder, root, "effects", jb_array(&builder, 0));
  jb_set(&builder, root, "exits", jb_array(&builder, 0));
  jb_set(&builder, root, "occupants", jb_array(&builder, 0));
  jb_set(&builder, root, "carried", jb_array(&builder, 0));
  jb_set(&builder, root, "faulted", jb_bool(&builder, false));
  jb_set(&builder, root, "words", jb_string(&builder, words));
  return finish(&arena, &builder, root);
}

/* view: { place: { id, name }, description, effects, exits, occupants, carried, faulted }. */
static int viewed(const sprout_seen_view *view, const char *words) {
  static const char *const TAKEN[] = {"description", "effects", "exits", "occupants", "carried"};
  sprout_arena arena;
  jb builder;
  sprout_json *root, *place, *whole;
  size_t i;
  bool written;
  if (view == NULL) return nothing_to_see(words);
  begin(&arena, &builder);
  whole = sprout_view_tree(&arena, view);
  if (whole == NULL) builder.ok = false;
  root = jb_object(&builder, 8);
  place = jb_object(&builder, 2);
  jb_set(&builder, place, "id", jb_str(&builder, view->place.id));
  jb_set(&builder, place, "name", jb_str(&builder, view->place.name));
  jb_set(&builder, root, "place", place);
  /* The members of the view's own tree are moved under the reply's object. */
  for (i = 0; builder.ok && i < sizeof TAKEN / sizeof *TAKEN; i++)
    jb_set(&builder, root, TAKEN[i], (sprout_json *)sprout_json_get(whole, TAKEN[i]));
  jb_set(&builder, root, "faulted", jb_bool(&builder, view->faulted));
  written = jb_finish(&builder, api, root, &reply_text);
  sprout_arena_reset(&arena);
  return written ? reply(reply_text) : nothing_to_see("The player ran out of memory looking around.");
}

/* ---- the chips ---- */

/*
 * The picks a path names, read from its JSON array of 1-based indexes. A step that is not a whole
 * number from 1 to what a level can hold, or a path that is not an array, is a pick of 0, which
 * names nothing, so the session says so where its walk of the path reaches it.
 */
static size_t *picks_of(sprout_arena *arena, const char *text, size_t *count) {
  sprout_json *path = NULL;
  sprout_json_error error;
  size_t *picks, i;
  if (sprout_json_read(arena, text, strlen(text), &path, &error) != SPROUT_OK || path == NULL ||
      path->kind != SPROUT_JSON_ARRAY) {
    *count = 1;
    return (size_t *)sprout_arena_take(arena, sizeof *picks);
  }
  *count = path->count;
  picks = (size_t *)sprout_arena_take(arena, (path->count + 1) * sizeof *picks);
  if (picks == NULL) return NULL;
  for (i = 0; i < path->count; i++) {
    const sprout_json *step = path->items[i];
    double at = step->kind == SPROUT_JSON_NUMBER ? step->number : 0;
    picks[i] = at >= 1 && at <= 65536.0 && at == (double)(long)at ? (size_t)at : 0;
  }
  return picks;
}

/* A choice's greyed and reason: null and null where its verb's readings have not been asked for. */
static void grey(jb *builder, sprout_json *into, const player_chip *chip) {
  jb_set(builder, into, "greyed",
         chip->greyed == PLAYER_GREYED_UNKNOWN ? jb_null(builder) : jb_bool(builder, chip->greyed == PLAYER_GREYED_YES));
  jb_set(builder, into, "reason", text_or_null(builder, chip->reason));
}

/* chips: { choices: [{ verb | filler, greyed, reason }], leaf } and, right under a verb, its greyed and reason. */
static int level_of(sprout_arena *arena, jb *builder, const player_chip_level *level) {
  sprout_json *root, *choices;
  size_t i;
  if (!level->ok) {
    sprout_arena_reset(arena);
    return refused("ok", "reason", level->reason);
  }
  root = jb_object(builder, 4);
  choices = jb_array(builder, level->choice_count);
  for (i = 0; i < level->choice_count; i++) {
    const player_chip *chip = &level->choices[i];
    sprout_json *choice = jb_object(builder, 3);
    if (chip->filler != NULL) {
      sprout_json *filler = sprout_seen_filler_json(arena, chip->filler);
      if (filler == NULL) builder->ok = false;
      jb_set(builder, choice, "filler", filler);
    } else {
      jb_set(builder, choice, "verb", jb_string(builder, chip->verb));
    }
    grey(builder, choice, chip);
    jb_set(builder, choices, NULL, choice);
  }
  jb_set(builder, root, "choices", choices);
  if (level->leaf == NULL) {
    jb_set(builder, root, "leaf", jb_null(builder));
  } else {
    sprout_json *leaf = sprout_chip_leaf_json(arena, level->leaf);
    if (leaf == NULL) builder->ok = false;
    jb_set(builder, root, "leaf", leaf);
  }
  if (level->verb != NULL) grey(builder, root, level->verb);
  return finish(arena, builder, root);
}

/* ---- the registered functions ---- */

/* Answers SHUT_DOWN when there is no session. */
#define LIVE()                                    \
  do {                                            \
    if (session == NULL) return reply(SHUT_DOWN); \
  } while (0)

/* A call that may run a turn or render prose runs on the player's own stack (host/stack.h); the rest run where Lua called them. */
#define LUA_ENTRY(name)                                                                              \
  static int name##_body(lua_State *L);                                                              \
  static void *name##_thunk(void *L) { return (void *)(intptr_t)name##_body((lua_State *)L); }     \
  static int name(lua_State *L) { return (int)(intptr_t)player_on_own_stack(api, name##_thunk, L); } \
  static int name##_body(lua_State *L)

static int lua_inspect(lua_State *L) {
  player_opening answer;
  (void)L;
  LIVE();
  answer = player_inspect(session, argument(1));
  return opening(&answer, false);
}

static int lua_open(lua_State *L) {
  player_opening answer;
  (void)L;
  LIVE();
  answer = player_open(session, argument(1));
  return opening(&answer, true);
}

static int lua_step(lua_State *L) {
  player_opening answer;
  (void)L;
  LIVE();
  answer = player_step(session);
  return stepped(&answer);
}

LUA_ENTRY(lua_load) {
  player_loaded answer;
  (void)L;
  LIVE();
  answer = player_load(session);
  return loaded(&answer);
}

LUA_ENTRY(lua_admit) {
  player_told answer;
  (void)L;
  LIVE();
  answer = player_admit(session, argument(1));
  return admitted(&answer);
}

LUA_ENTRY(lua_view) {
  const sprout_seen_view *view;
  const char *words = "";
  (void)L;
  if (session == NULL) return reply(SHUT_DOWN_VIEW);
  view = player_view(session, &words);
  return viewed(view, words);
}

LUA_ENTRY(lua_chips) {
  sprout_arena arena;
  jb builder;
  player_chip_level level;
  size_t *picks, count = 0;
  (void)L;
  LIVE();
  begin(&arena, &builder);
  picks = picks_of(&arena, argument(1), &count);
  if (picks == NULL) {
    sprout_arena_reset(&arena);
    return reply(FAILED);
  }
  level = player_chips(session, picks, count);
  return level_of(&arena, &builder, &level);
}

LUA_ENTRY(lua_turn) {
  sprout_arena arena;
  sprout_reading reading;
  player_told answer;
  const char *text = argument(1), *typed = NULL, *why;
  int pushed;
  (void)L;
  LIVE();
  sprout_arena_init(&arena, &host.record);
  why = reading_parse(&arena, text, strlen(text), &reading, &typed);
  answer = why == NULL ? player_turn(session, &reading, typed) : player_misread(session, why);
  pushed = turned(&answer);
  sprout_arena_reset(&arena);
  return pushed;
}

LUA_ENTRY(lua_tick) {
  player_told answer;
  (void)L;
  LIVE();
  answer = player_tick(session);
  return ticked(&answer);
}

static int lua_save(lua_State *L) {
  player_result answer;
  (void)L;
  LIVE();
  answer = player_save(session);
  return saved(&answer);
}

static int lua_close(lua_State *L) {
  player_told answer;
  (void)L;
  LIVE();
  answer = player_close(session);
  return closed(&answer);
}

static int lua_verify(lua_State *L) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  const char *why;
  (void)L;
  LIVE();
  why = player_verify(argument(1), argument(2), argument(3));
  if (why != NULL) return refused("ok", "reason", why);
  begin(&arena, &builder);
  root = jb_object(&builder, 1);
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  return finish(&arena, &builder, root);
}

static int lua_digest(lua_State *L) {
  sprout_arena arena;
  jb builder;
  sprout_json *root;
  char sha256[65];
  size_t bytes = 0;
  const char *why;
  (void)L;
  LIVE();
  why = player_digest(api, argument(1), sha256, &bytes);
  if (why != NULL) return refused("ok", "reason", why);
  begin(&arena, &builder);
  root = jb_object(&builder, 3);
  jb_set(&builder, root, "ok", jb_bool(&builder, true));
  jb_set(&builder, root, "sha256", jb_string(&builder, sha256));
  jb_set(&builder, root, "bytes", jb_number(&builder, (double)bytes));
  return finish(&arena, &builder, root);
}

typedef struct registered {
  lua_CFunction function;
  const char *name;
} registered;

bool player_register(PlaydateAPI *pd) {
  static const registered FUNCTIONS[] = {
      {lua_inspect, "sprout.inspect"}, {lua_open, "sprout.open"}, {lua_step, "sprout.step"}, {lua_load, "sprout.load"},
      {lua_admit, "sprout.admit"},     {lua_view, "sprout.view"}, {lua_chips, "sprout.chips"}, {lua_turn, "sprout.turn"},
      {lua_tick, "sprout.tick"},       {lua_save, "sprout.save"}, {lua_close, "sprout.close"},
      {lua_verify, "sprout.verify"},   {lua_digest, "sprout.digest"},
  };
  size_t i;
  api = pd;
  player_host_init(&host, pd);
  if (session == NULL) session = player_session_new(pd);
  if (session == NULL) {
    pd->system->logToConsole("sprout-player: no memory for a session");
    return false;
  }
  for (i = 0; i < sizeof FUNCTIONS / sizeof *FUNCTIONS; i++) {
    const char *error = NULL;
    if (!pd->lua->addFunction(FUNCTIONS[i].function, FUNCTIONS[i].name, &error)) {
      pd->system->logToConsole("sprout-player: cannot register %s: %s", FUNCTIONS[i].name,
                               error == NULL ? "unknown" : error);
      return false;
    }
  }
  return true;
}

void player_shutdown(void) {
  if (session == NULL) return;
  player_close(session);
  player_session_free(session);
  session = NULL;
  if (reply_text != NULL) api->system->realloc(reply_text, 0);
  reply_text = NULL;
}
