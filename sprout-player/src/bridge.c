/* The functions Lua calls; see bridge.h. */
#include "bridge.h"

#include "session.h"

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

static int lua_inspect(lua_State *L) {
  (void)L;
  return reply(player_inspect(session, argument(1)));
}

static int lua_open(lua_State *L) {
  (void)L;
  return reply(player_open(session, argument(1)));
}

static int lua_load(lua_State *L) {
  (void)L;
  return reply(player_load(session));
}

static int lua_admit(lua_State *L) {
  (void)L;
  return reply(player_admit(session, argument(1)));
}

static int lua_view(lua_State *L) {
  (void)L;
  return reply(player_view(session));
}

static int lua_turn(lua_State *L) {
  (void)L;
  return reply(player_turn(session, argument(1)));
}

static int lua_tick(lua_State *L) {
  (void)L;
  return reply(player_tick(session));
}

static int lua_save(lua_State *L) {
  (void)L;
  return reply(player_save(session));
}

static int lua_close(lua_State *L) {
  (void)L;
  return reply(player_close(session));
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
