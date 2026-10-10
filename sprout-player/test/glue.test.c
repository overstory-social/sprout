/*
 * The C glue against a fake PlaydateAPI: the functions Lua calls, called as Lua calls them, over
 * corpus cartridges the build packed. Each scenario is one visitor in one world, the way the
 * device holds it; chip-tree is replayed against the transcript the TypeScript player wrote.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "bridge.h"
#include "budgets.h"
#include "fake_playdate.h"
#include "json.h"
#include "pd_host.h"
#include "world.h"

static int failures, checks;

#define CHECK(condition, ...)                                              \
  do {                                                                     \
    checks++;                                                              \
    if (!(condition)) {                                                    \
      failures++;                                                          \
      fprintf(stderr, "FAIL %s:%d: %s\n  ", __FILE__, __LINE__, #condition); \
      fprintf(stderr, __VA_ARGS__);                                        \
      fputc('\n', stderr);                                                 \
    }                                                                      \
  } while (0)

#define HAS(text, needle) (strstr((text), (needle)) != NULL)

static fake_playdate *fake;
static char root[400];
static int scenario_count;

/* ---- scenarios' world ---- */

static void begin(const char *name) {
  char data[480];
  char clear[520];
  snprintf(data, sizeof data, "%s/%s", root, name);
  snprintf(clear, sizeof clear, "rm -rf '%s'", data);
  CHECK(system(clear) == 0, "clearing %s", data);
  mkdir(data, 0777);
  fake = (fake_playdate *)calloc(1, sizeof *fake);
  fake_init(fake, data, PLAYER_CARTRIDGES);
  CHECK(player_register(&fake->api), "registering");
  scenario_count++;
}

static void end(void) {
  player_shutdown();
  CHECK(fake->pages == 0, "%d pages still out after the player shut down", fake->pages);
  free(fake);
  fake = NULL;
}

/* Calls a registered function and copies the reply, which the next call overwrites. */
static char *call(const char *name, const char *argument) {
  static char replies[8][1 << 17];
  static int next;
  const char *reply = fake_call(fake, name, argument);
  char *copy = replies[next++ % 8];
  CHECK(reply != NULL, "%s returned nothing", name);
  if (reply == NULL) {
    copy[0] = '\0';
    return copy;
  }
  snprintf(copy, sizeof replies[0], "%s", reply);
  return copy;
}

