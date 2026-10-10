/* What the C tests share; see support.h. */
#include "support.h"

#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#include "bridge.h"
#include "pd_host.h"

int test_checks, test_failures;
fake_playdate *fake;

static char program[80], root[400];
static int scenarios;
static bool bridged;
static player_session *owned;

void test_program(const char *name) {
  snprintf(program, sizeof program, "%s", name);
}

/* Where the scenarios' folders are: PLAYER_KEEP_DIR where the build keeps them, else a new folder. */
static void make_root(void) {
  const char *keep_dir = getenv("PLAYER_KEEP_DIR");
  if (root[0] != '\0') return;
  if (keep_dir != NULL) {
    snprintf(root, sizeof root, "%s", keep_dir);
  } else {
    snprintf(root, sizeof root, "/tmp/sprout-player-test-XXXXXX");
    if (mkdtemp(root) == NULL) exit(2);
  }
}

void begin(const char *scenario) {
  char data[520], clear[560];
  make_root();
  snprintf(data, sizeof data, "%s/%s-%s", root, program, scenario);
  snprintf(clear, sizeof clear, "rm -rf '%s'", data);
  CHECK(system(clear) == 0, "clearing %s", data);
  mkdir(data, 0777);
  fake = (fake_playdate *)calloc(1, sizeof *fake);
  fake_init(fake, data, PLAYER_CARTRIDGES);
  bridged = false;
  owned = NULL;
  scenarios++;
}

void begin_bridge(const char *scenario) {
  begin(scenario);
  CHECK(player_register(&fake->api), "registering");
  bridged = true;
}

void end(void) {
  if (bridged) player_shutdown();
  if (owned != NULL) player_session_free(owned);
  CHECK(fake->pages == 0, "%d pages still out at the end", fake->pages);
  free(fake);
  fake = NULL;
}

char *keep(const char *reply) {
  static char replies[8][1 << 17];
  static int next;
  char *copy = replies[next++ % 8];
  CHECK(reply != NULL, "a call returned nothing");
  if (reply == NULL) {
    copy[0] = '\0';
    return copy;
  }
  snprintf(copy, sizeof replies[0], "%s", reply);
  return copy;
}

char *call(const char *name, const char *argument) { return keep(fake_call(fake, name, argument)); }

char *call3(const char *name, const char *first, const char *second, const char *third) {
  const char *const arguments[3] = {first, second, third};
  return keep(fake_call_with(fake, name, 3, arguments));
}

player_session *session_new(void) {
  owned = player_session_new(&fake->api);
  CHECK(owned != NULL, "a session");
  return owned;
}

char *file_text(const char *path) {
  char full[1000];
  FILE *file;
  long size;
  char *text;
  snprintf(full, sizeof full, "%s/%s", fake->data, path);
  file = fopen(full, "rb");
  if (file == NULL) return NULL;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  text = (char *)malloc((size_t)size + 1);
  CHECK(fread(text, 1, (size_t)size, file) == (size_t)size, "reading %s", full);
  text[size] = '\0';
  fclose(file);
  return text;
}

void write_text(const char *path, const char *text) {
  char full[1000];
  FILE *file;
  snprintf(full, sizeof full, "%s/%s", fake->data, path);
  file = fopen(full, "wb");
  CHECK(file != NULL, "writing %s", full);
  if (file == NULL) return;
  fputs(text, file);
  fclose(file);
}

bool exists(const char *path) {
  char full[1000];
  snprintf(full, sizeof full, "%s/%s", fake->data, path);
  return access(full, F_OK) == 0;
}

void save_paths(const char *opened, char *state, char *log, size_t size) {
  const char *hash = strstr(opened, "\"hash\":\"");
  char digits[65];
  CHECK(hash != NULL, "open said no hash: %s", opened);
  if (hash == NULL) return;
  memcpy(digits, hash + 8, 64);
  digits[64] = '\0';
  snprintf(state, size, "saves/%s.json", digits);
  snprintf(log, size, "saves/%s.log", digits);
}

/* ---- JSON ---- */

static sprout_arena arena;
static player_host json_host;

void json_begin(void) {
  player_host_init(&json_host, &fake->api);
  sprout_arena_init(&arena, &json_host.record);
}

void json_end(void) { sprout_arena_reset(&arena); }

const sprout_json *parse(const char *text) {
  sprout_json *node = NULL;
  sprout_json_error error;
  CHECK(sprout_json_read(&arena, text, strlen(text), &node, &error) == SPROUT_OK, "bad JSON: %s", text);
  return node;
}

const char *string_at(const sprout_json *node, const char *key) {
  const sprout_json *member = node == NULL ? NULL : sprout_json_get(node, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : "";
}

const char *line_text(const sprout_json *reply, size_t index) {
  const sprout_json *lines = sprout_json_get(reply, "lines");
  return lines != NULL && index < lines->count ? string_at(lines->items[index], "text") : "";
}

const char *line_kind(const sprout_json *reply, size_t index) {
  const sprout_json *lines = sprout_json_get(reply, "lines");
  return lines != NULL && index < lines->count ? string_at(lines->items[index], "kind") : "";
}

size_t line_count(const sprout_json *reply) {
  const sprout_json *lines = sprout_json_get(reply, "lines");
  return lines == NULL ? 0 : lines->count;
}

void reading_from(const char *view_text, const char *verb, const char *thing, char *out, size_t size) {
  const sprout_json *view = parse(view_text), *chips = sprout_json_get(view, "chips");
  size_t v, c;
  out[0] = '\0';
  for (v = 0; chips != NULL && v < chips->count; v++) {
    const char *name = string_at(chips->items[v], "verb");
    const sprout_json *choices = sprout_json_get(sprout_json_get(chips->items[v], "next"), "choices");
    size_t length = strlen(name), tail = strlen(verb);
    if (length < tail || strcmp(name + length - tail, verb) != 0) continue;
    for (c = 0; choices != NULL && c < choices->count; c++) {
      const sprout_json *filler = sprout_json_get(choices->items[c], "filler");
      const char *bytes;
      size_t written;
      if (strcmp(string_at(filler, "name"), thing) != 0) continue;
      CHECK(sprout_json_write_value(&arena, filler, &bytes, &written) == SPROUT_OK, "writing a filler");
      snprintf(out, size, "{\"verb\":\"%s\",\"fillers\":[%.*s]}", name, (int)written, bytes);
      return;
    }
  }
  CHECK(false, "the view offers no %s %s", verb, thing);
}

int finish(void) {
  printf("%s: %d scenarios, %d checks, %d failed\n", program, scenarios, test_checks, test_failures);
  return test_failures == 0 ? 0 : 1;
}
