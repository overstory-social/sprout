/* What the C tests share; see support.h. */
#include "support.h"

#include "host/pd_host.h"
#include "inflate.h"

#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

int test_checks, test_failures;
fake_playdate *fake;

static char program[80], root[400];
static int scenarios;
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
  owned = NULL;
  scenarios++;
}

void end(void) {
  if (owned != NULL) player_session_free(owned);
  CHECK(fake->pages == 0, "%d pages still out at the end", fake->pages);
  free(fake);
  fake = NULL;
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

void ship(const char *const *names, size_t count) {
  char command[2000];
  size_t i;
  snprintf(command, sizeof command, "mkdir -p '%s/worlds'", fake->data);
  CHECK(system(command) == 0, "%s", command);
  for (i = 0; i < count; i++) {
    snprintf(command, sizeof command, "cp '%s/%s' '%s/worlds/'", PLAYER_CARTRIDGES, names[i], fake->data);
    CHECK(system(command) == 0, "%s", command);
  }
}

void app_folder(const char *name) {
  char command[1200];
  snprintf(fake->app, sizeof fake->app, "%s-%s", fake->data, name);
  snprintf(command, sizeof command, "rm -rf '%s' && mkdir -p '%s'", fake->app, fake->app);
  CHECK(system(command) == 0, "%s", command);
}

char *fixture_text(const char *name) {
  char full[1000];
  FILE *file;
  long size;
  char *text;
  snprintf(full, sizeof full, "%s/%s", PLAYER_FIXTURES, name);
  file = fopen(full, "rb");
  CHECK(file != NULL, "the fixture %s", full);
  if (file == NULL) return calloc(1, 1);
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  text = (char *)malloc((size_t)size + 1);
  CHECK(fread(text, 1, (size_t)size, file) == (size_t)size, "reading %s", full);
  while (size > 0 && text[size - 1] == '\n') size--;
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
  return player_turn(session, &reading, text, false);
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

/* ---- builds of one world ---- */

/* `bytes` as one gzip member of stored blocks, into `out`, which has room for `length` and 5 bytes a block and 18 more. */
static size_t gzip_stored(const unsigned char *bytes, size_t length, unsigned char *out) {
  static const unsigned char HEADER[10] = {0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff};
  uint32_t crc = sprout_crc32(0, bytes, length);
  size_t at = sizeof HEADER, done = 0, i;
  memcpy(out, HEADER, sizeof HEADER);
  do {
    size_t block = length - done < 65535 ? length - done : 65535;
    out[at++] = done + block == length ? 1 : 0;
    out[at++] = (unsigned char)(block & 0xff);
    out[at++] = (unsigned char)(block >> 8);
    out[at++] = (unsigned char)(~block & 0xff);
    out[at++] = (unsigned char)((~block >> 8) & 0xff);
    memcpy(out + at, bytes + done, block);
    at += block;
    done += block;
  } while (done < length);
  for (i = 0; i < 4; i++) out[at++] = (unsigned char)((crc >> (8 * i)) & 0xff);
  for (i = 0; i < 4; i++) out[at++] = (unsigned char)(((uint32_t)length >> (8 * i)) & 0xff);
  return at;
}

/* Overwrites the first `from` in `text` with `to`, of the same length; whether there was one. */
static bool overwrite(char *text, const char *from, const char *to) {
  char *at = strstr(text, from);
  CHECK(at != NULL && strlen(from) == strlen(to), "the teashop's header has %s", from);
  if (at == NULL || strlen(from) != strlen(to)) return false;
  memcpy(at, to, strlen(to));
  return true;
}

static uint32_t word_at(const unsigned char *bytes) {
  return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void put_word(unsigned char *bytes, size_t value) {
  size_t i;
  for (i = 0; i < 4; i++) bytes[i] = (unsigned char)((value >> (8 * i)) & 0xff);
}

void build_of(const char *path, const char *version, const char *author, char digit) {
  char from[1200], to[1200], field[64];
  FILE *file;
  long size;
  unsigned char *cartridge = NULL, *gzipped = NULL;
  char *body = NULL;
  size_t body_bytes = 0, assets_at, gzipped_bytes;
  const char *why = NULL;
  player_host host;
  sprout_arena arena;
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  snprintf(from, sizeof from, "%s/teashop.sproutworld", PLAYER_CARTRIDGES);
  snprintf(to, sizeof to, "mkdir -p '%s/worlds'", fake->data);
  CHECK(system(to) == 0, "%s", to);
  snprintf(to, sizeof to, "%s/%s", fake->data, path);
  file = fopen(from, "rb");
  CHECK(file != NULL, "%s", from);
  if (file == NULL) return;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  cartridge = (unsigned char *)malloc((size_t)size);
  CHECK(fread(cartridge, 1, (size_t)size, file) == (size_t)size, "reading %s", from);
  fclose(file);
  assets_at = word_at(cartridge + 16);
  CHECK(sprout_gunzip(&arena, cartridge + 24, assets_at - 24, &body, &body_bytes, &why) == SPROUT_OK, "%s", why);
  snprintf(field, sizeof field, "\"version\":\"%s\"", version);
  if (body != NULL && overwrite(body, "\"version\":\"0.1.0\"", field)) {
    snprintf(field, sizeof field, "\"author\":\"%s\"", author);
    overwrite(body, "\"author\":\"Ada\"", field);
    {
      /* The hash's first digit, whatever the packed teashop's is. */
      char *hash = strstr(body, "\"hash\":\"");
      CHECK(hash != NULL, "the teashop's header has a hash");
      if (hash != NULL) hash[8] = digit;
    }
    gzipped = (unsigned char *)malloc(body_bytes + 5 * (body_bytes / 65535 + 1) + 18);
    gzipped_bytes = gzip_stored((const unsigned char *)body, body_bytes, gzipped);
    put_word(cartridge + 16, 24 + gzipped_bytes);
    file = fopen(to, "wb");
    CHECK(file != NULL, "%s", to);
    if (file != NULL) {
      fwrite(cartridge, 1, 24, file);
      fwrite(gzipped, 1, gzipped_bytes, file);
      fwrite(cartridge + assets_at, 1, (size_t)size - assets_at, file);
      fclose(file);
    }
  }
  free(gzipped);
  free(cartridge);
  sprout_arena_reset(&arena);
}

/* ---- JSON ---- */

const char *string_at(const sprout_json *node, const char *key) {
  const sprout_json *member = node == NULL ? NULL : sprout_json_get(node, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : "";
}

int finish(void) {
  printf("%s: %d scenarios, %d checks, %d failed\n", program, scenarios, test_checks, test_failures);
  return test_failures == 0 ? 0 : 1;
}

bool shipped_font(const char *font) {
  char path[512];
  size_t length = strlen(font);
  FILE *file;
  if (strncmp(font, "fonts/", 6) != 0 || length < 10 || strcmp(font + length - 4, ".pft") != 0) return false;
  snprintf(path, sizeof path, "%s/../../Source/%.*s.fnt", PLAYER_FIXTURES, (int)(length - 4), font);
  file = fopen(path, "rb");
  if (file == NULL) return false;
  fclose(file);
  return true;
}
