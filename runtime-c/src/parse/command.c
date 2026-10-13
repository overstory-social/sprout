/*
 * A typed line read as the command turn it begins reads it (the spec's Parsing > Matching a line, When nothing
 * matches; The runtime > Turns): over a draft of the committed state that is never committed, under a command
 * turn's meter and the stream begun from the host's seed, so the steps it spends and the draws it makes are the
 * turn's own. The order is the TypeScript parser's, since every step is charged where it is: the ways out of the
 * actor's place, then the words, then what the actor can reach and whether they stand in the dark, then each
 * placement of each phrase. A line no phrase places is `unknown`.
 */
#include <string.h>

#include "../exits.h"
#include "../prose/prose.h"
#include "../turn.h"
#include "../typed.h"
#include "parse.h"

sprout_str parse_without_question(sprout_str line) {
  size_t at = 0, width, end = 0;
  bool before = false;
  sprout_str rest;
  while (at < line.length) {
    if (!prose_is_space(prose_decode(line.bytes, line.length, at, &width))) end = at + width;
    at += width;
  }
  if (end == 0 || line.bytes[end - 1] != '?') return line;
  for (at = 0; at < end - 1 && !before; at += width)
    before = !prose_is_space(prose_decode(line.bytes, end - 1, at, &width));
  if (!before) return line;
  rest.bytes = line.bytes;
  rest.length = end - 1;
  return rest;
}

#ifdef SPROUT_NO_PARSER

sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out) {
  static const char words[] = "this runtime was built without the parser, so it reads no typed line.";
  (void)world, (void)state, (void)host, (void)visit, (void)line, (void)length, (void)handed, (void)keep;
  if (out == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  memcpy(out->fault.text, words, sizeof words);
  return SPROUT_BAD_INPUT;
}

#else

/* One read of a line: the turn it is read under, who typed it, where they stand, and where the outcome goes. */
typedef struct reader {
  turn_run run;
  sprout_frame frame;
  sprout_str actor, here;
  sprout_arena *keep;
  sprout_parsed *out;
} reader;

/* Words for a call the runtime will not read, in the outcome's fault text; SPROUT_BAD_INPUT. */
static sprout_status refuse(sprout_parsed *out, const char *before, const char *name, const char *after) {
  size_t room = sizeof out->fault.text, used = 0, i;
  const char *parts[3];
  parts[0] = before;
  parts[1] = name;
  parts[2] = after;
  for (i = 0; i < 3; i++) {
    size_t n = strlen(parts[i]);
    if (n > room - used - 1) n = room - used - 1;
    memcpy(out->fault.text + used, parts[i], n);
    used += n;
  }
  out->fault.text[used] = '\0';
  return SPROUT_BAD_INPUT;
}

static bool kept(sprout_arena *keep, sprout_str from, sprout_str *to) {
  to->bytes = sprout_arena_copy(keep, from.bytes, from.length);
  to->length = from.length;
  return to->bytes != NULL;
}

/* Counts each placement: a line a phrase places is read by what fills its slots. */
static sprout_eval_status placed(void *context, const parse_span *spans, size_t count) {
  (void)spans, (void)count;
  (*(size_t *)context)++;
  return SPROUT_EVAL_OK;
}

/* How many ways the world's phrases and its intents' place `words`. */
static sprout_eval_status placements(reader *r, const sprout_str *words, size_t count, size_t *found) {
  const sprout_world *world = r->run.world;
  size_t i;
  *found = 0;
  for (i = 0; i < world->phrase_count; i++) {
    const sprout_typed_phrase *phrase = &world->phrases[i];
    sprout_eval_status status =
        parse_slot_spans(&r->run.scratch, phrase->parts, phrase->part_count, words, count, placed, found);
    if (status != SPROUT_EVAL_OK) return status;
  }
  for (i = 0; i < world->intent_phrase_count; i++) {
    const sprout_typed_intent_phrase *phrase = &world->intent_phrases[i];
    sprout_eval_status status =
        parse_slot_spans(&r->run.scratch, phrase->parts, phrase->part_count, words, count, placed, found);
    if (status != SPROUT_EVAL_OK) return status;
  }
  return SPROUT_EVAL_OK;
}

static bool is_word(sprout_str word, const char *text) {
  return word.length == strlen(text) && memcmp(word.bytes, text, word.length) == 0;
}

/*
 * Whether an `and` or a comma might join two commands: one with words after it and a word not a comma before it
 * (the spec's Parsing > Sequences, again and all). Which of them do is decided by the words after each.
 */
static bool may_chain(const sprout_str *words, size_t count) {
  size_t at;
  bool before = false;
  for (at = 0; at + 1 < count; at++) {
    bool connector = is_word(words[at], "and") || is_word(words[at], ",");
    if (connector && before) return true;
    if (!is_word(words[at], ",")) before = true;
  }
  return false;
}

/* The answer `name`, said to the actor where they stand, with `actor` and `here` bound. */
static sprout_status answer(reader *r, const char *name) {
  sprout_parsed *out = r->out;
  sprout_speech said;
  sprout_str by;
  sprout_said_binding *bound = (sprout_said_binding *)sprout_arena_take(r->keep, 2 * sizeof *bound);
  if (bound == NULL) return SPROUT_NO_MEMORY;
  sprout_engine_said(&r->frame, name, &r->actor, &r->here, &by, &said);
  out->end = SPROUT_PARSED_ANSWERED;
  out->line = said.name;
  if (said.kind == SPROUT_SPEECH_ENGINE) out->words = prose_stock_words(said.name);
  out->absent = said.kind == SPROUT_SPEECH_ABSENT;
  bound[0].name = "actor";
  bound[0].object = true;
  bound[1].name = "here";
  bound[1].object = true;
  if (!kept(r->keep, by, &out->by) || !kept(r->keep, r->actor, &bound[0].text) || !kept(r->keep, r->here, &bound[1].text))
    return SPROUT_NO_MEMORY;
  out->bindings = bound;
  out->binding_count = 2;
  return SPROUT_OK;
}

/* A read that faulted: the turn it begins is abandoned, as one whose parse spends its budget is. */
static void faulted(reader *r) {
  sprout_parsed *out = r->out;
  out->end = SPROUT_PARSED_FAULTED;
  if (r->run.meter->faulted) {
    out->fault = r->run.meter->fault;
    out->fault_name = "BudgetExhausted";
    return;
  }
  out->fault_name = r->run.fault.name == NULL ? "Error" : r->run.fault.name;
  out->fault.budget = out->fault_name;
  memcpy(out->fault.text, r->run.fault.text, sizeof out->fault.text - 1);
  out->fault.text[sizeof out->fault.text - 1] = '\0';
}

/* Reads the words of a line typed by the actor, who stands in a place; anything but SPROUT_OK leaves `out` refused. */
static sprout_status read_line(reader *r, const sprout_stored_visitor *visitor, sprout_str line) {
  const sprout_way *ways;
  const sprout_reached *reached;
  sprout_str *words;
  size_t way_count, reached_count, count, found;
  bool dark;
  sprout_eval_status status = sprout_ways_from(&r->frame, r->here, &ways, &way_count);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (typed_words(&r->run.scratch, parse_without_question(line), &words, &count) != SPROUT_OK) return SPROUT_NO_MEMORY;
  if (count == 0) return answer(r, "unknown");
  status = sprout_range_of(&r->frame, r->actor, NULL, &reached, &reached_count);
  if (status == SPROUT_EVAL_OK) status = sprout_in_the_dark(&r->frame, r->actor, &dark);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (count == 1 && (is_word(words[0], "again") || is_word(words[0], "g"))) {
    if (!visitor->has_reading) return answer(r, "unknown");
    return refuse(r->out, "", "`again` after a reading", " is not read by this runtime yet.");
  }
  if (may_chain(words, count))
    return refuse(r->out, "", "a line `and` or a comma may split", " is not read by this runtime yet.");
  status = placements(r, words, count, &found);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    faulted(r);
    return SPROUT_OK;
  }
  if (found > 0) return refuse(r->out, "", "a line a phrase places", " is not read by this runtime yet.");
  return answer(r, "unknown");
}

sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out) {
  reader r;
  const sprout_stored_visitor *visitor;
  const sprout_stored_instance *instance;
  sprout_status status;
  if (out == NULL || keep == NULL) return SPROUT_BAD_HOST;
  memset(out, 0, sizeof *out);
  if (world == NULL || state == NULL || host == NULL || host->seed == NULL || visit == NULL || line == NULL)
    return refuse(out, "a parse names a world, a state, a host with a seed, a visit and a line.", "", "");
  if (handed != NULL) return refuse(out, "", "a turn a line handed", " is not read by this runtime yet.");
  memset(&r, 0, sizeof r);
  r.keep = keep;
  r.out = out;
  status = turn_open(&r.run, world, state, host, SPROUT_TURN_COMMAND, host->seed(host->ctx), 0, NULL, NULL);
  if (status != SPROUT_OK) return status;
  visitor = sprout_draft_visitor(&r.run.draft, (sprout_str){visit, strlen(visit)});
  instance = visitor == NULL ? NULL : sprout_draft_instance(&r.run.draft, visitor->instance);
  if (visitor == NULL) {
    status = refuse(out, "`", visit, "` has never visited this world.");
  } else if (instance == NULL || !instance->has_container) {
    status = refuse(out, "`", visit, "` is not in this world, so cannot type in it.");
  } else {
    r.actor = visitor->instance;
    r.here = instance->container;
    r.frame = sprout_exec_frame(&r.run.x, r.actor, NULL, NULL);
    if (!turn_stands_in_place(&r.frame, r.actor))
      status = refuse(out, "`", visit, "` stands in a place that is gone: the turn moves them, and reads nothing.");
    else
      status = read_line(&r, visitor, (sprout_str){line, length});
  }
  out->steps = r.run.meter->steps;
  turn_drop(&r.run);
  if (status != SPROUT_OK) {
    char text[sizeof out->fault.text];
    memcpy(text, out->fault.text, sizeof text);
    memset(out, 0, sizeof *out);
    memcpy(out->fault.text, text, sizeof text);
  }
  return status;
}

#endif
