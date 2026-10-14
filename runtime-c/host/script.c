/* Plays a script through the runtime's turn call, its typed lines read by the runtime; see script.h. */
#include "script.h"

#include <stdlib.h>
#include <string.h>

#include "json.h"
#include "seeds.h"
#include "state.h"

/* What a step has told so far: the lines readers read, as JSON text. */
typedef struct texts {
  const char **items;
  size_t count, capacity;
} texts;

typedef struct play {
  sproutc_host *host;
  sprout_world *world;
  sprout_state *state;
  FILE *out, *err;
  sprout_arena arena; /* what one step holds, reset when it ends */
  texts says;
  uint64_t now;       /* seconds on the script's clock */
  int failure;        /* an exit code, once a call the host should not have made was refused */
  bool offered;       /* each command's reading is looked for in the view first */
  size_t checked;     /* readings the view was asked for */
  size_t unoffered;   /* of those, the ones it did not offer: the play goes on, and fails at its end */
  uint64_t widest;    /* the most steps a poll spent */
} play;

static const char *push(play *p, texts *list, const char *text) {
  if (list->count == list->capacity) {
    size_t wanted = list->capacity == 0 ? 16 : list->capacity * 2;
    const char **bigger = (const char **)sprout_arena_take(&p->arena, wanted * sizeof *bigger);
    if (bigger == NULL) return NULL;
    if (list->count > 0) memcpy(bigger, list->items, list->count * sizeof *bigger);
    list->items = bigger;
    list->capacity = wanted;
  }
  list->items[list->count++] = text;
  return text;
}

/* ---- building JSON ---- */

static sprout_json *jtext(play *p, const char *text, size_t length) { return sprout_json_text(&p->arena, text, length); }
static sprout_json *jstr(play *p, const char *text) { return jtext(p, text, strlen(text)); }
static sprout_json *jstr_of(play *p, sprout_str text) { return jtext(p, text.bytes, text.length); }

static const char *written(play *p, const sprout_json *node) {
  const char *bytes;
  size_t length;
  if (node == NULL || sprout_json_write_value(&p->arena, node, &bytes, &length) != SPROUT_OK) return NULL;
  return bytes;
}

static const char *kind_name(sprout_turn_kind kind) {
  switch (kind) {
    case SPROUT_TURN_COMMAND:
      return "command";
    case SPROUT_TURN_TICK:
      return "tick";
    case SPROUT_TURN_WAKE:
      return "wake";
    case SPROUT_TURN_MAINTENANCE:
      return "maintenance";
    case SPROUT_TURN_POLL:
      return "poll";
    case SPROUT_TURN_ARRIVAL:
      return "arrival";
    case SPROUT_TURN_DEPARTURE:
      return "departure";
  }
  return "";
}

static const char *line_kind_name(sprout_line_kind kind) {
  switch (kind) {
    case SPROUT_LINE_SAID:
      return "said";
    case SPROUT_LINE_TOLD:
      return "told";
    case SPROUT_LINE_REFUSED:
      return "refused";
    case SPROUT_LINE_DESCRIBED:
      return "described";
    case SPROUT_LINE_NOTICE:
      return "notice";
    case SPROUT_LINE_EXTENSION:
      return "extension";
  }
  return "";
}

/* The visitor a visit key names, by the nickname they came in with. */
static sprout_str nickname_of(play *p, const char *visit, size_t length) {
  sprout_str key;
  const sprout_stored_visitor *record;
  key.bytes = visit;
  key.length = length;
  record = sprout_state_find_visitor(p->state, key);
  return record == NULL ? key : record->nickname;
}

/* ---- one turn ---- */

/* Says each line a turn told, as `Nickname (kind): words`, and notes it for the trace. */
static bool tell(play *p, const sprout_outcome *outcome) {
  size_t i;
  for (i = 0; i < outcome->line_count; i++) {
    const sprout_line *line = &outcome->lines[i];
    sprout_str nick = nickname_of(p, line->recipient, line->recipient_length);
    sprout_json *one = sprout_json_make(&p->arena, SPROUT_JSON_OBJECT, 3);
    if (one == NULL) return false;
    sprout_json_adopt(one, "reader", jstr_of(p, nick));
    sprout_json_adopt(one, "kind", jstr(p, line_kind_name(line->kind)));
    sprout_json_adopt(one, "words", jtext(p, line->text, line->text_length));
    if (push(p, &p->says, written(p, one)) == NULL) return false;
    fprintf(p->out, "%.*s (%s): %.*s\n", (int)nick.length, nick.bytes, line_kind_name(line->kind), (int)line->text_length,
            line->text);
  }
  return true;
}

