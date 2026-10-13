/* host/files.c: whole files over the Playdate's filesystem, and files written a piece at a time. */
#include <stdlib.h>

#include "host/files.h"
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

typedef struct listing {
  char names[8][64];
  int count;
} listing;

static void note(const char *name, void *ctx) {
  listing *seen = (listing *)ctx;
  if (seen->count < 8) snprintf(seen->names[seen->count++], sizeof seen->names[0], "%s", name);
}

static bool listed(const listing *seen, const char *name) {
  int i;
  for (i = 0; i < seen->count; i++)
    if (strcmp(seen->names[i], name) == 0) return true;
  return false;
}

static void a_folder_lists_its_files_and_marks_its_folders(void) {
  listing seen;
  char folder[700];
  begin("list");
  memset(&seen, 0, sizeof seen);
  CHECK(!player_list_files(&fake->api, "listing", note, &seen) && seen.count == 0, "no folder, no list");
  snprintf(folder, sizeof folder, "%s/listing/inner", fake->data);
  {
    char command[800];
    snprintf(command, sizeof command, "mkdir -p '%s'", folder);
    CHECK(system(command) == 0, "%s", command);
  }
  write_text("listing/one.sproutworld", "1");
  write_text("listing/two.txt", "2");
  CHECK(player_list_files(&fake->api, "listing", note, &seen), "listed");
  CHECK(seen.count == 3 && listed(&seen, "one.sproutworld") && listed(&seen, "two.txt") && listed(&seen, "inner/"),
        "%d names", seen.count);
  end();
}

static void a_file_is_found_and_an_image_loaded_where_reading_looks(void) {
  static const char PNG[] = "\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x05\0\0\0\x03";
  LCDBitmap *bitmap;
  int width = 0, height = 0;
  FILE *file;
  char full[1100];
  begin("exists");
  CHECK(!player_file_exists(&fake->api, "absent"), "a missing file");
  write_text("here.txt", "x");
  CHECK(player_file_exists(&fake->api, "here.txt"), "a file in the Data folder");
  CHECK(player_load_bitmap(&fake->api, "here.txt") == NULL, "a file that is no image");
  snprintf(full, sizeof full, "%s/tiny.png", fake->data);
  file = fopen(full, "wb");
  CHECK(file != NULL && fwrite(PNG, 1, sizeof PNG - 1, file) == sizeof PNG - 1, "writing a picture");
  if (file != NULL) fclose(file);
  bitmap = player_load_bitmap(&fake->api, "tiny.png");
  CHECK(bitmap != NULL, "an image loads");
  if (bitmap != NULL) {
    fake->api.graphics->getBitmapData(bitmap, &width, &height, NULL, NULL, NULL);
    CHECK(width == 5 && height == 3, "at its size: %d by %d", width, height);
    fake->api.graphics->freeBitmap(bitmap);
  }
  end();
}

static void a_file_written_in_pieces_is_moved_into_place_and_removed(void) {
  SDFile *file;
  size_t length = 0;
  char *bytes;
  begin("pieces");
  file = player_file_create(&fake->api, "worlds/a b.sproutworld.assets/pictures/cellar.png.part");
  CHECK(file != NULL, "the folders it is in are made");
  CHECK(player_file_append(&fake->api, file, "one ", 4) && player_file_append(&fake->api, file, "two", 3), "two pieces");
  CHECK(player_file_close(&fake->api, file), "closed");
  write_text("worlds/a b.sproutworld.assets/pictures/cellar.png", "older");
  CHECK(player_file_move(&fake->api, "worlds/a b.sproutworld.assets/pictures/cellar.png.part",
                         "worlds/a b.sproutworld.assets/pictures/cellar.png"),
        "moved over what was there");
  bytes = player_read_file(&fake->api, "worlds/a b.sproutworld.assets/pictures/cellar.png", &length);
  CHECK(bytes != NULL && length == 7 && strcmp(bytes, "one two") == 0, "the pieces in order, the older file replaced");
  player_free(&fake->api, bytes);
  CHECK(!exists("worlds/a b.sproutworld.assets/pictures/cellar.png.part"), "nothing left at the part");
  CHECK(!player_file_move(&fake->api, "worlds/absent.part", "worlds/absent"), "a part that is not there cannot be moved");
  player_file_remove(&fake->api, "worlds/a b.sproutworld.assets");
  CHECK(!exists("worlds/a b.sproutworld.assets/pictures/cellar.png"), "the folder is removed with everything in it");
  write_text("worlds/one.txt", "one");
  player_file_remove(&fake->api, "worlds/one.txt");
  CHECK(!exists("worlds/one.txt"), "and a file by itself");
  fake->fail_writes = 1;
  CHECK(player_file_create(&fake->api, "worlds/full.part") == NULL, "a file that cannot be made is NULL");
  end();
}

int main(void) {
  test_program("files");
  a_file_is_found_and_an_image_loaded_where_reading_looks();
  a_file_is_written_whole_and_read_back();
  a_file_bigger_than_a_chunk_is_read_whole();
  a_write_cut_short_before_the_swap_is_found_by_the_read();
  a_write_that_cannot_be_made_says_so_and_leaves_the_file();
  a_folder_lists_its_files_and_marks_its_folders();
  a_file_written_in_pieces_is_moved_into_place_and_removed();
  return finish();
}