static char *file_text(const char *path) {
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

static void write_text(const char *path, const char *text) {
  char full[1000];
  FILE *file;
  snprintf(full, sizeof full, "%s/%s", fake->data, path);
  file = fopen(full, "wb");
  CHECK(file != NULL, "writing %s", full);
  if (file == NULL) return;
  fputs(text, file);
  fclose(file);
}

static bool exists(const char *path) {
  char full[1000];
  snprintf(full, sizeof full, "%s/%s", fake->data, path);
  return access(full, F_OK) == 0;
}

/* The save's path for a cartridge's hash, found from the reply to open. */
static void save_paths(const char *opened, char *state, char *log, size_t size) {
  const char *hash = strstr(opened, "\"hash\":\"");
  char digits[65];
  CHECK(hash != NULL, "open said no hash: %s", opened);
  if (hash == NULL) return;
  memcpy(digits, hash + 8, 64);
  digits[64] = '\0';
  snprintf(state, size, "saves/%s.json", digits);
  snprintf(log, size, "saves/%s.log", digits);
}

/* ---- JSON for the checks ---- */

static sprout_arena arena;
static player_host json_host;

static void json_begin(void) {
  player_host_init(&json_host, &fake->api);
  sprout_arena_init(&arena, &json_host.record);
}

static void json_end(void) { sprout_arena_reset(&arena); }

static const sprout_json *parse(const char *text) {
  sprout_json *root_node = NULL;
  sprout_json_error error;
  CHECK(sprout_json_read(&arena, text, strlen(text), &root_node, &error) == SPROUT_OK, "bad JSON: %s", text);
  return root_node;
}

static const char *string_at(const sprout_json *node, const char *key) {
  const sprout_json *member = node == NULL ? NULL : sprout_json_get(node, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : "";
}

/* The text of line `index` of a reply's `lines`, or "". */
static const char *line_text(const sprout_json *reply, size_t index) {
  const sprout_json *lines = sprout_json_get(reply, "lines");
  return lines != NULL && index < lines->count ? string_at(lines->items[index], "text") : "";
}

static const char *line_kind(const sprout_json *reply, size_t index) {
  const sprout_json *lines = sprout_json_get(reply, "lines");
  return lines != NULL && index < lines->count ? string_at(lines->items[index], "kind") : "";
}

static size_t line_count(const sprout_json *reply) {
  const sprout_json *lines = sprout_json_get(reply, "lines");
  return lines == NULL ? 0 : lines->count;
}

/*
 * A reading for the sentence builder from a view: the verb whose name ends in `verb`, and the
 * choice whose filler is named `thing`, as the builder hands it over. Written into `out`.
 */
static void reading_from(const char *view_text, const char *verb, const char *thing, char *out, size_t size) {
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

/* ---- the scenarios ---- */

static void registers_every_function(void) {
  static const char *const names[] = {"sprout.inspect", "sprout.open", "sprout.load", "sprout.admit", "sprout.view",
                                      "sprout.turn",    "sprout.tick", "sprout.save", "sprout.close"};
  size_t i;
  begin("register");
  CHECK(fake->function_count == 9, "registered %d functions", fake->function_count);
  for (i = 0; i < sizeof names / sizeof *names; i++) {
    int j;
    bool found = false;
    for (j = 0; j < fake->function_count; j++) found = found || strcmp(fake->names[j], names[i]) == 0;
    CHECK(found, "%s is not registered", names[i]);
  }
  end();
}

static void every_budget_row_is_set(void) {
  sprout_budgets budgets;
  const sprout_limit *rows = (const sprout_limit *)&budgets;
  size_t i;
  memset(&budgets, 0, sizeof budgets);
  player_budgets(&budgets);
  CHECK(sizeof budgets == 16 * sizeof(sprout_limit), "the budgets table has %zu rows", sizeof budgets / sizeof(sprout_limit));
  for (i = 0; i < sizeof budgets / sizeof *rows; i++) CHECK(rows[i].set && rows[i].value > 0, "row %zu is unset", i);
  /* The spec's Runtime budgets table. */
  CHECK(budgets.steps.value == 50000 && budgets.poll_steps.value == 10000 && budgets.output.value == 8000, "steps, poll, output");
  CHECK(budgets.events.value == 256 && budgets.cascade_depth.value == 20 && budgets.passage_depth.value == 8, "events, cascade, passages");
  CHECK(budgets.set_role_objects.value == 8 && budgets.spawns.value == 8, "set role, spawns");
  CHECK(budgets.shortest_wake_seconds.value == 60 && budgets.pending_wakes.value == 1, "wakes");
  CHECK(budgets.nickname_characters.value == 24 && budgets.list_elements.value == 16, "nickname, lists");
}

static void a_cartridge_recording_larger_caps_is_refused_cap_by_cap(void) {
  sprout_world world;
  char words[600];
  memset(&world, 0, sizeof world);
  world.caps = (sprout_caps){100, 8, 8, 8, 80, 8, 40, 8, 16, 600};
  CHECK(player_caps_fit(&world, words, sizeof words), "the defaults fit: %s", words);
  world.caps.exits_per_place = 12;
  world.caps.nouns_per_object = 9;
  CHECK(!player_caps_fit(&world, words, sizeof words), "larger caps fit");
  CHECK(HAS(words, "This world was published allowing 9 nouns on one object. This player allows 8, 1 fewer."), "%s", words);
  CHECK(HAS(words, "This world was published allowing 12 exits on one place. This player allows 8, 4 fewer."), "%s", words);
  world.caps.exits_per_place = 3;
  world.caps.nouns_per_object = 1;
  CHECK(player_caps_fit(&world, words, sizeof words), "smaller caps are fine: %s", words);
  /* The caps the app leaves to no figure are never exceeded. */
  world.caps.places_set = world.caps.objects_set = world.caps.kinds_set = true;
  world.caps.places = world.caps.objects = world.caps.kinds = 1e9;
  CHECK(player_caps_fit(&world, words, sizeof words), "the unset caps are never exceeded");
}

static void the_clamp_never_goes_below_what_was_seen(void) {
  CHECK(player_clamp(100, 50) == 100, "forward");
  CHECK(player_clamp(40, 50) == 50, "back");
  CHECK(player_clamp(50, 50) == 50, "still");
}

static void the_shelf_asks_whether_each_cartridge_can_be_shelved(void) {
  char *good, *garbage, *missing;
  begin("inspect");
  write_text("garbage.sproutworld", "this is not a cartridge");
  good = call("sprout.inspect", "chip-tree.sproutworld");
  CHECK(HAS(good, "\"ok\":true") && HAS(good, "\"name\":\"chip_tree\""), "%s", good);
  garbage = call("sprout.inspect", "garbage.sproutworld");
  CHECK(HAS(garbage, "\"ok\":false") && HAS(garbage, "Sprout cartridge"), "%s", garbage);
  missing = call("sprout.inspect", "absent.sproutworld");
  CHECK(HAS(missing, "\"ok\":false") && HAS(missing, "cannot be read"), "%s", missing);
  end();
}

static void nothing_open_says_so_in_words(void) {
  begin("nothing");
  CHECK(HAS(call("sprout.load", NULL), "No world is open."), "load");
  CHECK(HAS(call("sprout.admit", "Marta"), "No world is open."), "admit");
  CHECK(HAS(call("sprout.view", NULL), "You are not in a world."), "view");
  CHECK(HAS(call("sprout.turn", "{}"), "You are not in a world."), "turn");
  CHECK(HAS(call("sprout.tick", NULL), "You are not in a world."), "tick");
  CHECK(HAS(call("sprout.save", NULL), "No world is open."), "save");
  CHECK(HAS(call("sprout.close", NULL), "\"lines\":[]"), "close");
  end();
}

/* chip-tree: the transcript the TypeScript player wrote, played through the registered functions. */
static void chip_tree_plays_as_its_transcript_does(void) {
  char state_path[200], log_path[200], reading[2000];
  char *opened, *loaded, *admitted, *view, *told, *first_save, *second_save;
  const sprout_json *reply;
  begin("chip-tree");
  json_begin();
  opened = call("sprout.open", "chip-tree.sproutworld");
  CHECK(HAS(opened, "\"ok\":true") && HAS(opened, "\"guard\""), "%s", opened);
  save_paths(opened, state_path, log_path, sizeof state_path);
  loaded = call("sprout.load", NULL);
  CHECK(HAS(loaded, "\"fresh\":true") && HAS(loaded, "\"nickname\":null") && HAS(loaded, "\"last\":0"), "%s", loaded);

  /* A word of the world is not a name. */
  admitted = call("sprout.admit", "guard");
  CHECK(HAS(admitted, "\"admitted\":false") && HAS(admitted, "guard"), "%s", admitted);
  admitted = call("sprout.admit", "Marta");
  reply = parse(admitted);
  CHECK(HAS(admitted, "\"admitted\":true"), "%s", admitted);
  CHECK(line_count(reply) == 1 && strcmp(line_kind(reply, 0), "described") == 0 &&
            strcmp(line_text(reply, 0), "There is nothing special about a hall.") == 0, "%s", admitted);
  first_save = file_text(state_path);
  CHECK(first_save != NULL, "the arrival wrote no save");

  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"place\":\"chip_tree.hall\"") && HAS(view, "\"chips\":[{\"verb\":\"chip_tree.juggle\""), "%.200s", view);
  CHECK(HAS(view, "\"label\":\"to the yard\""), "the exit");

  /* ask guard about weather */
  snprintf(reading, sizeof reading,
           "{\"verb\":\"sprout.ask\",\"text\":\"ask guard about weather\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\","
           "\"id\":\"chip_tree.hall.guard\"},{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}");
  told = call("sprout.turn", reading);
  reply = parse(told);
  CHECK(HAS(told, "\"committed\":true") && line_count(reply) == 1 && strcmp(line_kind(reply, 0), "said") == 0 &&
            strcmp(line_text(reply, 0), "The guard nods.") == 0, "%s", told);
  second_save = file_text(state_path);
  CHECK(second_save != NULL && strcmp(first_save, second_save) != 0 , "the committed turn did not write the save");
  free(first_save);
  free(second_save);

  /* turn dial to 3 */
  told = call("sprout.turn",
              "{\"verb\":\"chip_tree.turn\",\"fillers\":[{\"role\":\"knob\",\"binds\":\"object\",\"id\":\"chip_tree.hall.dial\"},"
              "{\"role\":\"notch\",\"binds\":\"value\",\"value\":3}]}");
  reply = parse(told);
  CHECK(strcmp(line_text(reply, 0), "Click.") == 0, "%s", told);

  /* juggle pebble: a set role */
  told = call("sprout.turn",
              "{\"verb\":\"chip_tree.juggle\",\"fillers\":[{\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"chip_tree.hall.pebble\"]}]}");
  reply = parse(told);
  CHECK(strcmp(line_text(reply, 0), "Nothing much comes of that.") == 0, "%s", told);

  /* take pebble: the roles the chip tree leaves out are left unbound, and the engine takes the reading */
  told = call("sprout.turn",
              "{\"verb\":\"sprout.take\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\",\"id\":\"chip_tree.hall.pebble\"}]}");
  reply = parse(told);
  CHECK(HAS(told, "\"committed\":true") && HAS(told, "\"result\":\"done\"") && line_count(reply) >= 1 &&
            strcmp(line_kind(reply, 0), "said") == 0, "%s", told);
  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"carried\":[{\"id\":\"chip_tree.hall.pebble\""), "the pebble is carried: %.300s", view);

  /* a reading the world cannot take is told in words, and writes nothing */
  told = call("sprout.turn", "{\"verb\":\"sprout.nonesuch\",\"fillers\":[]}");
  reply = parse(told);
  CHECK(HAS(told, "\"committed\":false") && line_count(reply) == 1 && strlen(line_text(reply, 0)) > 0, "%s", told);
  told = call("sprout.turn", "not json at all");
  CHECK(HAS(told, "\"committed\":false") && HAS(told, "not written as the player writes one"), "%s", told);

  /* go north */
  told = call("sprout.turn",
              "{\"verb\":\"sprout.go\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\","
              "\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]}");
  reply = parse(told);
  CHECK(strcmp(line_kind(reply, 0), "described") == 0 && strcmp(line_text(reply, 0), "There is nothing special about a yard.") == 0, "%s", told);
  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"place\":\"chip_tree.yard\""), "%.120s", view);

  /* the log tail carries each turn's seed; the seeds are in range and differ from turn to turn */
  {
    char *log = file_text(log_path);
    const char *at;
    unsigned long long previous = ~0ULL;
    int seen = 0;
    CHECK(log != NULL && HAS(log, "\"bundle\":\"5a9a634c"), "the log tail: %s", log);
    for (at = log; at != NULL && (at = strstr(at, "\"seed\":")) != NULL; seen++) {
      unsigned long long seed = strtoull(at + 7, NULL, 10);
      CHECK(seed <= 4294967295ULL && seed != previous, "seed %llu", seed);
      previous = seed;
      at += 7;
    }
    CHECK(seen >= 6, "only %d seeds in the log", seen);
    CHECK(HAS(log, "\"text\":\"ask guard about weather\""), "the line typed is logged");
    free(log);
  }

  /* leaving writes the departure and releases the world */
  told = call("sprout.close", NULL);
  CHECK(HAS(told, "You leave, and take what you carry with you."), "%s", told);
  CHECK(HAS(call("sprout.view", NULL), "You are not in a world."), "after close");
  json_end();
  end();
}

