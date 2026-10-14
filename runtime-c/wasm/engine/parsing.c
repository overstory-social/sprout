/*
 * A typed line as the inspector reads it (the spec's Parsing; Verbs > The two passes; Parsing > Intents): each command
 * the line holds, split as a line is (sprout_line_parts), read over the live state as the command turn it would begin
 * reads it, under that turn's budget and drawing as a turn seeded 0 draws, then taken as far as the turn would take
 * it before anything runs: a reading's consent pass, or the steps an intent plans now. Every line the one who typed
 * would be told is rendered for them, and every thing named as they read it. Each command is read against the
 * world as it stands, since nothing runs: the draft is dropped and nothing is written.
 */
#include <string.h>

#include "engine.h"
#include "expr/expr.h"
#include "intents.h"
#include "line.h"
#include "parse/parse.h"
#include "prose/prose.h"
#include "turn.h"

/* One command read: its turn, which is never committed, the one who typed it and where they stand. */
typedef struct inspecting {
  wasm_engine *e;
  turn_run run;
  sprout_frame frame;
  prose_reading reading;
  sprout_str actor, here;
} inspecting;

#define MADE(node)                                    \
  do {                                                \
    if ((node) == NULL) return SPROUT_EVAL_NO_MEMORY; \
  } while (0)

/* `text` copied into the answer's arena, as a JSON string. */
static sprout_json *copied(wasm_engine *e, sprout_str text) {
  const char *bytes = sprout_arena_copy(&e->scratch, text.bytes, text.length);
  return bytes == NULL ? NULL : engine_text(e, bytes, text.length);
}

static sprout_json *copied_text(wasm_engine *e, const char *text) {
  return text == NULL ? engine_null(e) : copied(e, (sprout_str){text, strlen(text)});
}

/* An object of `count` members, each added in turn; the caller checks it holds them all. */
static sprout_json *object(wasm_engine *e, size_t count) { return sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, count); }

static sprout_eval_status whole(const sprout_json *node, size_t count) {
  return node->count == count ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* `id` as `{"id", "name"}`, named as the one who typed reads it. */
static sprout_eval_status thing(inspecting *in, sprout_str id, sprout_json **out) {
  sprout_str words;
  sprout_json *one = object(in->e, 2);
  MADE(one);
  EXPR_NEED(prose_object_words(&in->frame, id, in->actor, &words));
  sprout_json_adopt(one, "id", copied(in->e, id));
  sprout_json_adopt(one, "name", copied(in->e, words));
  *out = one;
  return whole(one, 2);
}

/*
 * What fills `role`, or null where nothing does: `{"object"}`, `{"set"}`, `{"exit": {"direction", "label", "to"}}`, or
 * `{"value", "symbol"}`, a symbol role's value marked so.
 */
static sprout_eval_status filler(inspecting *in, const sprout_role *role, const sprout_filled *filled, sprout_json **out) {
  wasm_engine *e = in->e;
  const sprout_stored_bound *bound = &filled->bound;
  sprout_json *one, *inner;
  size_t i;
  if (!filled->filled) {
    MADE(*out = engine_null(e));
    return SPROUT_EVAL_OK;
  }
  MADE(one = object(e, 2));
  switch (bound->kind) {
    case SPROUT_BOUND_OBJECT:
      EXPR_NEED(thing(in, bound->object, &inner));
      sprout_json_adopt(one, "object", inner);
      break;
    case SPROUT_BOUND_SET:
      MADE(inner = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, bound->set_count));
      for (i = 0; i < bound->set_count; i++) {
        sprout_json *member;
        EXPR_NEED(thing(in, bound->set[i], &member));
        sprout_json_adopt(inner, NULL, member);
      }
      EXPR_NEED(whole(inner, bound->set_count));
      sprout_json_adopt(one, "set", inner);
      break;
    case SPROUT_BOUND_EXIT:
      MADE(inner = object(e, 3));
      sprout_json_adopt(inner, "direction", bound->has_direction ? copied(e, bound->direction) : engine_null(e));
      sprout_json_adopt(inner, "label", copied(e, bound->label));
      sprout_json_adopt(inner, "to", copied(e, bound->to));
      EXPR_NEED(whole(inner, 3));
      sprout_json_adopt(one, "exit", inner);
      break;
    case SPROUT_BOUND_VALUE:
      sprout_json_adopt(one, "value", bound->value_is_string ? copied(e, bound->value_string) : engine_number(e, bound->value_number));
      sprout_json_adopt(one, "symbol", engine_bool(e, role->filler == SPROUT_FILLER_SYMBOL));
      break;
  }
  *out = one;
  return whole(one, bound->kind == SPROUT_BOUND_VALUE ? 2 : 1);
}

