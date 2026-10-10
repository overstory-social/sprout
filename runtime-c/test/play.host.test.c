/* Tests for host/play.c: `sproutc play` on an empty-bodied cartridge, with and without a script, and its refusals in words. */
#include "play.h"
#include "cartridge_fixture.h"
#include "check.h"

static const char *WORLD = "sproutc-play-test.sproutworld";
static const char *OUT = "sproutc-play-test.out";
static const char *ERR = "sproutc-play-test.err";
static const char *SCRIPT = "sproutc-play-test.json";
static const char *READINGS = "sproutc-play-test.readings.json";

static void put(const char *path, const void *bytes, size_t length) {
  FILE *file = fopen(path, "wb");
  if (file == NULL) exit(2);
  fwrite(bytes, 1, length, file);
  fclose(file);
}

static void put_world(void) {
  size_t length;
  unsigned char *bytes = build_cartridge(EMPTY_BODIED_JSON, 1, 1, &length);
  put(WORLD, bytes, length);
  free(bytes);
}

static char *slurp(const char *path) {
  static char text[4096];
  FILE *file = fopen(path, "rb");
  size_t n = file == NULL ? 0 : fread(text, 1, sizeof text - 1, file);
  text[n] = '\0';
  if (file != NULL) fclose(file);
  return text;
}

/* Runs `sproutc` over argv; the exit code, with the output in OUT and ERR. */
static int run(int argc, char **argv) {
  FILE *out = fopen(OUT, "wb"), *err = fopen(ERR, "wb");
  int code = sproutc_main(argc, argv, out, err);
  fclose(out);
  fclose(err);
  return code;
}

static void the_header_and_manifest_are_printed_and_the_load_that_is_not_built_is_told_in_words(void) {
  char *argv[] = {"play", (char *)WORLD};
  put_world();
  CHECK_INT(run(2, argv), 0);
  CHECK(strstr(slurp(OUT), "name: bare\n") != NULL);
  CHECK(strstr(slurp(OUT), "files: 2\n  bare.sprout\n  room.sprout\n") != NULL);
  CHECK(strstr(slurp(OUT), "load: this part of the runtime is declared and not built yet.\n") != NULL);
  CHECK_STR(slurp(ERR), "");
  remove(WORLD);
}

static void a_script_stops_at_its_first_turn_and_says_so_with_the_not_yet_exit(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT, "--clock", "5"};
  const char *readings =
      "{\"format\":1,\"script\":\"s.json\",\"steps\":["
      "{\"index\":0,\"line\":\"# hello\",\"atSeconds\":0,\"seed\":0,\"kind\":\"comment\"},"
      "{\"index\":1,\"line\":\"@arrive Ines\",\"atSeconds\":0,\"seed\":0,\"kind\":\"arrive\",\"nickname\":\"Ines\"}]}";
  put_world();
  put(SCRIPT, "{\"steps\":[]}", 12);
  put(READINGS, readings, strlen(readings));
  CHECK_INT(run(6, argv), SPROUTC_EXIT_NOT_YET);
  CHECK(strstr(slurp(OUT), "--- play\n## step 1: @arrive Ines\n!! the world is not loaded (") != NULL);
  CHECK(strstr(slurp(OUT), "not built yet.), so the play stops here.\n") != NULL);
  CHECK(strstr(slurp(OUT), "## step 0") == NULL);
  remove(WORLD);
  remove(SCRIPT);
  remove(READINGS);
}

static void a_script_with_no_readings_beside_it_is_refused_in_words(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", "sproutc-no-such-script.json"};
  put_world();
  CHECK_INT(run(4, argv), 1);
  CHECK(strstr(slurp(ERR), "resolve-script") != NULL);
  remove(WORLD);
}

static void a_bad_command_line_and_a_bad_file_are_refused_in_words(void) {
  char *none[] = {"play"};
  char *flag[] = {"play", (char *)WORLD, "--speed"};
  char *clock[] = {"play", (char *)WORLD, "--clock", "soon"};
  char *missing[] = {"play", "sproutc-no-such-world.sproutworld"};
  char *notworld[] = {"play", (char *)SCRIPT};
  CHECK_INT(run(1, none), 2);
  CHECK(strstr(slurp(ERR), "sproutc play <world.sproutworld>") != NULL);
  CHECK_INT(run(3, flag), 2);
  CHECK(strstr(slurp(ERR), "`--speed` is not something") != NULL);
  CHECK_INT(run(4, clock), 2);
  CHECK(strstr(slurp(ERR), "--clock wants a whole number") != NULL);
  CHECK_INT(run(2, missing), 1);
  CHECK(strstr(slurp(ERR), "cannot read") != NULL);
  put(SCRIPT, "not a cartridge at all, but long enough to have a header.", 56);
  CHECK_INT(run(2, notworld), 1);
  CHECK(strstr(slurp(ERR), "does not begin with `SPRT`") != NULL);
  remove(SCRIPT);
}

int main(void) {
  RUN(the_header_and_manifest_are_printed_and_the_load_that_is_not_built_is_told_in_words);
  RUN(a_script_stops_at_its_first_turn_and_says_so_with_the_not_yet_exit);
  RUN(a_script_with_no_readings_beside_it_is_refused_in_words);
  RUN(a_bad_command_line_and_a_bad_file_are_refused_in_words);
  remove(OUT);
  remove(ERR);
  return REPORT();
}