/* Runs one turn of the runtime and tells what it said; false once the play cannot go on. */
static bool run(play *p, sprout_turn_input *input, uint64_t seed, sprout_outcome *outcome) {
  sprout_status status;
  input->instant = p->now;
  sproutc_host_set_seed(p->host, seed);
  sproutc_host_begin_turn(p->host);
  status = sprout_run_turn(p->world, p->state, &p->host->record, input, outcome);
  if (status != SPROUT_OK) {
    fprintf(p->out, "!! %s\n", status == SPROUT_BAD_INPUT ? outcome->fault.text : sprout_status_text(status));
    p->failure = 1;
    return false;
  }
  if (outcome->faulted) fprintf(p->out, "!! a %s turn faulted, %s: %s\n", kind_name(input->kind), outcome->fault_name, outcome->fault.text);
  return tell(p, outcome);
}

/* The seed of the `nth` turn the step under `seed` runs for `id`, as every host makes a tick's or a wake's (seeds.h). */
static uint64_t seed_for(const play *p, uint64_t seed, const char *id, uint64_t nth) {
  sprout_str path = sprout_path_of(p->world, (sprout_str){id, strlen(id)});
  return sprout_turn_seed(seed, path.bytes, path.length, nth);
}

static bool run_and_free(play *p, sprout_turn_input *input, uint64_t seed) {
  sprout_outcome outcome;
  bool ok = run(p, input, seed, &outcome);
  sprout_outcome_free(&outcome);
  return ok;
}

/* ---- the steps ---- */

static char *visit_of(play *p, const char *nickname) {
  size_t n = strlen(nickname);
  char *visit = (char *)sprout_arena_take(&p->arena, n + 7);
  if (visit == NULL) return NULL;
  memcpy(visit, "visit:", 6);
  memcpy(visit + 6, nickname, n + 1);
  return visit;
}

static bool arrive(play *p, const sproutc_step *step) {
  char *visit = visit_of(p, step->nickname);
  sprout_turn_input input;
  sprout_admission admission;
  sprout_status status;
  if (visit == NULL) return false;
  status = sprout_admit(p->world, p->state, &p->host->record, visit, step->nickname, strlen(step->nickname), &admission);
  if (status != SPROUT_OK) {
    fprintf(p->out, "!! %s\n", sprout_status_text(status));
    p->failure = 1;
    return false;
  }
  if (admission.reason != SPROUT_NICKNAME_OK) {
    fprintf(p->out, "nickname refused: %.*s\n", (int)admission.words.length, admission.words.bytes);
    sprout_admission_free(&admission);
    return true;
  }
  sprout_admission_free(&admission);
  /* Catch-up first, so nobody walks into a place about to rearrange itself, then the arrival. */
  memset(&input, 0, sizeof input);
  input.kind = SPROUT_TURN_MAINTENANCE;
  if (!run_and_free(p, &input, step->seed)) return false;
  memset(&input, 0, sizeof input);
  input.kind = SPROUT_TURN_ARRIVAL;
  input.visit = visit;
  input.nickname = step->nickname;
  input.nickname_length = strlen(step->nickname);
  return run_and_free(p, &input, step->seed);
}

static bool leave(play *p, const sproutc_step *step) {
  char *visit = visit_of(p, step->nickname);
  sprout_turn_input input;
  if (visit == NULL) return false;
  memset(&input, 0, sizeof input);
  input.kind = SPROUT_TURN_DEPARTURE;
  input.visit = visit;
  return run_and_free(p, &input, step->seed);
}

