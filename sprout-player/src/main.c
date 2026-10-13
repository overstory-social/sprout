/*
 * sprout-player's entry point. Two apps share the engine and its session. By default the app is
 * Lua: at kEventInitLua, before main.lua runs, the engine's functions are registered under
 * `sprout` (bridge.h), and no update callback is set, so the system runs the Lua code. Built
 * with PLAYER_C_UI, the app is C (ui/app.h): at kEventInit the update callback is set, which
 * tells the system the game is pure C, and the pdx carries no Lua.
 */
#include "pd_api.h"

#ifdef PLAYER_C_UI
#include "ui/app.h"

static player_app *app = NULL;
#else
#include "bridge.h"
#endif

#ifdef _WINDLL
__declspec(dllexport)
#endif
int eventHandler(PlaydateAPI *pd, PDSystemEvent event, uint32_t arg) {
  (void)arg;
#ifdef PLAYER_C_UI
  if (event == kEventInit) {
    const char *why = NULL;
    app = player_app_new(pd, &why);
    if (app == NULL)
      pd->system->error("sprout-player: %s", why);
    else
      pd->system->setUpdateCallback(player_app_update, app);
  } else if (app == NULL) {
    return 0;
  } else if (event == kEventLock || event == kEventLowPower) {
    player_app_sleep(app);
  } else if (event == kEventUnlock) {
    player_app_wake(app);
  } else if (event == kEventTerminate) {
    player_app_free(app);
    app = NULL;
  }
#else
  if (event == kEventInitLua) {
    if (!player_register(pd)) pd->system->error("sprout-player: the engine could not be registered");
  } else if (event == kEventTerminate) {
    player_shutdown();
  }
#endif
  return 0;
}