/* Closing and opening again: the visitor is where they left off, and is offered their name. */
static void a_returning_visitor_finds_their_place_and_name(void) {
  char state_path[200], log_path[200];
  char *opened, *loaded, *admitted, *view;
  begin("return");
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  call("sprout.turn",
       "{\"verb\":\"sprout.go\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\","
       "\"label\":\"to the yard\",\"to\":\"chip_tree.yard\"}]}");
  call("sprout.close", NULL);

  call("sprout.open", "chip-tree.sproutworld");
  loaded = call("sprout.load", NULL);
  CHECK(HAS(loaded, "\"fresh\":false") && HAS(loaded, "\"nickname\":\"Marta\"") && HAS(loaded, "\"present\":[]"), "%s", loaded);
  admitted = call("sprout.admit", "Marta");
  CHECK(HAS(admitted, "\"admitted\":true"), "%s", admitted);
  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"place\":\"chip_tree.yard\""), "back where they left: %.120s", view);
  end();
}

/* The app killed while a visitor stood in the world: the next opening puts them away, quietly. */
static void a_world_left_open_is_put_away_without_a_word(void) {
  char state_path[200], log_path[200];
  char *opened, *loaded, *admitted, *state, *log;
  begin("killed");
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  call("sprout.save", NULL);
  /* What the Data folder held at that moment is all a killed app leaves behind. */
  state = file_text(state_path);
  log = file_text(log_path);
  call("sprout.close", NULL);
  write_text(state_path, state);
  write_text(log_path, log);
  free(state);
  free(log);
  call("sprout.open", "chip-tree.sproutworld");
  loaded = call("sprout.load", NULL);
  CHECK(HAS(loaded, "\"recovered\":true") && HAS(loaded, "\"nickname\":\"Marta\""), "%s", loaded);
  admitted = call("sprout.admit", "Marta");
  CHECK(HAS(admitted, "\"admitted\":true"), "%s", admitted);
  end();
}

