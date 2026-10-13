/* The `sproutc parse` command; see parsing.h. */
#include "parsing.h"

#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "host.h"
#include "readings.h"
#include "state.h"

#define USAGE "sproutc: write `sproutc parse <world.sproutworld> --readings <file> [--each]`.\n"

#define EXIT_DIFFERS 1
#define EXIT_USAGE 2

/* ---- what the runtime read, as JSON ---- */

static sprout_json *jtext(sprout_arena *arena, const char *text) {
  return text == NULL ? sprout_json_make(arena, SPROUT_JSON_NULL, 0) : sprout_json_text(arena, text, strlen(text));
}

static sprout_json *jstr(sprout_arena *arena, sprout_str text) { return sprout_json_text(arena, text.bytes, text.length); }

static sprout_json *jnumber(sprout_arena *arena, double number) {
  sprout_json *node = sprout_json_make(arena, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = number;
  return node;
}

/* An object of `count` members, each a name and a node; NULL where any node is. */
static sprout_json *jobject(sprout_arena *arena, size_t count, const char **names, sprout_json **nodes) {
  sprout_json *object = sprout_json_make(arena, SPROUT_JSON_OBJECT, count);
  size_t i;
  if (object == NULL) return NULL;
  for (i = 0; i < count; i++) {
    if (nodes[i] == NULL) return NULL;
    sprout_json_adopt(object, names[i], nodes[i]);
  }
  return object;
}

static sprout_json *filler_json(sprout_arena *arena, const sprout_filling *filling) {
  sprout_json *node = sprout_json_make(arena, SPROUT_JSON_OBJECT, 5), *ids;
  size_t i;
  if (node == NULL) return NULL;
  sprout_json_adopt(node, "role", jtext(arena, filling->role));
  switch (filling->binds) {
    case SPROUT_FILL_UNBOUND:
      sprout_json_adopt(node, "binds", jtext(arena, "unbound"));
      break;
    case SPROUT_FILL_OBJECT:
      sprout_json_adopt(node, "binds", jtext(arena, "object"));
      sprout_json_adopt(node, "id", jtext(arena, filling->id));
      break;
    case SPROUT_FILL_SET:
      sprout_json_adopt(node, "binds", jtext(arena, "set"));
      ids = sprout_json_make(arena, SPROUT_JSON_ARRAY, filling->id_count);
      for (i = 0; ids != NULL && i < filling->id_count; i++) sprout_json_adopt(ids, NULL, jtext(arena, filling->ids[i]));
      sprout_json_adopt(node, "ids", ids);
      break;
    case SPROUT_FILL_EXIT:
      sprout_json_adopt(node, "binds", jtext(arena, "exit"));
      sprout_json_adopt(node, "direction", jtext(arena, filling->direction));
      sprout_json_adopt(node, "label", jtext(arena, filling->label));
      sprout_json_adopt(node, "to", jtext(arena, filling->id));
      break;
    case SPROUT_FILL_TEXT:
      sprout_json_adopt(node, "binds", jtext(arena, "value"));
      sprout_json_adopt(node, "value", jtext(arena, filling->text));
      break;
    case SPROUT_FILL_NUMBER:
      sprout_json_adopt(node, "binds", jtext(arena, "value"));
      sprout_json_adopt(node, "value", jnumber(arena, filling->number));
      break;
  }
  return node;
}

/* A reading by its verb, or an intent's by the intent (`what`), who performs it and what it binds, in order. */
static sprout_json *reading_json(sprout_arena *arena, const char *what, const sprout_reading *reading) {
  sprout_json *bindings = sprout_json_make(arena, SPROUT_JSON_ARRAY, reading->filling_count);
  const char *names[3];
  sprout_json *nodes[3];
  size_t i;
  if (bindings == NULL) return NULL;
  for (i = 0; i < reading->filling_count; i++) sprout_json_adopt(bindings, NULL, filler_json(arena, &reading->fillings[i]));
  names[0] = what;
  nodes[0] = jtext(arena, reading->verb);
  names[1] = "actor";
  nodes[1] = jtext(arena, reading->actor);
  names[2] = "bindings";
  nodes[2] = bindings;
  return jobject(arena, 3, names, nodes);
}

static sprout_json *reread_json(sprout_arena *arena, const sprout_reread *reread) {
  sprout_json *values = sprout_json_make(arena, SPROUT_JSON_ARRAY, reread->value_count);
  sprout_json *referents = sprout_json_make(arena, SPROUT_JSON_ARRAY, reread->referent_count);
  const char *names[4] = {"role", "words", "values", "referents"};
  sprout_json *nodes[4];
  size_t i;
  if (values == NULL || referents == NULL) return NULL;
  for (i = 0; i < reread->value_count; i++) {
    const char *pair[2] = {"role", "words"};
    sprout_json *of[2];
    of[0] = jtext(arena, reread->values[i].role);
    of[1] = jtext(arena, reread->values[i].words);
    sprout_json_adopt(values, NULL, jobject(arena, 2, pair, of));
  }
  for (i = 0; i < reread->referent_count; i++) sprout_json_adopt(referents, NULL, jtext(arena, reread->referents[i]));
  nodes[0] = jtext(arena, reread->role);
  nodes[1] = jtext(arena, reread->words);
  nodes[2] = values;
  nodes[3] = referents;
  return jobject(arena, 4, names, nodes);
}

static sprout_json *following_json(sprout_arena *arena, const sprout_following *following) {
  const char *names[2] = {"planned", "reread"};
  sprout_json *nodes[2];
  if (following->planned == NULL) {
    const char *text = "text";
    sprout_json *words = jtext(arena, following->text);
    return jobject(arena, 1, &text, &words);
  }
  nodes[0] = reading_json(arena, "verb", following->planned);
  if (following->reread == NULL) return jobject(arena, 1, names, nodes);
  nodes[1] = reread_json(arena, following->reread);
  return jobject(arena, 2, names, nodes);
}

/* The first aside of `line` the reading carries, or NULL. */
static const sprout_aside *aside_of(const sprout_reading *reading, const char *line) {
  size_t i;
  for (i = 0; i < reading->aside_count; i++)
    if (strcmp(reading->asides[i].line, line) == 0) return &reading->asides[i];
  return NULL;
}

/* What a reading or an intent's reading came to: the reading, the turns after it, the draw and the corrections. */
static bool understood_json(sprout_arena *arena, const sprout_parsed *parsed, sprout_json *record) {
  const bool intent = parsed->end == SPROUT_PARSED_INTENT;
  sprout_json *rest = sprout_json_make(arena, SPROUT_JSON_ARRAY, parsed->rest_count);
  sprout_json *corrected = sprout_json_make(arena, SPROUT_JSON_ARRAY, parsed->reading.aside_count), *drawn;
  size_t i;
  if (rest == NULL || corrected == NULL) return false;
  for (i = 0; i < parsed->rest_count; i++) sprout_json_adopt(rest, NULL, following_json(arena, &parsed->rest[i]));
  for (i = 0; i < parsed->reading.aside_count; i++) {
    const sprout_aside *aside = &parsed->reading.asides[i];
    const char *names[2] = {"thing", "pronoun"};
    sprout_json *nodes[2];
    if (strcmp(aside->line, "pronoun_correction") != 0) continue;
    nodes[0] = jtext(arena, aside->thing);
    nodes[1] = jtext(arena, aside->pronoun);
    sprout_json_adopt(corrected, NULL, jobject(arena, 2, names, nodes));
  }
  if (parsed->drawn) {
    const sprout_aside *meant = aside_of(&parsed->reading, "meant");
    const char *names[2] = {"among", "meant"};
    sprout_json *nodes[2];
    nodes[0] = jnumber(arena, (double)parsed->drawn_among);
    nodes[1] = jtext(arena, meant == NULL ? NULL : meant->thing);
    drawn = jobject(arena, 2, names, nodes);
  } else {
    drawn = sprout_json_make(arena, SPROUT_JSON_NULL, 0);
  }
  sprout_json_adopt(record, intent ? "intent" : "reading", reading_json(arena, intent ? "intent" : "verb", &parsed->reading));
  sprout_json_adopt(record, "rest", rest);
  sprout_json_adopt(record, "drawn", drawn);
  sprout_json_adopt(record, "corrected", corrected);
  return true;
}

static sprout_json *answered_json(sprout_arena *arena, const sprout_parsed *parsed) {
  sprout_json *bindings = sprout_json_make(arena, SPROUT_JSON_ARRAY, parsed->binding_count), *line;
  const char *names[3] = {"line", "by", "bindings"};
  sprout_json *nodes[3];
  const char *said = parsed->words != NULL ? "text" : parsed->absent ? "absent" : "passage";
  size_t i;
  if (bindings == NULL) return NULL;
  for (i = 0; i < parsed->binding_count; i++) {
    const sprout_said_binding *one = &parsed->bindings[i];
    const char *pair[2];
    sprout_json *of[2];
    pair[0] = "name";
    of[0] = jtext(arena, one->name);
    pair[1] = one->object ? "object" : "value";
    of[1] = jstr(arena, one->text);
    sprout_json_adopt(bindings, NULL, jobject(arena, 2, pair, of));
  }
  line = jtext(arena, parsed->words != NULL ? parsed->words : parsed->line);
  nodes[0] = jobject(arena, 1, &said, &line);
  nodes[1] = jstr(arena, parsed->by);
  nodes[2] = bindings;
  return jobject(arena, 3, names, nodes);
}

sprout_json *sproutc_parsed_json(sprout_arena *arena, const sprout_parsed *parsed) {
  sprout_json *record = sprout_json_make(arena, SPROUT_JSON_OBJECT, 6);
  sprout_json *draws = sprout_json_make(arena, SPROUT_JSON_ARRAY, parsed->draw_count);
  size_t i;
  if (record == NULL || draws == NULL) return NULL;
  if (parsed->end == SPROUT_PARSED_READING || parsed->end == SPROUT_PARSED_INTENT) {
    if (!understood_json(arena, parsed, record)) return NULL;
  } else if (parsed->end == SPROUT_PARSED_ANSWERED) {
    sprout_json_adopt(record, "answered", answered_json(arena, parsed));
  } else {
    const char *names[2] = {"name", "detail"};
    sprout_json *nodes[2];
    nodes[0] = jtext(arena, parsed->fault_name);
    nodes[1] = jtext(arena, parsed->fault.text);
    sprout_json_adopt(record, "faulted", jobject(arena, 2, names, nodes));
  }
  for (i = 0; i < parsed->draw_count; i++) sprout_json_adopt(draws, NULL, jnumber(arena, (double)parsed->draws[i]));
  sprout_json_adopt(record, "draws", draws);
  sprout_json_adopt(record, "steps", jnumber(arena, (double)parsed->steps));
  /* A member the host refused a page for is missing, and the record says nothing true. */
  for (i = 0; i < record->count; i++)
    if (record->items[i] == NULL) return NULL;
  return record->count == (parsed->end == SPROUT_PARSED_READING || parsed->end == SPROUT_PARSED_INTENT ? 6 : 3) ? record
                                                                                                                 : NULL;
}

bool sproutc_json_same(const sprout_json *a, const sprout_json *b) {
  size_t i;
  if (a == NULL || b == NULL) return a == b;
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SPROUT_JSON_NULL:
      return true;
    case SPROUT_JSON_BOOL:
      return a->boolean == b->boolean;
    case SPROUT_JSON_NUMBER:
      return a->number == b->number;
    case SPROUT_JSON_STRING:
      return a->length == b->length && memcmp(a->bytes, b->bytes, a->length) == 0;
    case SPROUT_JSON_ARRAY:
      if (a->count != b->count) return false;
      for (i = 0; i < a->count; i++)
        if (!sproutc_json_same(a->items[i], b->items[i])) return false;
      return true;
    case SPROUT_JSON_OBJECT:
      if (a->count != b->count) return false;
      for (i = 0; i < a->count; i++)
        if (!sproutc_json_same(a->items[i], sprout_json_get(b, a->items[i]->key))) return false;
      return true;
  }
  return false;
}