/* `{"verb", "roles"}`: the verb by qualified name, then every role it declares, in order, with what fills it. */
static sprout_eval_status reading_of(inspecting *in, const sprout_resolved *reading, sprout_json **out) {
  wasm_engine *e = in->e;
  const sprout_verb *verb = reading->verb;
  size_t library = strlen(verb->library), name = strlen(verb->name), i;
  char *qualified = (char *)sprout_arena_take(&e->scratch, library + name + 2);
  sprout_json *one = object(e, 2), *roles = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, verb->role_count);
  MADE(qualified);
  MADE(one);
  MADE(roles);
  memcpy(qualified, verb->library, library);
  qualified[library] = '.';
  memcpy(qualified + library + 1, verb->name, name + 1);
  for (i = 0; i < verb->role_count; i++) {
    sprout_json *role = object(e, 2), *fills;
    MADE(role);
    EXPR_NEED(filler(in, &verb->roles[i], &reading->roles[i], &fills));
    sprout_json_adopt(role, "name", engine_text(e, verb->roles[i].name, strlen(verb->roles[i].name)));
    sprout_json_adopt(role, "filler", fills);
    EXPR_NEED(whole(role, 2));
    sprout_json_adopt(roles, NULL, role);
  }
  sprout_json_adopt(one, "verb", engine_text(e, qualified, library + name + 1));
  sprout_json_adopt(one, "roles", roles);
  *out = one;
  return whole(roles, verb->role_count) == SPROUT_EVAL_OK ? whole(one, 2) : SPROUT_EVAL_NO_MEMORY;
}

/* The paragraphs `said`, said by `by` with `names` in scope, renders to for the one who typed; a refusal's see into their hands. */
static sprout_eval_status spoken(inspecting *in, sprout_str by, const sprout_speech *said, const sprout_effect_binding *names,
                                 size_t name_count, bool refusal, sprout_json **out) {
  sprout_frame frame = in->frame;
  prose_paragraphs paragraphs;
  sprout_json *list;
  size_t i;
  frame.bindings = NULL;
  for (i = 0; i < name_count; i++) MADE(frame.bindings = sprout_bind(&frame, names[i].name, names[i].bound));
  EXPR_NEED(prose_render_speech(&in->reading, by, said, frame.bindings, refusal, &paragraphs));
  MADE(list = sprout_json_make(&in->e->scratch, SPROUT_JSON_ARRAY, paragraphs.count));
  for (i = 0; i < paragraphs.count; i++) sprout_json_adopt(list, NULL, copied(in->e, paragraphs.items[i]));
  *out = list;
  return whole(list, paragraphs.count);
}

/* The engine's line `name`, said to the one who typed where they stand, with `thing` bound after `actor` and `here`. */
static sprout_eval_status engine_line(inspecting *in, const char *name, sprout_str thing_id, sprout_json **out) {
  sprout_effect_binding names[3];
  sprout_speech said;
  sprout_str by;
  sprout_engine_said(&in->frame, name, &in->actor, &in->here, &by, &said);
  names[0].name = "actor";
  names[0].bound = sprout_evaluated_object(in->actor);
  names[1].name = "here";
  names[1].bound = sprout_evaluated_object(in->here);
  names[2].name = "thing";
  names[2].bound = sprout_evaluated_object(thing_id);
  return spoken(in, by, &said, names, 3, false, out);
}

