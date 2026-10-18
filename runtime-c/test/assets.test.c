/*
 * Tests for src/assets.c, over the corpus's media room as `sprout pack` wrote
 * it: the header says where the assets section is, its prefix how much
 * directory follows, and the directory where each file lies by its path, which
 * inflates alone to what the extension packed (for `media`, a picture's width
 * and height, then its rows). A directory that does not fit its section finds
 * nothing, and a world that names no file has no section.
 */
#include "assets.h"
#include "corpus.h"
#include "inflate.h"
#include "load.h"

typedef struct packed_world {
  char *bytes;
  size_t length;
  sprout_cartridge_layout layout;
  const unsigned char *section;
  size_t count, directory_bytes;
} packed_world;

static void open_packed(packed_world *w, const char *name) {
  char path[512];
  sprout_refusal refusal;
  snprintf(path, sizeof path, "%s/%s.sproutworld", SPROUT_CARTRIDGES, name);
  w->bytes = corpus_read(path, &w->length);
  CHECK_INT(sprout_cartridge_check_header((const unsigned char *)w->bytes, w->length, &w->layout, &refusal), SPROUT_OK);
  CHECK(w->layout.assets_at + w->layout.assets_bytes == w->length);
  w->section = (const unsigned char *)w->bytes + w->layout.assets_at;
  w->count = w->directory_bytes = 0;
  if (w->layout.assets_bytes > 0)
    CHECK(sprout_assets_prefix(w->section, w->layout.assets_bytes, &w->count, &w->directory_bytes));
}

static bool find(const packed_world *w, const char *path, size_t *at, size_t *bytes) {
  return sprout_assets_find(w->section + SPROUT_ASSETS_PREFIX_BYTES, w->directory_bytes, w->count, w->layout.assets_bytes,
                            path, strlen(path), at, bytes);
}

/* The picture at `path`, inflated: its width and height as the packer wrote them, and its length. */
static void picture(const packed_world *w, const char *path, size_t *width, size_t *height, size_t *length) {
  test_heap heap = {0};
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  size_t at = 0, bytes = 0;
  char *out = NULL;
  const char *why = NULL;
  CHECK(find(w, path, &at, &bytes));
  CHECK_INT(sprout_arena_init(&arena, &host), SPROUT_OK);
  CHECK_INT(sprout_gunzip(&arena, w->section + at, bytes, &out, length, &why), SPROUT_OK);
  *width = (unsigned char)out[0] | ((size_t)(unsigned char)out[1] << 8);
  *height = (unsigned char)out[2] | ((size_t)(unsigned char)out[3] << 8);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

static void each_picture_is_found_by_its_path_and_inflates_alone(void) {
  packed_world w;
  size_t width, height, length;
  open_packed(&w, "media-room");
  CHECK_INT(w.count, 3);
  picture(&w, "cellar.png", &width, &height, &length);
  CHECK_INT(width, 64);
  CHECK_INT(height, 40);
  CHECK_INT(length, 4 + 8 * 40);
  picture(&w, "pictures/cabinet.png", &width, &height, &length);
  CHECK_INT(width, 32);
  CHECK_INT(height, 40);
  CHECK_INT(length, 4 + 4 * 40);
  picture(&w, "pictures/cabinet-open.png", &width, &height, &length);
  CHECK_INT(width, 32);
  free(w.bytes);
}

static void a_path_the_directory_does_not_name_is_not_found(void) {
  packed_world w;
  size_t at, bytes;
  open_packed(&w, "media-room");
  CHECK(!find(&w, "gone.png", &at, &bytes));
  CHECK(!find(&w, "cellar", &at, &bytes));
  CHECK(!find(&w, "cabinet.png", &at, &bytes));
  CHECK(!find(&w, "pictures/cabinet.png/", &at, &bytes));
  free(w.bytes);
}

static void a_directory_that_does_not_fit_its_section_finds_nothing(void) {
  packed_world w;
  size_t count, directory_bytes, at, bytes;
  unsigned char *section;
  open_packed(&w, "media-room");
  section = (unsigned char *)w.bytes + w.layout.assets_at;
  CHECK(!sprout_assets_prefix(section, SPROUT_ASSETS_PREFIX_BYTES + w.directory_bytes - 1, &count, &directory_bytes));
  CHECK(!sprout_assets_prefix(section, 4, &count, &directory_bytes));
  /* A directory cut short finds what fits before the cut and nothing after: the cellar's entry is the first, twenty bytes. */
  CHECK(sprout_assets_find(section + SPROUT_ASSETS_PREFIX_BYTES, 20, w.count, w.layout.assets_bytes, "cellar.png", 10, &at,
                           &bytes));
  CHECK(!sprout_assets_find(section + SPROUT_ASSETS_PREFIX_BYTES, 12, w.count, w.layout.assets_bytes,
                            "pictures/cabinet.png", 20, &at, &bytes));
  /* A section cut short refuses a file that lies past its end. */
  CHECK(!sprout_assets_find(section + SPROUT_ASSETS_PREFIX_BYTES, w.directory_bytes, w.count,
                            SPROUT_ASSETS_PREFIX_BYTES + w.directory_bytes + 1, "cellar.png", 10, &at, &bytes));
  /* A file said to lie inside the directory is refused. */
  memset(section + SPROUT_ASSETS_PREFIX_BYTES, 0, 4);
  CHECK(!find(&w, "cellar.png", &at, &bytes));
  free(w.bytes);
}

static void a_world_that_names_no_file_has_no_section(void) {
  packed_world w;
  size_t at, bytes;
  open_packed(&w, "chip-tree");
  CHECK_INT(w.layout.assets_bytes, 0);
  CHECK_INT(w.layout.assets_at, w.length);
  CHECK(!find(&w, "cellar.png", &at, &bytes));
  free(w.bytes);
}

int main(void) {
  RUN(each_picture_is_found_by_its_path_and_inflates_alone);
  RUN(a_path_the_directory_does_not_name_is_not_found);
  RUN(a_directory_that_does_not_fit_its_section_finds_nothing);
  RUN(a_world_that_names_no_file_has_no_section);
  return REPORT();
}
