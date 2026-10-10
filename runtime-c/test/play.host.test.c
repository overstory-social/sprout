/* Tests for host/play.c: `sproutc play` on a corpus world, with and without a script, and its refusals in words. */
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
  char path[1024];
  FILE *file;
  unsigned char *bytes;
  snprintf(path, sizeof path, "%s/printers_shop.sproutworld", SPROUT_CARTRIDGES);
  file = fopen(path, "rb");
  if (file == NULL) exit(2);
  fseek(file, 0, SEEK_END);
  length = (size_t)ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (unsigned char *)malloc(length);
  if (bytes == NULL || fread(bytes, 1, length, file) != length) exit(2);
  fclose(file);
  put(WORLD, bytes, length);
  free(bytes);
}

static char *slurp(const char *path) {
  static char text[1 << 17];
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

static void the_header_and_manifest_are_printed_and_the_world_loads(void) {
  char *argv[] = {"play", (char *)WORLD};
  put_world();
  CHECK_INT(run(2, argv), 0);
  CHECK(strstr(slurp(OUT), "name: printers_shop\n") != NULL);
  CHECK(strstr(slurp(OUT), "libraries: 1\n  sprout 0.1.0 ") != NULL);
  CHECK(strstr(slurp(OUT), "load:") == NULL);
  CHECK_STR(slurp(ERR), "");
  remove(WORLD);
}

static void a_script_plays_its_steps_through_the_turn_call_and_traces_each(void) {
  const char *trace = "sproutc-play-test.trace";
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT, "--clock", "5", "--trace", (char *)trace};
  const char *readings =
      "{\"format\":1,\"script\":\"s.json\",\"steps\":["
      "{\"index\":0,\"line\":\"# hello\",\"atSeconds\":0,\"seed\":0,\"kind\":\"comment\"},"
      "{\"index\":1,\"line\":\"@arrive Ines\",\"atSeconds\":0,\"seed\":0,\"kind\":\"arrive\",\"nickname\":\"Ines\"},"
      "{\"index\":2,\"line\":\"@leave Ines\",\"atSeconds\":5,\"seed\":0,\"kind\":\"leave\",\"nickname\":\"Ines\"}]}";
  static char output[1 << 17];
  put_world();
  put(SCRIPT, "{\"steps\":[]}", 12);
  put(READINGS, readings, strlen(readings));
  CHECK_INT(run(8, argv), 0);
  strcpy(output, slurp(OUT));
  CHECK(strstr(output, "--- play\n## step 1: @arrive Ines\nInes (described): Lead and lamp oil.") != NULL);
  CHECK(strstr(output, "## step 2: @leave Ines\nInes (notice): You leave, and take what you carry with you.\n") != NULL);
  CHECK(strstr(output, "## step 0") == NULL);
  strcpy(output, slurp(trace));
  CHECK(strstr(output, "{\"step\":1,\"says\":[{\"reader\":\"Ines\",\"kind\":\"described\",") == output);
  CHECK(strstr(output, "{\"kind\":\"maintenance\",\"seed\":0,\"seconds\":0,") != NULL);
  CHECK(strstr(output, "{\"kind\":\"arrival\",\"seed\":0,\"seconds\":0,\"who\":\"visit:Ines\",\"outcome\":\"done\"") != NULL);
  CHECK(strstr(output, "\n{\"step\":2,") != NULL);
  CHECK(strstr(output, "{\"kind\":\"departure\",\"seed\":0,\"seconds\":5,") != NULL);
  CHECK(strstr(output, "\"world\":{\"world\":\"printers_shop\"") != NULL);
  remove(WORLD);
  remove(SCRIPT);
  remove(READINGS);
  remove(trace);
}

static void a_call_the_runtime_refuses_ends_the_play_with_its_words(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT};
  const char *readings =
      "{\"format\":1,\"script\":\"s.json\",\"steps\":["
      "{\"index\":0,\"line\":\"@leave Ines\",\"atSeconds\":0,\"seed\":0,\"kind\":\"leave\",\"nickname\":\"Ines\"}]}";
  put_world();
  put(SCRIPT, "{\"steps\":[]}", 12);
  put(READINGS, readings, strlen(readings));
  CHECK_INT(run(4, argv), 1);
  CHECK(strstr(slurp(OUT), "## step 0: @leave Ines\n!! `visit:Ines` has never visited this world.\n") != NULL);
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

static void a_stored_world_is_read_opened_and_written_back_and_a_second_pass_changes_nothing(void) {
  size_t length;
  const char *state = "sproutc-play-test-state.json";
  char *argv[] = {"play", (char *)WORLD, "--state", (char *)state};
  char *canon = test_golden("stored-canon.json", &length);
  char first[16384], second[16384];
  put_world();
  put(state, canon, length);
  CHECK_INT(run(4, argv), 0);
  CHECK(strstr(slurp(OUT), "state: 16 instances, 1 visitors, 1 dormant, 2 dropped\n") != NULL);
  strcpy(first, slurp(state));
  CHECK(strstr(first, "\"world\":\"printers_shop\"") != NULL);
  CHECK_INT(run(4, argv), 0);
  strcpy(second, slurp(state));
  CHECK_STR(second, first);
  CHECK(strstr(slurp(OUT), "1 dormant, 0 dropped\n") != NULL);
  free(canon);
  remove(state);
  remove(WORLD);
}

static void a_store_that_is_not_readable_or_is_another_worlds_is_refused_in_words(void) {
  const char *state = "sproutc-play-test-state.json";
  char *argv[] = {"play", (char *)WORLD, "--state", (char *)state};
  const char *other = "{\"world\":\"teashop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}";
  put_world();
  put(state, other, strlen(other));
  CHECK_INT(run(4, argv), 1);
  CHECK(strstr(slurp(ERR), "sproutc-play-test-state.json: The stored state is not readable: the store holds `teashop`, and this is `printers_shop`.") != NULL);
  put(state, "{", 1);
  CHECK_INT(run(4, argv), 1);
  CHECK(strstr(slurp(ERR), "the store is not JSON") != NULL);
  remove(state);
  remove(WORLD);
}

static void a_cartridge_the_runtime_refuses_is_refused_with_its_words(void) {
  unsigned char *bytes;
  size_t length;
  char *argv[] = {"play", (char *)WORLD};
  bytes = build_cartridge(EMPTY_BODIED_JSON, 1, 1, &length);
  put(WORLD, bytes, length);
  free(bytes);
  CHECK_INT(run(2, argv), 1);
  CHECK(strstr(slurp(ERR), "sproutc-play-test.sproutworld: This cartridge is not shaped as a cartridge is") != NULL);
  remove(WORLD);
}

int main(void) {
  RUN(the_header_and_manifest_are_printed_and_the_world_loads);
  RUN(a_script_plays_its_steps_through_the_turn_call_and_traces_each);
  RUN(a_call_the_runtime_refuses_ends_the_play_with_its_words);
  RUN(a_stored_world_is_read_opened_and_written_back_and_a_second_pass_changes_nothing);
  RUN(a_store_that_is_not_readable_or_is_another_worlds_is_refused_in_words);
  RUN(a_cartridge_the_runtime_refuses_is_refused_with_its_words);
  RUN(a_script_with_no_readings_beside_it_is_refused_in_words);
  RUN(a_bad_command_line_and_a_bad_file_are_refused_in_words);
  remove(OUT);
  remove(ERR);
  return REPORT();
}