/* ---- what a turn was handed ---- */

static const char *text_of(const sprout_json *object, const char *key) {
  const sprout_json *member = sprout_json_get(object, key);
  return member != NULL && member->kind == SPROUT_JSON_STRING ? member->bytes : NULL;
}

/* A reading as the readings file writes one, `{verb, actor, bindings}`; NULL, or words. */
static const char *reading_of(sprout_arena *arena, const sprout_json *node, sprout_reading *reading) {
  sprout_filling *fillings;
  size_t count;
  const sprout_json *bindings = sprout_json_get(node, "bindings");
  const char *why;
  memset(reading, 0, sizeof *reading);
  reading->verb = text_of(node, "verb");
  reading->actor = text_of(node, "actor");
  if (reading->verb == NULL || reading->actor == NULL || bindings == NULL || bindings->kind != SPROUT_JSON_ARRAY)
    return "a reading in the readings file has no verb, actor or bindings.";
  why = sproutc_readings_fillings(arena, bindings, &fillings, &count);
  if (why != NULL) return why;
  reading->fillings = fillings;
  reading->filling_count = count;
  return NULL;
}

/* What the readings file says a turn was handed; NULL, or words. */
static const char *handed_of(sprout_arena *arena, const sprout_json *node, sprout_handed *handed) {
  sprout_reading *planned = (sprout_reading *)sprout_arena_take(arena, sizeof *planned);
  const sprout_json *reread = sprout_json_get(node, "reread");
  const char *why;
  if (planned == NULL) return "the host cannot give the parse memory.";
  why = reading_of(arena, sprout_json_get(node, "planned"), planned);
  if (why != NULL) return why;
  handed->planned = planned;
  handed->reread = NULL;
  if (reread != NULL) {
    sprout_reread *item = (sprout_reread *)sprout_arena_take(arena, sizeof *item);
    const sprout_json *values = sprout_json_get(reread, "values"), *referents = sprout_json_get(reread, "referents");
    sprout_reread_value *pairs;
    const char **ids;
    size_t i;
    if (item == NULL || values == NULL || referents == NULL) return "an item to re-read in the readings file is not whole.";
    pairs = (sprout_reread_value *)sprout_arena_take(arena, (values->count + 1) * sizeof *pairs);
    ids = (const char **)sprout_arena_take(arena, (referents->count + 1) * sizeof *ids);
    if (pairs == NULL || ids == NULL) return "the host cannot give the parse memory.";
    for (i = 0; i < values->count; i++) {
      pairs[i].role = text_of(values->items[i], "role");
      pairs[i].words = text_of(values->items[i], "words");
    }
    for (i = 0; i < referents->count; i++) ids[i] = referents->items[i]->bytes;
    item->role = text_of(reread, "role");
    item->words = text_of(reread, "words");
    item->values = pairs;
    item->value_count = values->count;
    item->referents = ids;
    item->referent_count = referents->count;
    handed->reread = item;
  }
  return NULL;
}

