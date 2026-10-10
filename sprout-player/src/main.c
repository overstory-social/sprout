/*
 * sprout-player's entry point. The app is Lua over a C engine: at kEventInitLua, before
 * main.lua runs, the engine's functions are registered under `sprout` (bridge.h); the app never
 * sets an update callback, so the system keeps running the Lua code.
 */
#include "bridge.h"
#include "pd_api.h"

#ifdef _WINDLL
__declspec(dllexport)
#endif
int eventHandler(PlaydateAPI *pd, PDSystemEvent event, uint32_t arg) {
  (void)arg;
  if (event == kEventInitLua) {
    if (!player_register(pd)) pd->system->error("sprout-player: the engine could not be registered");
  } else if (event == kEventTerminate) {
    player_shutdown();
  }
  return 0;
}
