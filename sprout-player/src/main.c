/*
 * sprout-player's entry point. The app is C (ui/app.h): at kEventInit the update callback is set,
 * which tells the system the game is pure C, and the system's lock, low-power, unlock, pause and
 * terminate events are handed to the app.
 */
#include "pd_api.h"

#include "ui/app.h"

static player_app *app = NULL;

#ifdef _WINDLL
__declspec(dllexport)
#endif
int eventHandler(PlaydateAPI *pd, PDSystemEvent event, uint32_t arg) {
  (void)arg;
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
  } else if (event == kEventPause) {
    player_app_pause(app);
  } else if (event == kEventTerminate) {
    player_app_free(app);
    app = NULL;
  }
  return 0;
}