/* Time never runs back: a clock set earlier than the save's last seconds is read as the last. */
static void the_clock_going_back_is_clamped_to_the_save(void) {
  char state_path[200], log_path[200];
  char *opened, *log, *loaded;
  begin("clamp");
  fake->seconds = 5000000;
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  fake->seconds = 100;
  call("sprout.turn", "{\"verb\":\"sprout.look\",\"fillers\":[]}");
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"lastSeconds\":5000000") && !HAS(log, "\"seconds\":100,"), "%s", log);
  free(log);
  call("sprout.close", NULL);

  call("sprout.open", "chip-tree.sproutworld");
  loaded = call("sprout.load", NULL);
  CHECK(HAS(loaded, "\"last\":5000000"), "the save's last seconds: %s", loaded);
  call("sprout.admit", "Marta");
  log = file_text(log_path);
  CHECK(log != NULL && !HAS(log, "\"seconds\":100,") && HAS(log, "\"seconds\":5000000,"), "%s", log);
  free(log);
  end();
}

/* The wakes world: a kiln fired, the player closed, four hours on. Catch-up says nothing. */
static void catching_up_after_an_absence_narrates_nothing(void) {
  char state_path[200], log_path[200], reading[2000];
  char *opened, *view, *told, *before, *after, *admitted, *log;
  const sprout_json *reply;
  begin("wakes");
  json_begin();
  opened = call("sprout.open", "wakes.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  view = call("sprout.view", NULL);
  reading_from(view, "fire", "a kiln", reading, sizeof reading);
  told = call("sprout.turn", reading);
  CHECK(HAS(told, "The chamber takes the flame."), "%s", told);
  call("sprout.close", NULL);
  before = file_text(state_path);
  CHECK(before != NULL && HAS(before, "firing"), "the kiln is firing");

  fake->seconds += 4 * 3600;
  call("sprout.open", "wakes.sproutworld");
  call("sprout.load", NULL);
  admitted = call("sprout.admit", "Marta");
  reply = parse(admitted);
  CHECK(HAS(admitted, "\"admitted\":true") && line_count(reply) == 1 && strcmp(line_kind(reply, 0), "described") == 0,
        "the arrival is all that is told: %s", admitted);
  CHECK(!HAS(admitted, "chamber") && !HAS(admitted, "seedling"), "the catch-up narrated: %s", admitted);
  after = file_text(state_path);
  CHECK(after != NULL && !HAS(after, "firing") && HAS(after, "cool"), "the kiln cooled in the catch-up");
  log = file_text(log_path);
  CHECK(log != NULL && HAS(log, "\"kind\":\"maintenance\"") && HAS(log, "\"outcome\":\"done\""), "the catch-up is in the log: %s", log);
  free(before);
  free(after);
  free(log);
  json_end();
  end();
}

/* The ticks world: a tick turn is run for the place the visitor stands in, and what it tells is told. */
static void a_tick_tells_what_the_place_says(void) {
  char *view, *ticked;
  const sprout_json *reply;
  begin("ticks");
  json_begin();
  call("sprout.open", "ticks.sproutworld");
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  view = call("sprout.view", NULL);
  CHECK(HAS(view, "\"chips\":"), "%.100s", view);
  ticked = call("sprout.tick", NULL);
  CHECK(HAS(ticked, "\"ran\":") && HAS(ticked, "\"lines\":"), "%s", ticked);
  fake->seconds += 40;
  ticked = call("sprout.tick", NULL);
  reply = parse(ticked);
  CHECK(HAS(ticked, "\"ran\":true") && HAS(ticked, "The wind picks up in the eaves."), "%s", ticked);
  CHECK(line_count(reply) >= 1, "%s", ticked);
  json_end();
  end();
}

/* A save the runtime cannot read is set aside and the world starts again, with the words saying so. */
static void a_damaged_save_is_set_aside_in_words(void) {
  char state_path[200], log_path[200];
  char *opened, *loaded;
  begin("damaged");
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  fake->file.mkdir("saves");
  write_text(state_path, "{\"this\":\"is not a stored world\"}");
  loaded = call("sprout.load", NULL);
  CHECK(HAS(loaded, "\"ok\":true") && HAS(loaded, "\"fresh\":true") && HAS(loaded, "could not be read") &&
            HAS(loaded, "set aside"), "%s", loaded);
  {
    char aside[260];
    snprintf(aside, sizeof aside, "%s.damaged", state_path);
    CHECK(exists(aside), "the damaged save was not kept");
  }
  CHECK(HAS(call("sprout.admit", "Marta"), "\"admitted\":true"), "the world starts again");
  end();
}

/* The bytes of the save are the stored world: `sproutc` reads and writes them back unchanged. */
static void the_save_is_the_stored_world_sproutc_reads(void) {
  char state_path[200], log_path[200], kept[480];
  char *opened, *text;
  const char *keep = getenv("PLAYER_KEEP_DIR");
  begin("keep");
  opened = call("sprout.open", "chip-tree.sproutworld");
  save_paths(opened, state_path, log_path, sizeof state_path);
  call("sprout.load", NULL);
  call("sprout.admit", "Marta");
  call("sprout.turn",
       "{\"verb\":\"sprout.ask\",\"fillers\":[{\"role\":\"target\",\"binds\":\"object\",\"id\":\"chip_tree.hall.guard\"},"
       "{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}");
  call("sprout.close", NULL);
  text = file_text(state_path);
  CHECK(text != NULL && text[0] == '{' && HAS(text, "\"world\":\"chip_tree\""), "%.100s", text == NULL ? "(none)" : text);
  if (keep != NULL && text != NULL) {
    FILE *out;
    snprintf(kept, sizeof kept, "%s/chip-tree.save.json", keep);
    out = fopen(kept, "wb");
    CHECK(out != NULL, "writing %s", kept);
    if (out != NULL) {
      fputs(text, out);
      fclose(out);
    }
  }
  free(text);
  end();
}

int main(void) {
  const char *keep = getenv("PLAYER_KEEP_DIR");
  if (keep != NULL) {
    snprintf(root, sizeof root, "%s", keep);
  } else {
    snprintf(root, sizeof root, "/tmp/sprout-player-glue-XXXXXX");
    if (mkdtemp(root) == NULL) return 2;
  }
  registers_every_function();
  every_budget_row_is_set();
  a_cartridge_recording_larger_caps_is_refused_cap_by_cap();
  the_clamp_never_goes_below_what_was_seen();
  the_shelf_asks_whether_each_cartridge_can_be_shelved();
  nothing_open_says_so_in_words();
  chip_tree_plays_as_its_transcript_does();
  a_returning_visitor_finds_their_place_and_name();
  a_world_left_open_is_put_away_without_a_word();
  the_clock_going_back_is_clamped_to_the_save();
  catching_up_after_an_absence_narrates_nothing();
  a_tick_tells_what_the_place_says();
  a_damaged_save_is_set_aside_in_words();
  the_save_is_the_stored_world_sproutc_reads();
  printf("player glue: %d scenarios, %d checks, %d failed\n", scenario_count, checks, failures);
  return failures == 0 ? 0 : 1;
}
