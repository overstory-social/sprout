/*
 * The write turns (the spec's The runtime > Turns; The host contract), each run over the instance's live state
 * under the seed the host hands it, which is the turn's own whatever its kind, and answered as one JSON object
 * (`told`): what the turn came to, its fault in the language's shape, its lines and effects, whose views it made
 * stale, what the store writes, and the entry the log keeps.
 */
#include <string.h>

#include "engine.h"
#include "logged.h"
#include "reading_json.h"
#include "state.h"

static const char *const KINDS[] = {"said", "told", "refused", "described", "notice", "extension"};
static const char *const RESULTS[] = {"done", "faulted", "refused", "closed", "idle"};

/* The answer is `head`, the JSON text of an object, with the member `"name":value` (`value` JSON text too) put last. */
static int with_member(wasm_engine *e, const char *head, size_t head_length, const char *name, const char *value,
                       size_t value_length) {
  size_t name_length = strlen(name), at = head_length - 1;
  char *joined = (char *)sprout_arena_take(&e->scratch, head_length + name_length + value_length + 5);
  if (joined == NULL) return SPROUT_NO_MEMORY;
  /* The object's closing brace gives way to `,"name":value}`. */
  memcpy(joined, head, at);
  joined[at++] = ',';
  joined[at++] = '"';
  memcpy(joined + at, name, name_length);
  at += name_length;
  joined[at++] = '"';
  joined[at++] = ':';
  memcpy(joined + at, value, value_length);
  at += value_length;
  joined[at++] = '}';
  joined[at] = '\0';
  e->output = joined;
  e->output_length = at;
  return SPROUT_OK;
}

/* What a command turn says of its line, added to `root`; false when a page is refused. */
static bool commanded(wasm_engine *e, const sprout_outcome *outcome, bool displaced, sprout_json *root) {
  sprout_json *next = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, outcome->next_count);
  size_t i;
  if (next == NULL) return false;
  for (i = 0; i < outcome->next_count; i++)
    sprout_json_adopt(next, NULL, sprout_following_tree(&e->scratch, &outcome->next[i]));
  sprout_json_adopt(root, "answered", engine_bool(e, outcome->answered));
  sprout_json_adopt(root, "displaced", engine_bool(e, displaced));
  sprout_json_adopt(root, "drawn", outcome->drawn_among == 0 ? engine_null(e) : engine_number(e, (double)outcome->drawn_among));
  sprout_json_adopt(root, "step", outcome->step == NULL ? engine_null(e) : sprout_reading_tree(&e->scratch, "verb", outcome->step));
  sprout_json_adopt(root, "next", next);
  sprout_json_adopt(root, "goesOn", engine_bool(e, outcome->goes_on));
  return next->count == outcome->next_count;
}

/* What the turn ran, as core's account: each handler and hook in order, the answered line's name or words, and a consent refusal. */
static sprout_json *account(wasm_engine *e, const sprout_outcome *outcome) {
  sprout_json *root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 3);
  sprout_json *ran = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, outcome->ran_count);
  size_t i;
  if (root == NULL || ran == NULL) return NULL;
  for (i = 0; i < outcome->ran_count; i++) {
    const sprout_ran *one = &outcome->ran[i];
    sprout_json *body = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 3);
    if (body == NULL) return NULL;
    sprout_json_adopt(body, "origin", engine_text(e, one->origin, strlen(one->origin)));
    sprout_json_adopt(body, "on", engine_text(e, one->on, strlen(one->on)));
    sprout_json_adopt(body, "at", engine_text(e, one->at, strlen(one->at)));
    if (body->count != 3) return NULL;
    sprout_json_adopt(ran, NULL, body);
  }
  sprout_json_adopt(root, "ran", ran);
  sprout_json_adopt(root, "answered", outcome->answer == NULL ? engine_null(e) : engine_text(e, outcome->answer, strlen(outcome->answer)));
  sprout_json_adopt(root, "refused", engine_bool(e, outcome->refused));
  return root->count == 3 && ran->count == outcome->ran_count ? root : NULL;
}

