/*
 * The worlds the app ships (PLAYER_SHIPPED_DIR, the folder the build packed sprout-player/worlds.json
 * into): the shelf must be able to shelve every one, so a graduated world over this app's caps or
 * too large for its memory fails the build rather than shipping greyed. Without the variable there
 * is nothing to check and the test says so.
 */
#include <dirent.h>
#include <stdlib.h>

#include "support.h"

#define SUFFIX ".sproutworld"

static void every_shipped_world_can_be_shelved(const char *folder) {
  DIR *dir = opendir(folder);
  struct dirent *entry;
  int worlds = 0;
  begin("shelve");
  snprintf(fake->app, sizeof fake->app, "%s", folder);
  CHECK(dir != NULL, "the folder %s", folder);
  if (dir != NULL) {
    player_session *session = session_new();
    while ((entry = readdir(dir)) != NULL) {
      size_t length = strlen(entry->d_name), tail = strlen(SUFFIX);
      char *reply;
      if (length < tail || strcmp(entry->d_name + length - tail, SUFFIX) != 0) continue;
      worlds++;
      reply = keep(player_inspect(session, entry->d_name));
      CHECK(HAS(reply, "\"ok\":true"), "%s is greyed on the shelf: %.300s", entry->d_name, reply);
    }
    closedir(dir);
  }
  CHECK(worlds > 0, "no %s in %s", SUFFIX, folder);
  printf("shipped: %d worlds shelve\n", worlds);
  end();
}

int main(void) {
  const char *folder = getenv("PLAYER_SHIPPED_DIR");
  test_program("shipped");
  if (folder == NULL || folder[0] == '\0') {
    printf("shipped: PLAYER_SHIPPED_DIR is not set, nothing to check\n");
    return 0;
  }
  every_shipped_world_can_be_shelved(folder);
  return finish();
}
