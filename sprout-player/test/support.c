/* What the C tests share; see support.h. */
#include "support.h"

#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#include "bridge.h"
#include "host/pd_host.h"

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

char *open_world(const char *path) {
  char *reply = call("sprout.open", path);
  int steps = 0;
  if (!HAS(reply, "\"ok\":true")) return reply;
  do {
    reply = call("sprout.step", NULL);
  } while (HAS(reply, "\"done\":false") && ++steps < 100000);
  return reply;
}

player_opening player_open_whole(player_session *session, const char *path) {
  player_opening answer = player_open(session, path);
  int steps = 0;
  if (!answer.ok) return answer;
  do {
    answer = player_step(session);
  } while (answer.ok && !answer.done && ++steps < 100000);
  return answer;
}

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

void save_paths(const char *hash, char *state, char *log, size_t size) {
  CHECK(hash != NULL && strlen(hash) == 64, "no hash: %s", hash == NULL ? "(null)" : hash);
  snprintf(state, size, "saves/%s.json", hash == NULL ? "" : hash);
  snprintf(log, size, "saves/%s.log", hash == NULL ? "" : hash);
}

void save_paths_of_reply(const char *opened, char *state, char *log, size_t size) {
  const char *hash = strstr(opened, "\"hash\":\"");
  char digits[65];
  CHECK(hash != NULL, "open said no hash: %s", opened);
  if (hash == NULL) return;
  memcpy(digits, hash + 8, 64);
  digits[64] = '\0';
  save_paths(digits, state, log, size);
}

/* ---- readings and what turns told ---- */

sprout_filling fill_object(const char *role, const char *id) {
  sprout_filling filling;
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = SPROUT_FILL_OBJECT;
  filling.id = id;
  return filling;
}

sprout_filling fill_word(const char *role, const char *word) {
  sprout_filling filling;
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = SPROUT_FILL_TEXT;
  filling.text = word;
  return filling;
}

sprout_filling fill_number(const char *role, double number) {
  sprout_filling filling;
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = SPROUT_FILL_NUMBER;
  filling.number = number;
  return filling;
}

sprout_filling fill_exit(const char *role, const char *direction, const char *label, const char *to) {
  sprout_filling filling;
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = SPROUT_FILL_EXIT;
  filling.direction = direction;
  filling.label = label;
  filling.id = to;
  return filling;
}

sprout_filling fill_set(const char *role, size_t count, const char *const *ids) {
  sprout_filling filling;
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = SPROUT_FILL_SET;
  filling.id_count = count;
  filling.ids = ids;
  return filling;
}

player_told turn_of(player_session *session, const char *verb, const char *text, size_t count, const sprout_filling *fillings) {
  sprout_reading reading;
  memset(&reading, 0, sizeof reading);
  reading.verb = verb;
  reading.filling_count = count;
  reading.fillings = fillings;
  return player_turn(session, &reading, text);
}

const char *told_text(const player_told *answer, size_t index) {
  return index < answer->lines.count ? answer->lines.items[index].text : "";
}

const char *told_kind(const player_told *answer, size_t index) {
  return index < answer->lines.count ? answer->lines.items[index].kind : "";
}

bool told_has(const player_told *answer, const char *needle) {
  size_t i;
  for (i = 0; i < answer->lines.count; i++)
    if (HAS(answer->lines.items[i].text, needle)) return true;
  return false;
}

/* The verb whose name ends in `verb` among the last view's, by its 1-based pick; 0 where there is none. */
static size_t verb_pick(player_session *session, const char *verb, const char **name) {
  player_chip_level root = player_chips(session, NULL, 0);
  size_t v, tail = strlen(verb);
  for (v = 0; root.ok && v < root.choice_count; v++) {
    size_t length = strlen(root.choices[v].verb);
    if (length >= tail && strcmp(root.choices[v].verb + length - tail, verb) == 0) {
      *name = root.choices[v].verb;
      return v + 1;
    }
  }
  return 0;
}

bool reading_from(player_session *session, const char *verb, const char *thing, sprout_reading *out) {
  static sprout_filling filling;
  static const char *members[1];
  static char verb_name[200], id[200], role[100];
  const char *name = NULL;
  size_t pick = verb_pick(session, verb, &name), c;
  player_chip_level level;
  memset(out, 0, sizeof *out);
  if (pick == 0) {
    CHECK(false, "the view offers no %s", verb);
    return false;
  }
  snprintf(verb_name, sizeof verb_name, "%s", name);
  level = player_chips(session, &pick, 1);
  for (c = 0; level.ok && c < level.choice_count; c++) {
    const sprout_seen_filler *filler = level.choices[c].filler;
    const sprout_seen_thing *named = filler->binds == SPROUT_SEEN_SET && filler->member_count > 0 ? &filler->members[0] : &filler->thing;
    if (filler->binds != SPROUT_SEEN_OBJECT && filler->binds != SPROUT_SEEN_SET) continue;
    if (named->name.length != strlen(thing) || memcmp(named->name.bytes, thing, named->name.length) != 0) continue;
    snprintf(id, sizeof id, "%.*s", (int)named->id.length, named->id.bytes);
    snprintf(role, sizeof role, "%s", filler->role);
    members[0] = id;
    filling = filler->binds == SPROUT_SEEN_SET ? fill_set(role, 1, members) : fill_object(role, id);
    out->verb = verb_name;
    out->filling_count = 1;
    out->fillings = &filling;
    return true;
  }
  CHECK(false, "the view offers no %s %s", verb, thing);
  return false;
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

int finish(void) {
  printf("%s: %d scenarios, %d checks, %d failed\n", program, scenarios, test_checks, test_failures);
  return test_failures == 0 ? 0 : 1;
}
