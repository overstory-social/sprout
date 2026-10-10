/* Tests for host/cartridge.c: the prefix and the header section of an empty-bodied cartridge. */
#include "cartridge.h"
#include "cartridge_fixture.h"
#include "host.h"

static char *described(const unsigned char *bytes, size_t length, const char **why) {
  static char text[2048];
  sproutc_host host;
  FILE *file = tmpfile();
  size_t n;
  sproutc_host_init(&host, file, NULL);
  *why = sproutc_cartridge_describe(file, &host.record, bytes, length);
  CHECK_INT(host.pages, 0);
  fseek(file, 0, SEEK_SET);
  n = fread(text, 1, sizeof text - 1, file);
  text[n] = '\0';
  fclose(file);
  sproutc_host_close(&host);
  return text;
}

static void the_prefix_says_the_format_and_the_language_level(void) {
  size_t length;
  unsigned format = 0, level = 0;
  unsigned char *bytes = build_cartridge(EMPTY_BODIED_JSON, 1, 3, &length);
  CHECK(sproutc_cartridge_prefix(bytes, length, &format, &level) == NULL);
  CHECK_INT(format, 1);
  CHECK_INT(level, 3);
  free(bytes);
}

static void an_empty_bodied_cartridge_prints_its_header_and_manifest(void) {
  size_t length;
  const char *why;
  unsigned char *bytes = build_cartridge(EMPTY_BODIED_JSON, 1, 1, &length);
  char *text = described(bytes, length, &why);
  CHECK(why == NULL);
  CHECK_STR(text,
            "cartridge format: 1\n"
            "language level: 1\n"
            "name: bare\n"
            "namespace: bare\n"
            "version: 1.2.3\n"
            "author: Ines\n"
            "license: MIT\n"
            "hash: abc123\n"
            "files: 2\n"
            "  bare.sprout\n"
            "  room.sprout\n"
            "libraries: 1\n"
            "  sprout 0.1.0 ff00\n");
  free(bytes);
}

static void a_file_that_is_no_cartridge_is_refused_in_words(void) {
  size_t length;
  const char *why;
  unsigned char *bytes = build_cartridge(EMPTY_BODIED_JSON, 1, 1, &length);
  bytes[0] = 'X';
  described(bytes, length, &why);
  CHECK(why != NULL && strstr(why, "SPRT") != NULL);
  bytes[0] = 'S';
  bytes[4] = 0;
  described(bytes, length, &why);
  CHECK(why != NULL && strstr(why, "format version 0") != NULL);
  free(bytes);
}

static void json_without_a_header_section_is_refused_in_words(void) {
  size_t length;
  const char *why;
  unsigned char *bytes = build_cartridge("{\"kinds\":{}}", 1, 1, &length);
  described(bytes, length, &why);
  CHECK(why != NULL && strstr(why, "no `header` section") != NULL);
  free(bytes);
  bytes = build_cartridge("{\"header\":", 1, 1, &length);
  described(bytes, length, &why);
  CHECK(why != NULL && strstr(why, "would not read") != NULL);
  free(bytes);
}

int main(void) {
  RUN(the_prefix_says_the_format_and_the_language_level);
  RUN(an_empty_bodied_cartridge_prints_its_header_and_manifest);
  RUN(a_file_that_is_no_cartridge_is_refused_in_words);
  RUN(json_without_a_header_section_is_refused_in_words);
  return REPORT();
}
