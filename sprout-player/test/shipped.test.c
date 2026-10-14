/*
 * The worlds the app ships (PLAYER_SHIPPED_DIR, the folder the build packed sprout-player/worlds.json
 * into): the shelf must be able to shelve every one, so a graduated world over this app's caps or
 * too large for its memory fails the build rather than shipping greyed, and each opens whole, its
 * file read a piece at a time as the console reads it. Without the variable there is nothing to
 * check and the test says so.
 */
#include <dirent.h>
#include <stdlib.h>

#include "support.h"

#define SUFFIX ".sproutworld"

static void every_shipped_world_shelves_and_opens(const char *folder) {
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
      player_opening answer;
      if (length < tail || strcmp(entry->d_name + length - tail, SUFFIX) != 0) continue;
      worlds++;
      answer = player_inspect(session, entry->d_name);
      CHECK(answer.ok, "%s is greyed on the shelf: %.300s", entry->d_name, answer.reason);
      answer = player_open(session, entry->d_name);
      CHECK(answer.ok, "%s does not open: %.300s", entry->d_name, answer.reason);
      fake->reads = 0;
      fake->read_largest = 0;
      while (answer.ok && !answer.done) answer = player_step(session);
      CHECK(answer.ok && answer.done, "%s does not load: %.300s", entry->d_name, answer.reason ? answer.reason : "");
      CHECK(fake->reads > 0 && fake->read_largest <= 32768, "%s is read in %zu reads, the largest %zu bytes", entry->d_name,
            fake->reads, fake->read_largest);
    }
    closedir(dir);
  }
  CHECK(worlds > 0, "no %s in %s", SUFFIX, folder);
  printf("shipped: %d worlds shelve and open\n", worlds);
  end();
}

int main(void) {
  const char *folder = getenv("PLAYER_SHIPPED_DIR");
  test_program("shipped");
  if (folder == NULL || folder[0] == '\0') {
    printf("shipped: PLAYER_SHIPPED_DIR is not set, nothing to check\n");
    return 0;
  }
  every_shipped_world_shelves_and_opens(folder);
  return finish();
}
