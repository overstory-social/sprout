/* The functions Lua calls; see bridge.h. */
#include "bridge.h"

#include "session.h"
#include "shipping.h"

static PlaydateAPI *api;
static player_session *session;

/* A string argument, or the empty string where Lua passed none. */
static const char *argument(int position) {
  const char *text = api->lua->getArgString(position);
  return text == NULL ? "" : text;
}

static int reply(const char *json) {
  api->lua->pushString(json);
  return 1;
}

/*
 * What every call answers once the session is gone: the system has told the app to stop and
 * the Lua side may still run a frame, so a call then is refused rather than run against nothing.
 */
#define SHUT_DOWN "{\"ok\":false,\"reason\":\"The engine has shut down.\",\"words\":\"The engine has shut down.\"}"

/* The same for a view, whose reply has one shape: nowhere, with nothing in it, and the words. */
#define SHUT_DOWN_VIEW                                                                                   \
  "{\"place\":{\"id\":\"\",\"name\":\"\"},\"description\":[],\"effects\":[],\"exits\":[],\"occupants\":[]," \
  "\"carried\":[],\"chips\":[],\"faulted\":false,\"words\":\"The engine has shut down.\"}"

/* Refuses the call when there is no session; otherwise the call's own reply. */
#define ANSWER(call) return reply(session == NULL ? SHUT_DOWN : (call))

static int lua_inspect(lua_State *L) {
  (void)L;
  ANSWER(player_inspect(session, argument(1)));
}

static int lua_open(lua_State *L) {
  (void)L;
  ANSWER(player_open(session, argument(1)));
}

static int lua_load(lua_State *L) {
  (void)L;
  ANSWER(player_load(session));
}

static int lua_admit(lua_State *L) {
  (void)L;
  ANSWER(player_admit(session, argument(1)));
}

static int lua_view(lua_State *L) {
  (void)L;
  return reply(session == NULL ? SHUT_DOWN_VIEW : player_view(session));
}

static int lua_turn(lua_State *L) {
  (void)L;
  ANSWER(player_turn(session, argument(1)));
}

static int lua_tick(lua_State *L) {
  (void)L;
  ANSWER(player_tick(session));
}

static int lua_save(lua_State *L) {
  (void)L;
  ANSWER(player_save(session));
}

static int lua_close(lua_State *L) {
  (void)L;
  ANSWER(player_close(session));
}

static int lua_verify(lua_State *L) {
  (void)L;
  ANSWER(player_verify(session, argument(1), argument(2), argument(3)));
}

static int lua_digest(lua_State *L) {
  (void)L;
  ANSWER(player_digest(session, argument(1)));
}

typedef struct registered {
  lua_CFunction function;
  const char *name;
} registered;

bool player_register(PlaydateAPI *pd) {
  static const registered FUNCTIONS[] = {
      {lua_inspect, "sprout.inspect"}, {lua_open, "sprout.open"}, {lua_load, "sprout.load"},
      {lua_admit, "sprout.admit"},     {lua_view, "sprout.view"}, {lua_turn, "sprout.turn"},
      {lua_tick, "sprout.tick"},       {lua_save, "sprout.save"}, {lua_close, "sprout.close"},
      {lua_verify, "sprout.verify"},   {lua_digest, "sprout.digest"},
  };
  size_t i;
  api = pd;
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
}