/* `{"among", "meant"}` for a reading drawn from a tie, the engine's `meant` rendered where it was said; null for none. */
static sprout_eval_status drawn_of(inspecting *in, const sprout_parsed *parsed, sprout_json **out) {
  wasm_engine *e = in->e;
  sprout_json *one, *meant = NULL;
  size_t i;
  if (!parsed->drawn) {
    MADE(*out = engine_null(e));
    return SPROUT_EVAL_OK;
  }
  for (i = 0; i < parsed->aside_count; i++)
    if (strcmp(parsed->asides[i].line, "meant") == 0)
      EXPR_NEED(engine_line(in, "meant", expr_str(parsed->asides[i].thing), &meant));
  MADE(one = object(e, 2));
  sprout_json_adopt(one, "among", engine_number(e, (double)parsed->drawn_among));
  sprout_json_adopt(one, "meant", meant == NULL ? engine_null(e) : meant);
  *out = one;
  return whole(one, 2);
}

/* The line the parser answered with: `{"passage", "paragraphs"}`, the passage's name where a passage says it. */
static sprout_eval_status answered(inspecting *in, const parse_answer *said, sprout_json *command) {
  wasm_engine *e = in->e;
  sprout_effect_binding names[3];
  sprout_json *one, *paragraphs;
  size_t i;
  for (i = 0; i < said->binding_count; i++) {
    const sprout_said_binding *bound = &said->bindings[i];
    names[i].name = bound->name;
    if (bound->object) {
      names[i].bound = sprout_evaluated_object(bound->text);
    } else {
      sprout_value words;
      if (!sprout_string(in->run.x.turn, bound->text.bytes, bound->text.length, &words)) return SPROUT_EVAL_NO_MEMORY;
      names[i].bound = sprout_evaluated_value(words);
    }
  }
  EXPR_NEED(spoken(in, said->by, &said->said, names, said->binding_count, strcmp(said->answer, "refused") == 0, &paragraphs));
  MADE(one = object(e, 2));
  sprout_json_adopt(one, "passage", said->said.kind == SPROUT_SPEECH_PASSAGE ? copied_text(e, said->said.name) : engine_null(e));
  sprout_json_adopt(one, "paragraphs", paragraphs);
  EXPR_NEED(whole(one, 2));
  sprout_json_adopt(command, "answered", one);
  return SPROUT_EVAL_OK;
}

/* A verb's reading, what drew it, and its consent pass: `"refused"` is null where every participant consents. */
static sprout_eval_status read_as_verb(inspecting *in, const sprout_parsed *parsed, const parse_turned *turned,
                                       sprout_json *command) {
  wasm_engine *e = in->e;
  sprout_resolved resolved;
  sprout_permit_refusal refusal;
  sprout_json *drawn, *reading, *refused;
  bool refuses = false;
  EXPR_NEED(drawn_of(in, parsed, &drawn));
  EXPR_NEED(parse_resolved_of(&in->frame, &turned->reading, &resolved));
  EXPR_NEED(reading_of(in, &resolved, &reading));
  EXPR_NEED(sprout_consent_pass(&in->run.x, &in->frame, &resolved, &refuses, &refusal));
  if (!refuses) {
    MADE(refused = engine_null(e));
  } else {
    const sprout_move_refusal *by = &refusal.refusal;
    sprout_json *who = NULL, *paragraphs;
    if (by->origin != NULL) EXPR_NEED(thing(in, by->by, &who));
    EXPR_NEED(spoken(in, by->by, &by->said, by->bindings, by->binding_count, true, &paragraphs));
    MADE(refused = object(e, 4));
    sprout_json_adopt(refused, "by", who == NULL ? engine_null(e) : who);
    sprout_json_adopt(refused, "role", copied_text(e, refusal.role));
    sprout_json_adopt(refused, "origin", copied_text(e, by->origin));
    sprout_json_adopt(refused, "paragraphs", paragraphs);
    EXPR_NEED(whole(refused, 4));
  }
  sprout_json_adopt(command, "reading", reading);
  sprout_json_adopt(command, "drawn", drawn);
  sprout_json_adopt(command, "refused", refused);
  return SPROUT_EVAL_OK;
}