static bool tick(play *p, const sproutc_step *step) {
  sprout_places places;
  size_t i;
  bool ok = true;
  if (sprout_places_occupied(p->world, p->state, &p->host->record, &places) != SPROUT_OK) return false;
  for (i = 0; i < places.count && ok; i++) {
    sprout_turn_input input;
    char *place = sprout_arena_copy(&p->arena, places.ids[i].bytes, places.ids[i].length);
    if (place == NULL) {
      ok = false;
      break;
    }
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_TICK;
    input.place = place;
    ok = run_and_free(p, &input, seed_for(p, step->seed, place, 0));
  }
  sprout_places_free(&places);
  return ok;
}

/* How many times an object has woken in this advance. */
typedef struct woke {
  char *object;
  uint64_t count;
} woke;

static bool advance(play *p, const sproutc_step *step) {
  uint64_t until = p->now + step->for_seconds;
  woke *woken = NULL;
  size_t woken_count = 0, woken_capacity = 0;
  for (;;) {
    sprout_places places;
    sprout_wakes due;
    sprout_turn_input input;
    sprout_outcome outcome;
    woke *entry = NULL;
    size_t i;
    bool occupied, ok;
    if (sprout_places_occupied(p->world, p->state, &p->host->record, &places) != SPROUT_OK) return false;
    occupied = places.count > 0;
    sprout_places_free(&places);
    if (!occupied) break;
    if (sprout_wakes_due(p->world, p->state, &p->host->record, until, &due) != SPROUT_OK) return false;
    if (due.count == 0) {
      sprout_wakes_free(&due);
      break;
    }
    if (due.wakes[0].due_at > p->now) p->now = due.wakes[0].due_at;
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_WAKE;
    input.object = sprout_arena_copy(&p->arena, due.wakes[0].object.bytes, due.wakes[0].object.length);
    input.serial = due.wakes[0].serial;
    sprout_wakes_free(&due);
    if (input.object == NULL) return false;
    for (i = 0; i < woken_count && entry == NULL; i++)
      if (strcmp(woken[i].object, input.object) == 0) entry = &woken[i];
    if (entry == NULL) {
      if (woken_count == woken_capacity) {
        size_t wanted = woken_capacity == 0 ? 8 : woken_capacity * 2;
        woke *bigger = (woke *)sprout_arena_take(&p->arena, wanted * sizeof *bigger);
        if (bigger == NULL) return false;
        if (woken_count > 0) memcpy(bigger, woken, woken_count * sizeof *bigger);
        woken = bigger;
        woken_capacity = wanted;
      }
      entry = &woken[woken_count++];
      entry->object = (char *)input.object;
      entry->count = 0;
    }
    ok = run(p, &input, seed_for(p, step->seed, input.object, entry->count++), &outcome);
    sprout_outcome_free(&outcome);
    if (!ok) return false;
  }
  p->now = until;
  return true;
}

/* ---- what the view offers ---- */

/* Whether a value role's chosen value is among the options the view writes beside the reading. */
static bool value_offered(const sprout_seen_reading *reading, const sprout_filling *filling) {
  size_t i, j;
  for (i = 0; i < reading->options_count; i++) {
    const sprout_seen_options *options = &reading->options[i];
    if (strcmp(options->role, filling->role) != 0) continue;
    if (filling->binds == SPROUT_FILL_TEXT) {
      for (j = 0; options->symbol && j < options->option_count; j++)
        if (sprout_str_is(options->options[j].value, filling->text)) return true;
    } else {
      for (j = 0; !options->symbol && j < options->range_count; j++)
        if (filling->number >= options->ranges[j].min && filling->number <= options->ranges[j].max) return true;
    }
    return false;
  }
  return false;
}

/*
 * Whether `filler`, as the view offers it, is what `filling` has in the role: a thing by id, an exit by
 * where it leads and its direction, a set by the one member `member`, a value by its options.
 */
static bool filler_fits(const sprout_seen_reading *reading, const sprout_seen_filler *filler,
                        const sprout_filling *filling, const char *member) {
  switch (filling->binds) {
    case SPROUT_FILL_UNBOUND:
      return true;
    case SPROUT_FILL_OBJECT:
      return filler->binds == SPROUT_SEEN_OBJECT && sprout_str_is(filler->thing.id, filling->id);
    case SPROUT_FILL_SET:
      return filler->binds == SPROUT_SEEN_SET && filler->member_count == 1 && member != NULL &&
             sprout_str_is(filler->members[0].id, member);
    case SPROUT_FILL_EXIT:
      return filler->binds == SPROUT_SEEN_EXIT && sprout_str_is(filler->exit.to, filling->id) &&
             (filler->exit.direction == NULL) == (filling->direction == NULL) &&
             (filling->direction == NULL || strcmp(filler->exit.direction, filling->direction) == 0);
    case SPROUT_FILL_TEXT:
    case SPROUT_FILL_NUMBER:
      return filler->binds == SPROUT_SEEN_UNBOUND && value_offered(reading, filling);
  }
  return false;
}