/*
 * A turn's outcome as JSON: what it came to, whether the stored state changed, its fault in the language's
 * shape, the words a host tells a person outside the world where an arrival was closed or faulted, every
 * line by reader, what it said as the language's effects, and who it cut short, by instance. `changes` is
 * what the store writes, null where it wrote nothing; `stale` whose views it made stale, null where it faulted.
 * `entry` is what the log keeps of it at this instance's depth, and `account` what it ran. A command also gives `answered`, that no reading
 * ran; `displaced`, that its visitor's place was gone, so what they typed was not read; `drawn`, how many readings
 * tied where its reading was drawn, or null; `step`, the reading it ran as a step of a line of several, or null;
 * `next`, the turns its line runs after it; and `goesOn`, that the line goes on.
 */
static int told(wasm_engine *e, const sprout_outcome *outcome, bool displaced) {
  bool command = outcome->has_log && outcome->log.kind == SPROUT_TURN_COMMAND;
  sprout_json *root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 16);
  sprout_json *lines = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, outcome->line_count);
  sprout_json *cuts = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, outcome->cut_count);
  sprout_json *stale = sprout_json_make(&e->scratch, outcome->committed ? SPROUT_JSON_ARRAY : SPROUT_JSON_NULL,
                                        outcome->stale_count);
  sprout_json *fault, *entry = NULL;
  const char *head, *changes = "null";
  size_t i, head_length, changes_length = 4;
  int status;
  if (root == NULL || lines == NULL || cuts == NULL || stale == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(root, "result", engine_text(e, RESULTS[outcome->result], strlen(RESULTS[outcome->result])));
  sprout_json_adopt(root, "changed", engine_bool(e, outcome->state_changed));
  if (outcome->faulted) {
    sprout_str detail = {outcome->fault.text, strlen(outcome->fault.text)};
    fault = sprout_logged_fault(&e->scratch, outcome->fault_name, detail, &outcome->fault_about, false);
  } else {
    fault = engine_null(e);
  }
  sprout_json_adopt(root, "fault", fault);
  sprout_json_adopt(root, "words", outcome->words != NULL ? engine_text(e, outcome->words, strlen(outcome->words)) : engine_null(e));
  for (i = 0; i < outcome->line_count; i++) {
    const sprout_line *line = &outcome->lines[i];
    sprout_json *one = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, 3);
    if (one == NULL) return SPROUT_NO_MEMORY;
    sprout_json_adopt(one, NULL, engine_text(e, line->recipient, line->recipient_length));
    sprout_json_adopt(one, NULL, engine_text(e, KINDS[line->kind], strlen(KINDS[line->kind])));
    sprout_json_adopt(one, NULL, engine_text(e, line->text, line->text_length));
    sprout_json_adopt(lines, NULL, one);
  }
  sprout_json_adopt(root, "lines", lines);
  sprout_json_adopt(root, "effects", sprout_logged_effects(&e->scratch, outcome, false));
  for (i = 0; i < outcome->cut_count; i++)
    sprout_json_adopt(cuts, NULL, engine_text(e, outcome->cuts[i].id.bytes, outcome->cuts[i].id.length));
  sprout_json_adopt(root, "cutShort", cuts);
  for (i = 0; outcome->committed && i < outcome->stale_count; i++)
    sprout_json_adopt(stale, NULL, engine_text(e, outcome->stale[i].bytes, outcome->stale[i].length));
  sprout_json_adopt(root, "stale", stale);
  if (outcome->has_log) {
    status = sprout_logged_entry(&e->scratch, &e->host, outcome, e->log_depth, &entry);
    if (status != SPROUT_OK) return status;
  }
  sprout_json_adopt(root, "entry", entry != NULL ? entry : engine_null(e));
  sprout_json_adopt(root, "account", account(e, outcome));
  if (command && !commanded(e, outcome, displaced, root)) return SPROUT_NO_MEMORY;
  if (root->count != (command ? 16 : 10) || lines->count != outcome->line_count || cuts->count != outcome->cut_count ||
      (outcome->committed && stale->count != outcome->stale_count))
    return SPROUT_NO_MEMORY;
  status = sprout_json_write(&e->scratch, root, &head, &head_length);
  if (status != SPROUT_OK) return status;
  /* The changes are written from the state's own records, as the store keeps them, and put in as they are. */
  if (outcome->has_changes) {
    status = sprout_changes_write(e->state, &outcome->changes, &e->scratch, &changes, &changes_length);
    if (status != SPROUT_OK) return status;
  }
  return with_member(e, head, head_length, "changes", changes, changes_length);
}

