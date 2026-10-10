/*
 * Tests for host/script.c: a script's steps driven through the turn call on the world the TypeScript player
 * drives them on. A tick tells each place that holds a visitor, time moved on delivers nothing while nobody
 * stands in the world, and a departure empties it; each step prints what it told.
 */
#include "play.h"
#include "check.h"

static const char *WORLD = "sproutc-script-test.sproutworld";
static const char *OUT = "sproutc-script-test.out";
static const char *ERR = "sproutc-script-test.err";
static const char *SCRIPT = "sproutc-script-test.json";
static const char *READINGS = "sproutc-script-test.readings.json";

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
  const char *readings =
      "{\"format\":1,\"script\":\"s.json\",\"steps\":["
      "{\"index\":0,\"line\":\"@arrive Marta\",\"atSeconds\":0,\"seed\":0,\"kind\":\"arrive\",\"nickname\":\"Marta\"},"
      "{\"index\":1,\"line\":\"@tick\",\"atSeconds\":10,\"seed\":0,\"kind\":\"tick\"},"
      "{\"index\":2,\"line\":\"@advance 1 hour\",\"atSeconds\":3610,\"seed\":0,\"kind\":\"advance\",\"forSeconds\":3600},"
      "{\"index\":3,\"line\":\"@leave Marta\",\"atSeconds\":3610,\"seed\":0,\"kind\":\"leave\",\"nickname\":\"Marta\"},"
      "{\"index\":4,\"line\":\"@tick\",\"atSeconds\":3620,\"seed\":0,\"kind\":\"tick\"}]}";
  static char output[1 << 17];
  put_world();
  put(SCRIPT, "{\"steps\":[]}", 12);
  put(READINGS, readings, strlen(readings));
  CHECK_INT(run(4, argv), 0);
  strcpy(output, slurp(OUT));
  CHECK(strstr(output, "## step 1: @tick\nMarta (told): The porch boards creak.\n") != NULL);
  CHECK(strstr(output, "## step 3: @leave Marta\nMarta (notice): You leave, and take what you carry with you.\n") != NULL);
  CHECK(strstr(output, "## step 4: @tick\n## step") == NULL);
  CHECK_STR(slurp(ERR), "");
  remove(WORLD);
  remove(SCRIPT);
  remove(READINGS);
}

static void a_step_that_the_parser_answered_is_echoed_not_run(void) {
  char *argv[] = {"play", (char *)WORLD, "--script", (char *)SCRIPT};
  const char *readings =
      "{\"format\":1,\"script\":\"s.json\",\"steps\":["
      "{\"index\":0,\"line\":\"@arrive Marta\",\"atSeconds\":0,\"seed\":0,\"kind\":\"arrive\",\"nickname\":\"Marta\"},"
      "{\"index\":1,\"line\":\"plugh\",\"atSeconds\":0,\"seed\":0,\"kind\":\"command\",\"nickname\":\"Marta\",\"turns\":["
      "{\"typed\":\"plugh\",\"seed\":0,\"skip\":true,\"why\":\"Nothing happens.\","
      "\"says\":[{\"reader\":\"Marta\",\"kind\":\"notice\",\"words\":\"I do not know that word.\"}]}]}]}";
  static char output[1 << 17];
  put_world();
  put(SCRIPT, "{\"steps\":[]}", 12);
  put(READINGS, readings, strlen(readings));
  CHECK_INT(run(4, argv), 0);
  strcpy(output, slurp(OUT));
  CHECK(strstr(output, "Marta (notice): I do not know that word.\n") != NULL);
  remove(WORLD);
  remove(SCRIPT);
  remove(READINGS);
}

int main(void) {
  RUN(a_tick_tells_the_places_that_hold_a_visitor_and_a_departure_empties_the_world);
  RUN(a_step_that_the_parser_answered_is_echoed_not_run);
  remove(OUT);
  remove(ERR);
  return REPORT();
}