/* An intent's reading: `{"name", "slots"}`, what drew it, and the steps it plans now, each a reading. */
static sprout_eval_status read_as_intent(inspecting *in, const sprout_parsed *parsed, const parse_turned *turned,
                                         sprout_json *command) {
  wasm_engine *e = in->e;
  const parse_reading *read = &turned->reading;
  const sprout_intent *intent = read->intent;
  sprout_filled *slots = (sprout_filled *)sprout_arena_take(in->run.x.turn, (intent->slot_count + 1) * sizeof *slots);
  size_t library = strlen(intent->library), name = strlen(intent->name), i, count;
  char *qualified = (char *)sprout_arena_take(&e->scratch, library + name + 2);
  sprout_json *drawn, *one, *named, *steps;
  const sprout_resolved *planned;
  sprout_intended meant;
  MADE(slots);
  MADE(qualified);
  memset(slots, 0, (intent->slot_count + 1) * sizeof *slots);
  EXPR_NEED(drawn_of(in, parsed, &drawn));
  for (i = 0; i < read->count; i++) {
    slots[read->roles[i]].filled = true;
    slots[read->roles[i]].bound = read->bounds[i];
  }
  MADE(named = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, intent->slot_count));
  for (i = 0; i < intent->slot_count; i++) {
    sprout_json *slot = object(e, 2), *fills = NULL;
    MADE(slot);
    if (slots[i].filled && slots[i].bound.kind == SPROUT_BOUND_OBJECT) EXPR_NEED(thing(in, slots[i].bound.object, &fills));
    sprout_json_adopt(slot, "name", engine_text(e, intent->slots[i], strlen(intent->slots[i])));
    sprout_json_adopt(slot, "thing", fills == NULL ? engine_null(e) : fills);
    EXPR_NEED(whole(slot, 2));
    sprout_json_adopt(named, NULL, slot);
  }
  EXPR_NEED(whole(named, intent->slot_count));
  meant.intent = intent;
  meant.actor = read->actor;
  meant.slots = slots;
  EXPR_NEED(sprout_plan_intent(&in->frame, &meant, &planned, &count));
  MADE(steps = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, count));
  for (i = 0; i < count; i++) {
    sprout_json *step;
    EXPR_NEED(reading_of(in, &planned[i], &step));
    sprout_json_adopt(steps, NULL, step);
  }
  EXPR_NEED(whole(steps, count));
  memcpy(qualified, intent->library, library);
  qualified[library] = '.';
  memcpy(qualified + library + 1, intent->name, name + 1);
  MADE(one = object(e, 2));
  sprout_json_adopt(one, "name", engine_text(e, qualified, library + name + 1));
  sprout_json_adopt(one, "slots", named);
  EXPR_NEED(whole(one, 2));
  sprout_json_adopt(command, "intent", one);
  sprout_json_adopt(command, "drawn", drawn);
  sprout_json_adopt(command, "steps", steps);
  return SPROUT_EVAL_OK;
}

/* `{"name", "detail"}` for what stopped the read, as its turn would say it: a budget spent, or the rule broken. */
static sprout_json *fault_of(inspecting *in, const sprout_parsed *parsed) {
  wasm_engine *e = in->e;
  sprout_json *one = object(e, 2);
  const char *name, *detail;
  if (one == NULL) return NULL;
  if (parsed != NULL && parsed->end == SPROUT_PARSED_FAULTED) {
    name = parsed->fault_name;
    detail = parsed->fault.text;
  } else if (in->run.meter->faulted) {
    name = "BudgetExhausted";
    detail = in->run.meter->fault.text;
  } else {
    name = in->run.fault.name == NULL ? "Error" : in->run.fault.name;
    detail = in->run.fault.text;
  }
  sprout_json_adopt(one, "name", copied_text(e, name));
  sprout_json_adopt(one, "detail", copied_text(e, detail));
  return one->count == 2 ? one : NULL;
}

/*
 * One command of the line, `{"text"}` and what it came to: `"faulted"`; `"answered"`; `"reading"`, `"drawn"` and
 * `"refused"`; or `"intent"`, `"drawn"` and `"steps"`. A visit the parse refuses is the host's defect, its words in `refusal`.
 */