/* Whether some reading the view offers is `read`, with `member` standing for its set role. */
static bool view_offers(const sprout_seen_view *view, const sprout_reading *read, const char *member) {
  size_t r, f, g;
  for (r = 0; r < view->reading_count; r++) {
    const sprout_seen_reading *reading = &view->readings[r];
    bool fits = strcmp(reading->verb, read->verb) == 0;
    for (f = 0; fits && f < read->filling_count; f++) {
      const sprout_filling *filling = &read->fillings[f];
      bool found = filling->binds == SPROUT_FILL_UNBOUND;
      for (g = 0; !found && g < reading->filler_count; g++) {
        const sprout_seen_filler *filler = &reading->fillers[g];
        if (strcmp(filler->role, filling->role) == 0) found = filler_fits(reading, filler, filling, member);
      }
      fits = found;
    }
    if (fits) return true;
  }
  return false;
}

/*
 * Polls the actor's view and looks for the reading in it, as the sentence builder must to make it.
 * A set role is offered one member at a time, so each member is looked for on its own. Says which
 * reading the view does not offer, or that the poll faulted, and counts it; the play goes on.
 */
static void offered(play *p, const char *visit, const sprout_reading *read, const char *typed, size_t index) {
  sprout_seen_view view;
  const sprout_filling *set = NULL;
  bool found = true;
  size_t f, i;
  p->checked++;
  if (sprout_view(p->world, p->state, &p->host->record, visit, &view) != SPROUT_OK) {
    fprintf(p->err, "sproutc: step %zu: the view could not be polled before `%s`.\n", index, typed);
    p->unoffered++;
    return;
  }
  if (view.steps > p->widest) p->widest = view.steps;
  for (f = 0; f < read->filling_count; f++)
    if (read->fillings[f].binds == SPROUT_FILL_SET) set = &read->fillings[f];
  if (view.faulted) {
    fprintf(p->err, "sproutc: step %zu: the poll before `%s` faulted (%s), so the view offers nothing.\n", index, typed,
            view.fault_name == NULL ? "" : view.fault_name);
    found = false;
  } else if (set == NULL) {
    found = view_offers(&view, read, NULL);
  } else {
    for (i = 0; found && i < set->id_count; i++) found = view_offers(&view, read, set->ids[i]);
    if (found && set->id_count == 0) found = view_offers(&view, read, NULL);
  }
  if (!found && !view.faulted)
    fprintf(p->err, "sproutc: step %zu: the view does not offer `%s`, so the sentence builder cannot make it.\n", index,
            typed);
  sprout_view_free(&view);
  if (!found) p->unoffered++;
}

/*
 * Before a command turn, the view polled for the reading the runtime reads the turn as, read under the turn's seed
 * over the state the turn begins from: a typed line as it is typed, a later turn of a line as it was handed. A
 * turn that reads no reading (the parser answered, or an intent planned the steps that follow) has nothing to
 * look for; a turn the runtime refuses to read says so when it runs.
 */
static bool offered_turn(play *p, const sprout_turn_input *input, uint64_t seed, const char *visit, size_t index) {
  sprout_parsed parsed;
  sprout_handed handed;
  sprout_status status;
  handed.planned = input->planned;
  handed.reread = input->reread;
  sproutc_host_set_seed(p->host, seed);
  status = sprout_parse(p->world, p->state, &p->host->record, visit, input->text, input->text_length,
                        input->planned == NULL ? NULL : &handed, &p->arena, &parsed);
  if (status == SPROUT_BAD_INPUT) return true;
  if (status != SPROUT_OK) {
    fprintf(p->err, "sproutc: step %zu: `%.*s` could not be read: %s\n", index, (int)input->text_length, input->text,
            sprout_status_text(status));
    p->failure = 1;
    return false;
  }
  if (parsed.end == SPROUT_PARSED_READING) {
    char *typed = sprout_arena_copy(&p->arena, input->text, input->text_length);
    if (typed == NULL) return false;
    offered(p, visit, &parsed.reading, typed, index);
  }
  return true;
}