/* ---- the comparison ---- */

typedef struct tally {
  size_t agree, differ, planned;
  bool each; /* every turn's verdict is printed, not only the first difference */
  bool told; /* the first difference has been printed */
} tally;

static unsigned char *file_bytes(const char *path, size_t *length) {
  FILE *file = fopen(path, "rb");
  long size;
  unsigned char *bytes;
  if (file == NULL) return NULL;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (unsigned char *)malloc((size_t)size + 1);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size) {
    free(bytes);
    fclose(file);
    return NULL;
  }
  fclose(file);
  bytes[size] = '\0';
  *length = (size_t)size;
  return bytes;
}

/* The canonical text of `node`, in `arena`; a placeholder where it has none. */
static const char *shown(sprout_arena *arena, const sprout_json *node) {
  const char *bytes;
  size_t length;
  if (node == NULL || sprout_json_write_value(arena, node, &bytes, &length) != SPROUT_OK) return "(nothing)";
  return bytes;
}

static void agrees(tally *t, FILE *out, const sproutc_step *step, size_t turn) {
  t->agree++;
  if (t->each) fprintf(out, "agree: step %zu, turn %zu\n", step->index, turn + 1);
}

static void differs(tally *t, FILE *out, const sproutc_step *step, size_t turn, const char *typed, const char *words,
                    const char *ours, const char *theirs) {
  t->differ++;
  if (t->told && !t->each) return;
  t->told = true;
  fprintf(out, "%s: step %zu, turn %zu, `%s`: ", t->each ? "differ" : "first difference", step->index, turn + 1, typed);
  if (words != NULL) fprintf(out, "sproutc does not read it: %s\n", words);
  else fprintf(out, "sproutc read %s where the TypeScript parser read %s\n", ours, theirs);
}