int turns_run(wasm_engine *e, sprout_turn_input *in, wasm_line *line) {
  sprout_outcome outcome;
  /* A command whose visitor's place is gone is displaced, which the turn's answer says beside what it told. */
  bool displaced = in->kind == SPROUT_TURN_COMMAND && !questions_stands_in_place(e, in->visit);
  sprout_status status = sprout_run_turn(e->world, e->state, &e->host, in, &outcome);
  int said = status == SPROUT_OK           ? told(e, &outcome, displaced)
             : status == SPROUT_BAD_INPUT ? engine_answer_text(e, status, outcome.fault.text)
                                          : engine_answer_text(e, status, sprout_status_text(status));
  if (line != NULL) lines_ran(line, &outcome, status == SPROUT_OK);
  sprout_outcome_free(&outcome);
  return said;
}

/* Catch-up as one maintenance turn at `instant`, as a host runs it before it admits anyone. */
EXPORT("sw_maintenance") int sw_maintenance(uint64_t seed, uint64_t instant) {
  wasm_engine *e = &the_engine;
  sprout_turn_input in;
  engine_begin(e, seed);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_MAINTENANCE;
  in.instant = instant;
  return turns_run(e, &in, NULL);
}

/* An arrival: the input holds the visit and then the nickname. */
EXPORT("sw_arrive") int sw_arrive(size_t visit_length, size_t nickname_length, uint64_t seed, uint64_t instant) {
  wasm_engine *e = &the_engine;
  sprout_turn_input in;
  sprout_admission admission;
  const char *visit, *nickname;
  sprout_status status;
  engine_begin(e, seed);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  visit = engine_input_string(e, 0, visit_length);
  nickname = engine_input_string(e, visit_length, nickname_length);
  if (visit == NULL || nickname == NULL) return engine_refuse(e, "Hand the visit and nickname in through sw_input first.");
  status = sprout_admit(e->world, e->state, &e->host, visit, nickname, nickname_length, &admission);
  if (status != SPROUT_OK) return engine_answer_text(e, status, sprout_status_text(status));
  if (admission.reason != SPROUT_NICKNAME_OK) {
    int said = engine_answer(e, SPROUT_BAD_INPUT, admission.words.bytes, admission.words.length);
    sprout_admission_free(&admission);
    return said;
  }
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_ARRIVAL;
  in.instant = instant;
  in.visit = visit;
  in.nickname = (const char *)sprout_arena_copy(&e->scratch, admission.kept.bytes, admission.kept.length);
  in.nickname_length = admission.kept.length;
  sprout_admission_free(&admission);
  if (in.nickname == NULL) return SPROUT_NO_MEMORY;
  return turns_run(e, &in, NULL);
}

