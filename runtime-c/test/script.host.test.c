/*
 * Tests for host/script.c: a script's steps driven through the turn call. A tick tells each place that holds a visitor, time moved on delivers nothing while nobody
 * stands in the world, and a departure empties it; a typed line is read by the runtime, a turn to each command;
 * each step prints what it told.
 */
#include "play.h"
#include "check.h"

static const char *WORLD = "sproutc-script-test.sproutworld";
static const char *OUT = "sproutc-script-test.out";
static const char *ERR = "sproutc-script-test.err";
static const char *SCRIPT = "sproutc-script-test.json";

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
  snprintf(path, sizeof path, "%s/turn-faults.sproutworld", SPROUT_CARTRIDGES);
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

static int run(int argc, char **argv) {
  FILE *out = fopen(OUT, "wb"), *err = fopen(ERR, "wb");
  int code = sproutc_main(argc, argv, out, err);
  fclose(out);
  fclose(err);
  return code;
}

static void a_tick_tells_the_places_that_hold_a_visitor_and_a_departure_empties_the_world(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT};
  const char *script =
      "{\"steps\":[{\"arrive\":\"Marta\"},{\"tick\":true},{\"advance\":\"1 hour\"},{\"leave\":\"Marta\"},{\"tick\":true}]}";
  static char output[1 << 17];
  put_world();
  put(SCRIPT, script, strlen(script));
  CHECK_INT(run(4, argv), 0);
  strcpy(output, slurp(OUT));
  CHECK(strstr(output, "## step 1: @tick\nMarta (told): The porch boards creak.\n") != NULL);
  CHECK(strstr(output, "## step 3: @leave Marta\nMarta (notice): You leave, and take what you carry with you.\n") != NULL);
  CHECK(strstr(output, "## step 4: @tick\n## step") == NULL);
  CHECK_STR(slurp(ERR), "");
  remove(WORLD);
  remove(SCRIPT);
}

/* A typed line is read by the runtime, each command a turn: a line it cannot read is answered, and ends the line. */
static void a_typed_line_is_read_by_the_runtime_as_the_turns_it_runs(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT};
  const char *script =
      "{\"steps\":[{\"arrive\":\"Marta\"},{\"as\":\"Marta\",\"type\":\"look then look\"},"
      "{\"as\":\"Marta\",\"type\":\"plugh. look\"}]}";
  static char output[1 << 17];
  const char *step, *last;
  put_world();
  put(SCRIPT, script, strlen(script));
  CHECK_INT(run(4, argv), 0);
  strcpy(output, slurp(OUT));
  step = strstr(output, "## step 1: Marta> look then look\n");
  last = strstr(output, "## step 2: Marta> plugh. look\n");
  CHECK(step != NULL && last != NULL);
  if (step != NULL && last != NULL) {
    const char *first = strstr(step, "Marta (described):"), *second = first == NULL ? NULL : strstr(first + 1, "Marta (described):");
    CHECK(second != NULL && second < last);
    CHECK_STR(last, "## step 2: Marta> plugh. look\nMarta (notice): That is not something you can do here.\n");
  }
  CHECK_STR(slurp(ERR), "");
  remove(WORLD);
  remove(SCRIPT);
}

/* With --offered each reading the runtime reads a turn as is looked for in the view polled before it, under --poll-steps. */
static void offered_holds_each_reading_to_the_view_polled_before_it(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT, "--offered"};
  char *starved[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT, "--offered", "--poll-steps", "1"};
  const char *script =
      "{\"steps\":[{\"arrive\":\"Marta\"},{\"as\":\"Marta\",\"type\":\"look then look\"},"
      "{\"as\":\"Marta\",\"type\":\"plugh\"}]}";
  put_world();
  put(SCRIPT, script, strlen(script));
  CHECK_INT(run(5, argv), 0);
  CHECK(strstr(slurp(OUT), "--- offered: 2 of 2 readings, the widest poll ") != NULL);
  CHECK_STR(slurp(ERR), "");
  CHECK_INT(run(7, starved), 1);
  CHECK(strstr(slurp(OUT), "--- offered: 0 of 2 readings") != NULL);
  CHECK(strstr(slurp(ERR), "sproutc: step 1: the poll before `look` faulted") != NULL);
  remove(WORLD);
  remove(SCRIPT);
}

int main(void) {
  RUN(a_tick_tells_the_places_that_hold_a_visitor_and_a_departure_empties_the_world);
  RUN(a_typed_line_is_read_by_the_runtime_as_the_turns_it_runs);
  RUN(offered_holds_each_reading_to_the_view_polled_before_it);
  remove(OUT);
  remove(ERR);
  return REPORT();
}