/*
 * Parses one turn over the stored world `before` and compares it; NULL when it was compared, or words for what in
 * the readings file or the host stops it.
 */
static const char *compare_turn(sproutc_host *host, sprout_world *world, const sproutc_step *step, size_t index,
                                const sproutc_turn_reading *turn, const sprout_json *before, tally *t, FILE *out) {
  sprout_arena arena;
  sprout_state *state = NULL;
  sprout_refusal refusal;
  sprout_handed handed;
  sprout_parsed parsed;
  sprout_status status;
  const char *bytes, *why = NULL;
  char *visit;
  size_t length, n = strlen(step->nickname);
  if (sprout_arena_init(&arena, &host->record) != SPROUT_OK) return "the host cannot give the parse memory.";
  visit = (char *)sprout_arena_take(&arena, n + 7);
  if (visit == NULL || sprout_json_write_value(&arena, before, &bytes, &length) != SPROUT_OK) {
    why = "the stored world a turn began from would not write.";
    goto done;
  }
  memcpy(visit, "visit:", 6);
  memcpy(visit + 6, step->nickname, n + 1);
  if (sprout_state_read(&host->record, bytes, length, &state, &refusal) != SPROUT_OK ||
      sprout_state_open(state, world, NULL, &refusal) != SPROUT_OK) {
    why = "the stored world a turn began from would not open.";
    goto done;
  }
  if (turn->handed != NULL) {
    why = handed_of(&arena, turn->handed, &handed);
    if (why != NULL) goto done;
  }
  sproutc_host_set_seed(host, turn->seed);
  status = sprout_parse(world, state, &host->record, visit, turn->typed, strlen(turn->typed),
                        turn->handed == NULL ? NULL : &handed, &arena, &parsed);
  if (status == SPROUT_BAD_INPUT) {
    differs(t, out, step, index, turn->typed, parsed.fault.text, NULL, NULL);
  } else if (status != SPROUT_OK) {
    why = sprout_status_text(status);
  } else {
    sprout_json *ours = sproutc_parsed_json(&arena, &parsed);
    if (ours == NULL) why = "the host cannot give the parse memory.";
    else if (sproutc_json_same(ours, turn->parsed)) agrees(t, out, step, index);
    else differs(t, out, step, index, turn->typed, NULL, shown(&arena, ours), shown(&arena, turn->parsed));
  }
done:
  if (state != NULL) sprout_state_free(state);
  sprout_arena_reset(&arena);
  return why;
}