/* The line typed, as the command turns it runs: the first under the step's seed, and each after it the next. */
static bool command(play *p, const sproutc_step *step) {
  char *visit = visit_of(p, step->nickname);
  sprout_commands line;
  sprout_turn_input input;
  bool more = false;
  uint64_t t;
  if (visit == NULL) return false;
  if (sprout_line_begin(&line, &p->arena, visit, step->typed, strlen(step->typed)) != SPROUT_OK ||
      sprout_line_next(&line, NULL, &input, &more) != SPROUT_OK)
    return false;
  for (t = 0; more; t++) {
    sprout_outcome outcome;
    sprout_status status;
    uint64_t seed = (step->seed + t) & 0xffffffffu;
    if (p->offered && !offered_turn(p, &input, seed, visit, step->index)) return false;
    if (!run(p, &input, seed, &outcome)) {
      sprout_outcome_free(&outcome);
      return false;
    }
    status = sprout_line_next(&line, &outcome, &input, &more);
    sprout_outcome_free(&outcome);
    if (status != SPROUT_OK) return false;
  }
  return true;
}

/* ---- the trace ---- */

static void trace_step(play *p, const sproutc_step *step, FILE *trace) {
  size_t i;
  if (trace == NULL) return;
  fprintf(trace, "{\"step\":%zu,\"says\":[", step->index);
  for (i = 0; i < p->says.count; i++) fprintf(trace, "%s%s", i > 0 ? "," : "", p->says.items[i]);
  fprintf(trace, "]}\n");
}

int sproutc_play_script(sproutc_host *host, sprout_world *world, sprout_state *state, const sproutc_steps *steps,
                        const sproutc_play_options *options, FILE *out, FILE *err, FILE *trace) {
  play p;
  size_t i;
  if (options->has_poll_steps) host->record.budgets.poll_steps = (sprout_limit){true, options->poll_steps};
  memset(&p, 0, sizeof p);
  p.offered = options->offered;
  p.host = host;
  p.world = world;
  p.state = state;
  p.out = out;
  p.err = err;
  fprintf(out, "--- play\n");
  for (i = 0; i < steps->count; i++) {
    const sproutc_step step = steps->steps[i];
    bool ok = true;
    if (step.kind == SPROUTC_STEP_COMMENT || step.kind == SPROUTC_STEP_SEED) continue;
    fprintf(out, "## step %zu: %s\n", step.index, step.line);
    p.now = step.at_seconds;
    sproutc_host_set_time(host, step.at_seconds);
    host->bytes_peak = host->bytes_held;
    if (sprout_arena_init(&p.arena, &host->record) != SPROUT_OK) return 1;
    memset(&p.says, 0, sizeof p.says);
    switch (step.kind) {
      case SPROUTC_STEP_ARRIVE:
        ok = arrive(&p, &step);
        break;
      case SPROUTC_STEP_LEAVE:
        ok = leave(&p, &step);
        break;
      case SPROUTC_STEP_TICK:
        ok = tick(&p, &step);
        break;
      case SPROUTC_STEP_ADVANCE:
        ok = advance(&p, &step);
        break;
      case SPROUTC_STEP_COMMAND:
        ok = command(&p, &step);
        break;
      case SPROUTC_STEP_COMMENT:
      case SPROUTC_STEP_SEED:
        break;
    }
    if (ok) trace_step(&p, &step, trace);
    sprout_arena_reset(&p.arena);
    if (options->profile != NULL)
      fprintf(options->profile, "{\"step\":%zu,\"held\":%zu,\"peak\":%zu}\n", step.index, host->bytes_held, host->bytes_peak);
    if (!ok) return p.failure == 0 ? 1 : p.failure;
  }
  if (p.offered) {
    fprintf(out, "--- offered: %zu of %zu readings, the widest poll %llu steps\n", p.checked - p.unoffered, p.checked,
            (unsigned long long)p.widest);
    if (p.unoffered > 0) return 1;
  }
  return 0;
}
