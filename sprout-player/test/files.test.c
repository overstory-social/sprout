/* files.c: whole files over the Playdate's filesystem. */
#include <stdlib.h>

#include "files.h"
#include "support.h"

static void a_file_is_written_whole_and_read_back(void) {
  size_t length = 0;
  char *bytes;
  begin("whole");
  CHECK(player_read_file(&fake->api, "absent", &length) == NULL, "a missing file");
  CHECK(player_write_file(&fake->api, "one.txt", "first", 5), "writing");
  bytes = player_read_file(&fake->api, "one.txt", &length);
  CHECK(bytes != NULL && length == 5 && strcmp(bytes, "first") == 0, "reading");
  player_free(&fake->api, bytes);
  CHECK(player_write_file(&fake->api, "one.txt", "second one", 10), "writing over");
  bytes = player_read_file(&fake->api, "one.txt", &length);
  CHECK(bytes != NULL && length == 10 && strcmp(bytes, "second one") == 0, "replaced");
  player_free(&fake->api, bytes);
  CHECK(!exists("one.txt.tmp"), "no temporary left behind");
  end();
}

static void a_file_bigger_than_a_chunk_is_read_whole(void) {
  size_t length = 0, i;
  char *big = (char *)malloc(70000), *bytes;
  begin("big");
  for (i = 0; i < 70000; i++) big[i] = (char)('a' + i % 26);
  CHECK(player_write_file(&fake->api, "big.bin", big, 70000), "writing");
  bytes = player_read_file(&fake->api, "big.bin", &length);
  CHECK(bytes != NULL && length == 70000 && memcmp(bytes, big, 70000) == 0, "length %zu", length);
  player_free(&fake->api, bytes);
  free(big);
  end();
}

static void a_write_cut_short_before_the_swap_is_found_by_the_read(void) {
  size_t length = 0;
  char *bytes;
  begin("tmp");
  write_text("save.json.tmp", "whole");
  bytes = player_read_file(&fake->api, "save.json", &length);
  CHECK(bytes != NULL && strcmp(bytes, "whole") == 0, "the leftover");
  player_free(&fake->api, bytes);
  end();
}

static void a_write_that_cannot_be_made_says_so_and_leaves_the_file(void) {
  size_t length = 0;
  char *bytes;
  begin("full");
  CHECK(player_write_file(&fake->api, "kept.txt", "old", 3), "writing");
  fake->fail_writes = 1;
  CHECK(!player_write_file(&fake->api, "kept.txt", "new", 3), "a full disk");
  fake->fail_writes = 0;
  bytes = player_read_file(&fake->api, "kept.txt", &length);
  CHECK(bytes != NULL && strcmp(bytes, "old") == 0, "the old file is as it was");
  player_free(&fake->api, bytes);
  {
    char long_path[400];
    memset(long_path, 'a', sizeof long_path - 1);
    long_path[sizeof long_path - 1] = '\0';
    CHECK(!player_write_file(&fake->api, long_path, "x", 1), "a path too long for the temporary name");
  }
  end();
}

int main(void) {
  test_program("files");
  a_file_is_written_whole_and_read_back();
  a_file_bigger_than_a_chunk_is_read_whole();
  a_write_cut_short_before_the_swap_is_found_by_the_read();
  a_write_that_cannot_be_made_says_so_and_leaves_the_file();
  return finish();
}