/* Every command turn of the readings that read words, compared; NULL, or words for what stops it. */
static const char *compare_all(sproutc_host *host, sprout_world *world, const sproutc_readings *readings, tally *t,
                               FILE *out) {
  const sprout_json *world_now = NULL;
  size_t i, k, count = sproutc_readings_count(readings);
  const char *why = sproutc_readings_budgets(&host->record.budgets, readings->budgets);
  if (why != NULL) return why;
  for (i = 0; i < count; i++) {
    sproutc_step step;
    why = sproutc_readings_step(readings, i, &step);
    if (why != NULL) return why;
    for (k = 0; step.kind == SPROUTC_STEP_COMMAND && k < step.turns; k++) {
      sproutc_turn_reading turn;
      const sprout_json *before;
      why = sproutc_readings_turn(&step, k, &turn);
      if (why != NULL) return why;
      if (turn.parsed == NULL) {
        t->planned++;
        continue;
      }
      before = k == 0 ? world_now : turn.before;
      if (before == NULL) return "the readings file holds no stored world a turn began from: write it with the worlds.";
      why = compare_turn(host, world, &step, k, &turn, before, t, out);
      if (why != NULL) return why;
    }
    if (step.world != NULL) world_now = step.world;
  }
  return NULL;
}

int sproutc_parse(int argc, char **argv, FILE *out, FILE *err) {
  const char *path = NULL, *readings_path = NULL, *why;
  unsigned char *cartridge;
  size_t length = 0;
  sproutc_host host;
  sprout_world *world = NULL;
  sprout_refusal refusal;
  sproutc_readings readings;
  sprout_status loaded;
  tally t;
  int i, code;
  memset(&t, 0, sizeof t);
  for (i = 0; i < argc; i++) {
    if (strcmp(argv[i], "--readings") == 0 && i + 1 < argc) readings_path = argv[++i];
    else if (strcmp(argv[i], "--each") == 0) t.each = true;
    else if (argv[i][0] != '-' && path == NULL) path = argv[i];
    else {
      fprintf(err, "sproutc: `%s` is not something `sproutc parse` takes.\n%s", argv[i], USAGE);
      return EXIT_USAGE;
    }
  }
  if (path == NULL || readings_path == NULL) {
    fputs(USAGE, err);
    return EXIT_USAGE;
  }
  cartridge = file_bytes(path, &length);
  if (cartridge == NULL) {
    fprintf(err, "sproutc: cannot read %s.\n", path);
    return EXIT_USAGE;
  }
  sproutc_host_init(&host, out, NULL);
  loaded = sprout_load_explained(&host.record, (const char *)cartridge, length, &world, &refusal);
  if (loaded != SPROUT_OK) {
    fprintf(err, "sproutc: %s: %s\n", path, loaded == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(loaded));
    free(cartridge);
    sproutc_host_close(&host);
    return EXIT_USAGE;
  }
  why = sproutc_readings_open(&readings, &host.record, readings_path);
  if (why != NULL) {
    fprintf(err, "sproutc: %s\n", why);
    sprout_world_free(world);
    free(cartridge);
    sproutc_host_close(&host);
    return EXIT_USAGE;
  }
  why = compare_all(&host, world, &readings, &t, out);
  if (why != NULL) {
    fprintf(err, "sproutc: %s\n", why);
    code = EXIT_USAGE;
  } else {
    fprintf(out, "parsed: %zu agree, %zu differ, %zu planned\n", t.agree, t.differ, t.planned);
    code = t.differ == 0 ? 0 : EXIT_DIFFERS;
  }
  sproutc_readings_close(&readings);
  sprout_world_free(world);
  free(cartridge);
  sproutc_host_close(&host);
  return code;
}