static sprout_status inspect(wasm_engine *e, const char *visit, sprout_str text, sprout_json **out, sprout_fault *refusal) {
  inspecting in;
  sprout_parsed parsed;
  parse_turned turned;
  const sprout_stored_visitor *visitor;
  const sprout_stored_instance *person;
  sprout_json *command;
  sprout_eval_status eval;
  sprout_status status;
  memset(&in, 0, sizeof in);
  in.e = e;
  status = turn_open(&in.run, e->world, e->state, &e->host, SPROUT_TURN_COMMAND, 0, 0, NULL, NULL);
  if (status != SPROUT_OK) return status;
  status = parse_command_turn(&in.run, visit, text, NULL, &e->scratch, &parsed, &turned);
  if (status != SPROUT_OK) {
    *refusal = parsed.fault;
    turn_drop(&in.run);
    return status;
  }
  visitor = sprout_draft_visitor(&in.run.draft, (sprout_str){visit, strlen(visit)});
  person = sprout_draft_instance(&in.run.draft, visitor->instance);
  in.actor = visitor->instance;
  in.here = person->container;
  in.frame = sprout_exec_frame(&in.run.x, in.actor, NULL, NULL);
  in.reading.world = e->world;
  in.reading.graph = &e->world->graph;
  in.reading.draft = &in.run.draft;
  in.reading.turn = in.run.x.turn;
  in.reading.meter = in.run.meter;
  in.reading.fault = &in.run.fault;
  in.reading.reader = in.actor;
  command = object(e, 4);
  if (command != NULL) sprout_json_adopt(command, "text", copied(e, text));
  if (command == NULL || command->count != 1) {
    turn_drop(&in.run);
    return SPROUT_NO_MEMORY;
  }
  switch (parsed.end) {
    case SPROUT_PARSED_FAULTED:
      eval = SPROUT_EVAL_FAULT;
      break;
    case SPROUT_PARSED_ANSWERED:
      eval = answered(&in, &turned.said, command);
      break;
    case SPROUT_PARSED_READING:
      eval = read_as_verb(&in, &parsed, &turned, command);
      break;
    case SPROUT_PARSED_INTENT:
    default:
      eval = read_as_intent(&in, &parsed, &turned, command);
      break;
  }
  /* Each reading adds its members only once it is whole, so a command that faulted holds its text alone. */
  if (eval == SPROUT_EVAL_FAULT || eval == SPROUT_EVAL_ENGINE) {
    sprout_json_adopt(command, "faulted", fault_of(&in, parsed.end == SPROUT_PARSED_FAULTED ? &parsed : NULL));
    eval = command->count == 2 ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
  }
  turn_drop(&in.run);
  if (eval != SPROUT_EVAL_OK) return SPROUT_NO_MEMORY;
  *out = command;
  return SPROUT_OK;
}

/*
 * What the line a visitor typed would make, read over the live state and writing nothing, the input holding
 * `{"visit", "text"}`: every command it holds, in order, each read against the world as it stands now (inspect).
 */
EXPORT("sw_parse") int sw_parse(size_t length) {
  wasm_engine *e = &the_engine;
  sprout_json *root, *commands;
  sprout_str *parts;
  sprout_fault refusal;
  const char *visit, *words;
  size_t count, i;
  int status;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  status = engine_input_json(e, length, "The line is not JSON.", &root);
  if (status != SPROUT_OK) return status;
  visit = engine_string_at(root, "visit");
  words = engine_string_at(root, "text");
  if (visit == NULL || words == NULL) return engine_refuse(e, "A line names its visit and the words typed.");
  status = sprout_line_parts(&e->scratch, (sprout_str){words, strlen(words)}, &parts, &count);
  if (status != SPROUT_OK) return status;
  if ((commands = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, count)) == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < count; i++) {
    sprout_json *command = NULL;
    refusal.text[0] = '\0';
    status = inspect(e, visit, parts[i], &command, &refusal);
    if (status != SPROUT_OK) return refusal.text[0] == '\0' ? status : engine_answer_text(e, status, refusal.text);
    sprout_json_adopt(commands, NULL, command);
  }
  return engine_answer_json(e, commands);
}
