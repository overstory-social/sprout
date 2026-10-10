/* Plays a script's readings through the runtime's turn call; see script.h. */
#include "script.h"

#include <stdlib.h>
#include <string.h>

#include "json.h"
#include "state.h"

/* What a step has told so far: the lines readers read and the entries of the turns that ran, as JSON text. */
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
  texts says, turns;
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

static sprout_json *jnumber(play *p, double number) {
  sprout_json *node = sprout_json_make(&p->arena, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = number;
  return node;
}

static sprout_json *jnull(play *p) { return sprout_json_make(&p->arena, SPROUT_JSON_NULL, 0); }

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

static const char *outcome_name(sprout_turn_result result) {
  switch (result) {
    case SPROUT_RESULT_DONE:
      return "done";
    case SPROUT_RESULT_FAULTED:
      return "faulted";
    case SPROUT_RESULT_REFUSED:
      return "refused";
    case SPROUT_RESULT_CLOSED:
      return "closed";
    case SPROUT_RESULT_IDLE:
      return "idle";
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

/* A list of wakes as the entry names them. */
static sprout_json *wakes_json(play *p, size_t count, const sprout_logged_wake *wakes, bool with_fault) {
  sprout_json *list = sprout_json_make(&p->arena, SPROUT_JSON_ARRAY, count);
  size_t i;
  for (i = 0; list != NULL && i < count; i++) {
    sprout_json *one = sprout_json_make(&p->arena, SPROUT_JSON_OBJECT, 4);
    if (one == NULL) return NULL;
    sprout_json_adopt(one, "object", jstr_of(p, wakes[i].object));
    sprout_json_adopt(one, "serial", jnumber(p, (double)wakes[i].serial));
    if (with_fault) {
      sprout_json_adopt(one, "fault", jstr(p, wakes[i].fault_name == NULL ? "" : wakes[i].fault_name));
      sprout_json_adopt(one, "detail", jstr_of(p, wakes[i].fault_detail));
    }
    sprout_json_adopt(list, NULL, one);
  }
  return list;
}

/* The entry the log keeps of a turn that ran, in the shape the TypeScript player records: see player/src/readings.ts. */
static const char *record_of(play *p, const sprout_turn_input *input, const sprout_outcome *outcome) {
  sprout_json *record = sprout_json_make(&p->arena, SPROUT_JSON_OBJECT, 14), *effects, *cuts, *paragraphs;
  const sprout_log_entry *log = &outcome->log;
  size_t i, j;
  (void)input;
  if (record == NULL) return NULL;
  sprout_json_adopt(record, "kind", jstr(p, kind_name(log->kind)));
  sprout_json_adopt(record, "seed", jnumber(p, (double)log->seed));
  sprout_json_adopt(record, "seconds", jnumber(p, (double)log->seconds));
  sprout_json_adopt(record, "who", log->who.length == 0 ? jnull(p) : jstr_of(p, log->who));
  sprout_json_adopt(record, "outcome", jstr(p, outcome_name(outcome->result)));
  sprout_json_adopt(record, "fault", log->faulted ? jstr(p, log->fault_name) : jnull(p));
  sprout_json_adopt(record, "detail", log->faulted ? jstr_of(p, log->fault_detail) : jnull(p));
  sprout_json_adopt(record, "serial", jnumber(p, (double)log->serial));
  effects = sprout_json_make(&p->arena, SPROUT_JSON_ARRAY, outcome->effect_count);
  cuts = sprout_json_make(&p->arena, SPROUT_JSON_ARRAY, outcome->cut_count);
  if (effects == NULL || cuts == NULL) return NULL;
  for (i = 0; i < outcome->effect_count; i++) {
    const sprout_told_effect *effect = &outcome->effects[i];
    sprout_json *one = sprout_json_make(&p->arena, SPROUT_JSON_OBJECT, 9), *notes;
    if (one == NULL) return NULL;
    paragraphs = sprout_json_make(&p->arena, SPROUT_JSON_ARRAY, effect->line_count);
    notes = sprout_json_make(&p->arena, SPROUT_JSON_ARRAY, effect->written_count);
    if (paragraphs == NULL || notes == NULL) return NULL;
    for (j = 0; j < effect->written_count; j++) {
      const sprout_written *noted = &effect->written[j];
      sprout_json *where = sprout_json_make(&p->arena, SPROUT_JSON_OBJECT, 3);
      if (where == NULL) return NULL;
      if (noted->passage) {
        sprout_json_adopt(where, "passage", jstr(p, noted->name));
        sprout_json_adopt(where, "origin", jstr(p, noted->origin));
        sprout_json_adopt(where, "at", jstr(p, noted->at));
      } else {
        sprout_json_adopt(where, "line", jstr(p, noted->at));
      }
      sprout_json_adopt(notes, NULL, where);
    }
    for (j = 0; j < effect->line_count; j++)
      sprout_json_adopt(paragraphs, NULL,
                        jtext(p, outcome->lines[effect->line_first + j].text, outcome->lines[effect->line_first + j].text_length));
    sprout_json_adopt(one, "kind", jstr(p, line_kind_name(effect->kind)));
    sprout_json_adopt(one, "from", jstr_of(p, effect->from));
    sprout_json_adopt(one, "to", jstr_of(p, effect->to));
    sprout_json_adopt(one, "visit", jstr_of(p, effect->visit));
    sprout_json_adopt(one, "paragraphs", paragraphs);
    sprout_json_adopt(one, "written", notes);
    if (effect->extension != NULL) {
      sprout_json *payload = NULL;
      sprout_json_error error;
      if (effect->payload.length > 0 &&
          sprout_json_read(&p->arena, effect->payload.bytes, effect->payload.length, &payload, &error) != SPROUT_OK)
        return NULL;
      sprout_json_adopt(one, "extension", jstr(p, effect->extension));
      sprout_json_adopt(one, "statement", jstr(p, effect->statement));
      if (payload != NULL) sprout_json_adopt(one, "payload", payload);
    }
    sprout_json_adopt(effects, NULL, one);
  }
  for (i = 0; i < outcome->cut_count; i++)
    sprout_json_adopt(cuts, NULL, jtext(p, outcome->cuts[i].recipient, outcome->cuts[i].recipient_length));
  sprout_json_adopt(record, "effects", effects);
  sprout_json_adopt(record, "cutShort", cuts);
  if (log->kind == SPROUT_TURN_MAINTENANCE) {
    sprout_json_adopt(record, "delivered", wakes_json(p, log->delivered_count, log->delivered, false));
    sprout_json_adopt(record, "faulted", wakes_json(p, log->faulted_count, log->faulted_wakes, true));
    sprout_json_adopt(record, "abandoned", wakes_json(p, log->abandoned_count, log->abandoned, false));
  }
  return written(p, record);
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

/* Runs one turn of the runtime, tells what it said and notes its entry; false once the play cannot go on. */
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
  if (outcome->has_log) {
    const char *record = record_of(p, input, outcome);
    if (record == NULL || push(p, &p->turns, record) == NULL) {
      p->failure = 1;
      return false;
    }
  }
  return tell(p, outcome);
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
    ok = run_and_free(p, &input, step->seed);
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
    input.nth = entry->count++;
    ok = run(p, &input, step->seed, &outcome);
    sprout_outcome_free(&outcome);
    if (!ok) return false;
  }
  p->now = until;
  return true;
}

/* A reading's fillings from the TypeScript parser's fillers, by id. */
static const char *fillings_of(play *p, const sprout_json *fillers, sprout_filling **out, size_t *count) {
  sprout_filling *found = (sprout_filling *)sprout_arena_take(&p->arena, (fillers->count + 1) * sizeof *found);
  size_t i, j;
  if (found == NULL) return "the host cannot give the reading memory.";
  for (i = 0; i < fillers->count; i++) {
    const sprout_json *one = fillers->items[i], *role = sprout_json_get(one, "role"), *binds = sprout_json_get(one, "binds");
    const sprout_json *id = sprout_json_get(one, "id"), *ids = sprout_json_get(one, "ids");
    const sprout_json *direction = sprout_json_get(one, "direction"), *label = sprout_json_get(one, "label");
    const sprout_json *to = sprout_json_get(one, "to"), *value = sprout_json_get(one, "value");
    if (role == NULL || binds == NULL || role->kind != SPROUT_JSON_STRING || binds->kind != SPROUT_JSON_STRING)
      return "a filler in the readings file has no role or binds.";
    found[i].role = role->bytes;
    if (strcmp(binds->bytes, "unbound") == 0) {
      found[i].binds = SPROUT_FILL_UNBOUND;
    } else if (strcmp(binds->bytes, "object") == 0 && id != NULL) {
      found[i].binds = SPROUT_FILL_OBJECT;
      found[i].id = id->bytes;
    } else if (strcmp(binds->bytes, "set") == 0 && ids != NULL) {
      const char **list = (const char **)sprout_arena_take(&p->arena, (ids->count + 1) * sizeof *list);
      if (list == NULL) return "the host cannot give the reading memory.";
      for (j = 0; j < ids->count; j++) list[j] = ids->items[j]->bytes;
      found[i].binds = SPROUT_FILL_SET;
      found[i].ids = list;
      found[i].id_count = ids->count;
    } else if (strcmp(binds->bytes, "exit") == 0 && to != NULL && label != NULL) {
      found[i].binds = SPROUT_FILL_EXIT;
      found[i].id = to->bytes;
      found[i].label = label->bytes;
      found[i].direction = direction == NULL || direction->kind != SPROUT_JSON_STRING ? NULL : direction->bytes;
    } else if (strcmp(binds->bytes, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_STRING) {
      found[i].binds = SPROUT_FILL_TEXT;
      found[i].text = value->bytes;
    } else if (strcmp(binds->bytes, "value") == 0 && value != NULL && value->kind == SPROUT_JSON_NUMBER) {
      found[i].binds = SPROUT_FILL_NUMBER;
      found[i].number = value->number;
    } else {
      return "a filler in the readings file fills a role with what no role takes.";
    }
  }
  *out = found;
  *count = fillers->count;
  return NULL;
}

/* What the parser drew and said while it read the line, as the reading carries it. */
static const char *parsing_of(play *p, const sproutc_turn_reading *turn, sprout_reading *read) {
  size_t i;
  if (turn->draws != NULL && turn->draws->count > 0) {
    uint64_t *bounds = (uint64_t *)sprout_arena_take(&p->arena, turn->draws->count * sizeof *bounds);
    if (bounds == NULL) return "the host cannot give the reading memory.";
    for (i = 0; i < turn->draws->count; i++) bounds[i] = (uint64_t)turn->draws->items[i]->number;
    read->draw_count = turn->draws->count;
    read->draws = bounds;
  }
  if (turn->asides != NULL && turn->asides->count > 0) {
    sprout_aside *asides = (sprout_aside *)sprout_arena_take(&p->arena, turn->asides->count * sizeof *asides);
    if (asides == NULL) return "the host cannot give the reading memory.";
    for (i = 0; i < turn->asides->count; i++) {
      const sprout_json *one = turn->asides->items[i], *line = sprout_json_get(one, "line"),
                        *thing = sprout_json_get(one, "thing"), *pronoun = sprout_json_get(one, "pronoun");
      if (line == NULL || thing == NULL) return "an aside in the readings file names no line or thing.";
      asides[i].line = line->bytes;
      asides[i].thing = thing->bytes;
      asides[i].pronoun = pronoun == NULL || pronoun->kind != SPROUT_JSON_STRING ? NULL : pronoun->bytes;
    }
    read->aside_count = turn->asides->count;
    read->asides = asides;
  }
  return NULL;
}

/* A turn the parser answered: its lines and its entry, echoed as the readings file holds them. */
static bool echo(play *p, const sproutc_turn_reading *turn) {
  size_t i;
  fprintf(p->out, "-- the parser answered: %s\n", turn->why);
  for (i = 0; turn->says != NULL && i < turn->says->count; i++) {
    const sprout_json *one = turn->says->items[i];
    const sprout_json *reader = sprout_json_get(one, "reader"), *kind = sprout_json_get(one, "kind"),
                      *words = sprout_json_get(one, "words");
    if (reader == NULL || kind == NULL || words == NULL) return false;
    if (push(p, &p->says, written(p, one)) == NULL) return false;
    fprintf(p->out, "%s (%s): %s\n", reader->bytes, kind->bytes, words->bytes);
  }
  if (turn->expect != NULL && push(p, &p->turns, written(p, turn->expect)) == NULL) return false;
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

static bool command(play *p, const sproutc_step *step) {
  char *visit = visit_of(p, step->nickname);
  size_t t;
  if (visit == NULL) return false;
  for (t = 0; t < step->turns; t++) {
    sproutc_turn_reading reading;
    sprout_turn_input input;
    sprout_reading read;
    sprout_filling *fillings;
    size_t count;
    const char *why = sproutc_readings_turn(step, t, &reading);
    if (why != NULL) {
      fprintf(p->err, "sproutc: %s\n", why);
      p->failure = 1;
      return false;
    }
    if (reading.skip) {
      if (!echo(p, &reading)) return false;
      continue;
    }
    why = fillings_of(p, reading.fillers, &fillings, &count);
    if (why != NULL) {
      fprintf(p->err, "sproutc: %s\n", why);
      p->failure = 1;
      return false;
    }
    memset(&read, 0, sizeof read);
    why = parsing_of(p, &reading, &read);
    if (why != NULL) {
      fprintf(p->err, "sproutc: %s\n", why);
      p->failure = 1;
      return false;
    }
    read.verb = reading.verb;
    read.actor = reading.actor;
    read.filling_count = count;
    read.fillings = fillings;
    memset(&input, 0, sizeof input);
    input.kind = SPROUT_TURN_COMMAND;
    input.visit = visit;
    input.reading = &read;
    input.text = reading.typed;
    input.text_length = strlen(reading.typed);
    if (p->offered) offered(p, visit, &read, reading.typed, step->index);
    if (!run_and_free(p, &input, reading.seed)) return false;
  }
  return true;
}

/* ---- the budgets ---- */

/* The host's budgets, less any the readings were played under, named as the TypeScript runtime names them. */
static const char *budgets_of(sproutc_host *host, const sprout_json *given) {
  sprout_budgets *b = &host->record.budgets;
  struct {
    const char *name;
    sprout_limit *limit;
  } rows[] = {{"steps", &b->steps},
              {"pollSteps", &b->poll_steps},
              {"output", &b->output},
              {"events", &b->events},
              {"cascadeDepth", &b->cascade_depth},
              {"passageDepth", &b->passage_depth},
              {"setRoleObjects", &b->set_role_objects},
              {"spawnsPerTurn", &b->spawns},
              {"shortestWakeSeconds", &b->shortest_wake_seconds},
              {"pendingWakesPerObject", &b->pending_wakes},
              {"peoplePerPlace", &b->people_per_place},
              {"extensionEffects", &b->extension_effects},
              {"nicknameCharacters", &b->nickname_characters},
              {"wallClockMs", &b->wall_clock_ms}};
  size_t i, j;
  for (i = 0; given != NULL && i < given->count; i++) {
    bool found = false;
    for (j = 0; j < sizeof rows / sizeof *rows && !found; j++) {
      if (strcmp(given->items[i]->key, rows[j].name) != 0) continue;
      found = true;
      rows[j].limit->set = given->items[i]->kind == SPROUT_JSON_NUMBER;
      rows[j].limit->value = rows[j].limit->set ? (uint64_t)given->items[i]->number : 0;
    }
    if (!found) return "the readings file sets a budget this host has no row for.";
  }
  return NULL;
}

/* ---- the trace ---- */

static void trace_step(play *p, const sproutc_step *step, FILE *trace) {
  const char *world;
  size_t length, i;
  if (trace == NULL) return;
  if (sprout_state_write(p->state, &world, &length) != SPROUT_OK) return;
  fprintf(trace, "{\"step\":%zu,\"says\":[", step->index);
  for (i = 0; i < p->says.count; i++) fprintf(trace, "%s%s", i > 0 ? "," : "", p->says.items[i]);
  fprintf(trace, "],\"turns\":[");
  for (i = 0; i < p->turns.count; i++) fprintf(trace, "%s%s", i > 0 ? "," : "", p->turns.items[i]);
  fprintf(trace, "],\"world\":%.*s}\n", (int)length, world);
}

int sproutc_play_script(sproutc_host *host, sprout_world *world, sprout_state *state, sproutc_readings *readings,
                        const sproutc_play_options *options, FILE *out, FILE *err, FILE *trace) {
  play p;
  size_t i, n = sproutc_readings_count(readings);
  const char *why = budgets_of(host, readings->budgets);
  if (why != NULL) {
    fprintf(err, "sproutc: %s\n", why);
    return 1;
  }
  if (options->has_poll_steps) host->record.budgets.poll_steps = (sprout_limit){true, options->poll_steps};
  memset(&p, 0, sizeof p);
  p.offered = options->offered;
  p.host = host;
  p.world = world;
  p.state = state;
  p.out = out;
  p.err = err;
  fprintf(out, "--- play\n");
  for (i = 0; i < n; i++) {
    sproutc_step step;
    const char *why = sproutc_readings_step(readings, i, &step);
    bool ok = true;
    if (why != NULL) {
      fprintf(err, "sproutc: %s\n", why);
      return 1;
    }
    if (step.kind == SPROUTC_STEP_COMMENT || step.kind == SPROUTC_STEP_SEED) continue;
    fprintf(out, "## step %zu: %s\n", step.index, step.line);
    p.now = step.at_seconds;
    sproutc_host_set_time(host, step.at_seconds);
    if (sprout_arena_init(&p.arena, &host->record) != SPROUT_OK) return 1;
    memset(&p.says, 0, sizeof p.says);
    memset(&p.turns, 0, sizeof p.turns);
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
    if (!ok) return p.failure == 0 ? 1 : p.failure;
  }
  if (p.offered) {
    fprintf(out, "--- offered: %zu of %zu readings, the widest poll %llu steps\n", p.checked - p.unoffered, p.checked,
            (unsigned long long)p.widest);
    if (p.unoffered > 0) return 1;
  }
  return 0;
}
