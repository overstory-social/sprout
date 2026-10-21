/*
 * The graduated worlds (PLAYER_SHIPPED_DIR, the folder apart from the pdx that the build packed
 * sprout-player/worlds.json's "graduated" into) and the test-only ones (PLAYER_TEST_WORLDS_DIR, its
 * "testOnly", which a player downloads): the shelf must be able to shelve every one, so a listed world
 * over this app's caps or too large for its memory fails the build rather than shelving greyed, and each opens whole, its
 * file read a piece at a time as the console reads it. Without a variable there is nothing in it to
 * check and the test says so.
 */
#include <dirent.h>
#include <stdlib.h>

#include "support.h"

#define SUFFIX ".sproutworld"

/* Shelves and opens every cartridge in `folder`, the scenario `scenario`; at least one must be there. */
static void every_world_shelves_and_opens(const char *scenario, const char *folder) {
  DIR *dir = opendir(folder);
  struct dirent *entry;
  int worlds = 0;
  begin(scenario);
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
  printf("shipped: %s: %d worlds shelve and open\n", scenario, worlds);
  end();
}

int main(void) {
  static const char *const FOLDERS[][2] = {{"PLAYER_SHIPPED_DIR", "graduated"}, {"PLAYER_TEST_WORLDS_DIR", "test-only"}};
  size_t i;
  test_program("shipped");
  for (i = 0; i < sizeof FOLDERS / sizeof FOLDERS[0]; i++) {
    const char *folder = getenv(FOLDERS[i][0]);
    if (folder == NULL || folder[0] == '\0')
      printf("shipped: %s is not set, no %s worlds to check\n", FOLDERS[i][0], FOLDERS[i][1]);
    else
      every_world_shelves_and_opens(FOLDERS[i][1], folder);
  }
  return finish();
}