/* A departure: the input holds the visit. */
EXPORT("sw_depart") int sw_depart(size_t visit_length, uint64_t seed, uint64_t instant) {
  wasm_engine *e = &the_engine;
  sprout_turn_input in;
  const char *visit;
  engine_begin(e, seed);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  visit = engine_input_string(e, 0, visit_length);
  if (visit == NULL) return engine_refuse(e, "Hand the visit in through sw_input first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_DEPARTURE;
  in.instant = instant;
  in.visit = visit;
  return turns_run(e, &in, NULL);
}

/* A tick of the place whose id the input holds, under its own `seed`. */
EXPORT("sw_tick") int sw_tick(size_t place_length, uint64_t seed, uint64_t instant) {
  wasm_engine *e = &the_engine;
  sprout_turn_input in;
  const char *place;
  engine_begin(e, seed);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  place = engine_input_string(e, 0, place_length);
  if (place == NULL) return engine_refuse(e, "Hand the place in through sw_input first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_TICK;
  in.instant = instant;
  in.place = place;
  return turns_run(e, &in, NULL);
}

/* The wake asked under `serial` of the object whose id the input holds, under its own `seed`. */
EXPORT("sw_wake") int sw_wake(size_t object_length, uint64_t serial, uint64_t seed, uint64_t instant) {
  wasm_engine *e = &the_engine;
  sprout_turn_input in;
  const char *object;
  engine_begin(e, seed);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  object = engine_input_string(e, 0, object_length);
  if (object == NULL) return engine_refuse(e, "Hand the object in through sw_input first.");
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_WAKE;
  in.instant = instant;
  in.object = object;
  in.serial = serial;
  return turns_run(e, &in, NULL);
}

/* The member `key` of `object` where it is neither missing nor null. */
static const sprout_json *given(const sprout_json *object, const char *key) {
  const sprout_json *found = object == NULL ? NULL : sprout_json_get(object, key);
  return found != NULL && found->kind != SPROUT_JSON_NULL ? found : NULL;
}

/* A command's words, the reading a line planned for it and the item it re-reads, from `root`; NULL, or words. */
static const char *typed_of(wasm_engine *e, const sprout_json *root, sprout_turn_input *in) {
  const sprout_json *planned = given(root, "planned"), *reread = given(root, "reread");
  const char *wrong;
  in->text = engine_string_at(root, "text");
  if (in->text == NULL) return "A command names its visit and the words typed, or a verb and its fillers.";
  in->text_length = strlen(in->text);
  if (planned != NULL) {
    sprout_reading *read = (sprout_reading *)sprout_arena_take(&e->scratch, sizeof *read);
    if (read == NULL) return "There is no memory for the reading.";
    if ((wrong = sprout_reading_of_tree(&e->scratch, planned, read)) != NULL) return wrong;
    in->planned = read;
  }
  if (reread != NULL) {
    sprout_reread *item = (sprout_reread *)sprout_arena_take(&e->scratch, sizeof *item);
    if (item == NULL) return "There is no memory for the reading.";
    if ((wrong = sprout_reread_of_tree(&e->scratch, reread, item)) != NULL) return wrong;
    in->reread = item;
  }
  return NULL;
}

/*
 * A command: the input holds `{"visit", "text"}`, the words typed, which the runtime reads in the turn, with
 * `"planned"`, `"reread"`, `"line"` and `"step"` for a turn a line handed out (lines.c), which hands the line what
 * it came to; or `{"visit", "verb", "fillers", "typed"}`, a reading a host built from the view's chips, run as it is.
 */
EXPORT("sw_command") int sw_command(size_t length, uint64_t seed, uint64_t instant) {
  wasm_engine *e = &the_engine;
  const sprout_json *fillers, *of_line;
  const sprout_stored_visitor *visitor;
  const char *visit, *verb, *typed, *wrong;
  sprout_filling *fillings = NULL;
  sprout_reading reading;
  sprout_turn_input in;
  sprout_json *root;
  wasm_line *line = NULL;
  int status;
  engine_begin(e, seed);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  status = engine_input_json(e, length, "The command is not JSON.", &root);
  if (status != SPROUT_OK) return status;
  memset(&in, 0, sizeof in);
  in.kind = SPROUT_TURN_COMMAND;
  in.instant = instant;
  visit = engine_string_at(root, "visit");
  if (visit == NULL) return engine_refuse(e, "A command names its visit, verb, typed line and fillers, or its visit and words.");
  in.visit = visit;
  if (sprout_json_get(root, "verb") == NULL) {
    if ((of_line = given(root, "line")) != NULL) {
      line = lines_waiting_on(e, of_line, given(root, "step"));
      if (line == NULL) return engine_refuse(e, "Run a command a line handed out once, while its line is under way.");
    }
    wrong = typed_of(e, root, &in);
    return wrong != NULL ? engine_refuse(e, wrong) : turns_run(e, &in, line);
  }
  verb = engine_string_at(root, "verb");
  typed = engine_string_at(root, "typed");
  fillers = sprout_json_get(root, "fillers");
  if (verb == NULL || typed == NULL || fillers == NULL)
    return engine_refuse(e, "A command names its visit, verb, typed line and fillers, or its visit and words.");
  visitor = sprout_state_find_visitor(e->state, (sprout_str){visit, strlen(visit)});
  if (visitor == NULL) return engine_refuse(e, "No visitor of this world has that visit.");
  memset(&reading, 0, sizeof reading);
  wrong = sprout_fillings_of_tree(&e->scratch, fillers, &fillings, &reading.filling_count);
  if (wrong != NULL) return engine_refuse(e, wrong);
  reading.verb = verb;
  reading.actor = sprout_arena_copy(&e->scratch, visitor->instance.bytes, visitor->instance.length);
  if (reading.actor == NULL) return SPROUT_NO_MEMORY;
  reading.fillings = fillings;
  in.reading = &reading;
  in.text = typed;
  in.text_length = strlen(typed);
  return turns_run(e, &in, NULL);
}
