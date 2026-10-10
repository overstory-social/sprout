/*
 * A visitor's view, polled and rendered (see view.h). A poll is three attempts at most, each under a
 * fresh budget of its own as a poll is: deriving and rendering the whole view; where that spends its
 * budget, rendering the engine's `unseen`; and rendering whatever parts the first derived before it
 * ran out. Deriving writes each part down as it completes, so a fault partway through leaves the
 * parts before it in hand.
 */
#include <string.h>

#include "describe.h"
#include "exits.h"
#include "offers.h"
#include "options.h"
#include "prose/prose.h"
#include "view.h"

/* What a view holds: its own arena, and the host that backs it. */
typedef struct held {
  sprout_host host;
  sprout_arena anchor, arena;
} held;

sprout_arena *sprout_view_arena(sprout_seen_view *view) { return &((held *)view->held)->arena; }

/* What a poll has derived so far, one part at a time. */
typedef struct derived {
  sprout_description description;
  bool has_exits, has_occupants, has_carried, has_readings;
  const sprout_way *ways;
  size_t way_count;
  const sprout_str *occupants;
  size_t occupant_count;
  const sprout_str *carried;
  size_t carried_count;
  const sprout_offer *offers;
  const sprout_role_options *const *options; /* one list for each offer */
  const size_t *option_counts;
  size_t reading_count;
} derived;

/* One attempt at a poll: its own budget, over the same committed state. */
typedef struct poll {
  const sprout_world *world;
  const sprout_host *host;
  sprout_arena *turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
  prose_reading reading;
  sprout_str actor, place;
} poll;

static void poll_begin(poll *p) {
  memset(&p->fault, 0, sizeof p->fault);
  sprout_meter_begin(&p->meter, p->host, SPROUT_TURN_POLL);
  sprout_exec_begin(&p->x, p->world, &p->draft, p->turn, &p->meter, NULL, &p->fault, 0);
  p->frame = sprout_exec_frame(&p->x, p->actor, NULL, NULL);
  p->reading.world = p->world;
  p->reading.draft = &p->draft;
  p->reading.turn = p->turn;
  p->reading.meter = &p->meter;
  p->reading.fault = &p->fault;
  p->reading.reader = p->actor;
}

/* ---- deriving ---- */

static sprout_eval_status derive(poll *p, derived *d) {
  const sprout_frame *frame = &p->frame;
  const sprout_reached *reached;
  const sprout_str *held_ids;
  const sprout_role_options **options;
  size_t *option_counts;
  size_t reached_count, i, n, kept = 0;
  sprout_str *occupants;
  bool dark;
  EXPR_NEED(sprout_describe(frame, p->place, p->actor, "poll", &d->description));
  EXPR_NEED(sprout_exits_from(frame, p->place, &d->ways, &d->way_count));
  d->has_exits = true;
  EXPR_NEED(sprout_range_of(frame, p->actor, NULL, &reached, &reached_count));
  /* In the dark nobody else is seen (the spec's Range > Sight). */
  EXPR_NEED(sprout_in_the_dark(frame, p->actor, &dark));
  occupants = (sprout_str *)sprout_arena_take(p->turn, (reached_count + 1) * sizeof *occupants);
  if (occupants == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < reached_count && !dark; i++) {
    const sprout_stored_instance *instance = expr_instance(frame, reached[i].node);
    if (reached[i].via != SPROUT_VIA_SELF && instance != NULL && instance->kind->composes_actor)
      occupants[kept++] = reached[i].node;
  }
  d->occupants = occupants;
  d->occupant_count = kept;
  d->has_occupants = true;
  if (sprout_draft_children(&p->draft, p->actor, &held_ids, &n) != SPROUT_DRAFT_OK) return SPROUT_EVAL_NO_MEMORY;
  d->carried = held_ids;
  d->carried_count = n;
  d->has_carried = true;
  EXPR_NEED(sprout_offers_to(&p->x, frame, p->actor, d->ways, d->way_count, reached, reached_count, &d->offers, &n));
  options = (const sprout_role_options **)sprout_arena_take(p->turn, (n + 1) * sizeof *options);
  option_counts = (size_t *)sprout_arena_take(p->turn, (n + 1) * sizeof *option_counts);
  if (options == NULL || option_counts == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < n; i++)
    EXPR_NEED(sprout_value_options(&p->x, frame, &d->offers[i].reading, &options[i], &option_counts[i]));
  d->options = (const sprout_role_options *const *)options;
  d->option_counts = option_counts;
  d->reading_count = n;
  d->has_readings = true;
  return SPROUT_EVAL_OK;
}

/* ---- rendering ---- */

static bool put(sprout_arena *keep, sprout_str from, sprout_str *to) {
  char *copy = sprout_arena_copy(keep, from.bytes, from.length);
  if (copy == NULL) return false;
  to->bytes = copy;
  to->length = from.length;
  return true;
}

static const char *put_text(sprout_arena *keep, const char *text) {
  return text == NULL ? NULL : sprout_arena_copy(keep, text, strlen(text));
}

/* A growing list of paragraphs in the turn arena. */
typedef struct strs {
  sprout_str *items;
  size_t count, capacity;
} strs;

static sprout_eval_status append(poll *p, strs *list, const prose_paragraphs *paragraphs) {
  size_t i;
  for (i = 0; i < paragraphs->count; i++) {
    sprout_str *slot = (sprout_str *)sprout_exec_grow(p->turn, (void **)&list->items, &list->count, &list->capacity,
                                                      sizeof *slot);
    if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
    *slot = paragraphs->items[i];
  }
  return SPROUT_EVAL_OK;
}

/* The paragraphs kept, in the view's arena. */
static sprout_eval_status keep_strs(sprout_arena *keep, const strs *list, const sprout_str **out, size_t *count) {
  sprout_str *kept = (sprout_str *)sprout_arena_take(keep, (list->count + 1) * sizeof *kept);
  size_t i;
  if (kept == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < list->count; i++)
    if (!put(keep, list->items[i], &kept[i])) return SPROUT_EVAL_NO_MEMORY;
  *out = kept;
  *count = list->count;
  return SPROUT_EVAL_OK;
}

/* The names in scope where a line was said, as a chain of bindings. */
static sprout_eval_status names_in_scope(const poll *p, const sprout_effect_binding *names, size_t count,
                                         const sprout_binding **chain) {
  sprout_frame frame = p->frame;
  size_t i;
  frame.bindings = NULL;
  for (i = 0; i < count; i++) {
    frame.bindings = sprout_bind(&frame, names[i].name, names[i].bound);
    if (frame.bindings == NULL) return SPROUT_EVAL_NO_MEMORY;
  }
  *chain = frame.bindings;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status say_line(poll *p, sprout_str by, const sprout_speech *said, const sprout_binding *bindings,
                                   strs *out) {
  prose_paragraphs paragraphs;
  EXPR_NEED(prose_render_speech(&p->reading, by, said, bindings, &paragraphs));
  return append(p, out, &paragraphs);
}

/* A description as its reader reads it: each line a paragraph or more, or, where none renders, the engine's `unremarkable`. */
static sprout_eval_status render_description(poll *p, const sprout_description *description, sprout_arena *keep,
                                             sprout_seen_view *out) {
  strs lines;
  size_t i;
  memset(&lines, 0, sizeof lines);
  for (i = 0; i < description->line_count; i++)
    EXPR_NEED(say_line(p, description->lines[i].by, &description->lines[i].said, description->lines[i].bindings, &lines));
  if (lines.count == 0)
    EXPR_NEED(say_line(p, description->unremarkable.by, &description->unremarkable.said,
                       description->unremarkable.bindings, &lines));
  return keep_strs(keep, &lines, &out->description, &out->description_count);
}

static sprout_eval_status seen_exit(sprout_arena *keep, const char *direction, const char *label, sprout_str to,
                                    sprout_seen_exit *out) {
  out->direction = put_text(keep, direction);
  out->label = put_text(keep, label);
  if ((direction != NULL && out->direction == NULL) || out->label == NULL || !put(keep, to, &out->to))
    return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status seen_thing(poll *p, sprout_arena *keep, sprout_str id, sprout_seen_thing *out) {
  sprout_str words;
  EXPR_NEED(prose_object_words(&p->frame, id, p->actor, &words));
  if (!put(keep, id, &out->id) || !put(keep, words, &out->name)) return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status seen_things(poll *p, sprout_arena *keep, const sprout_str *ids, size_t count,
                                      const sprout_seen_thing **out) {
  sprout_seen_thing *things = (sprout_seen_thing *)sprout_arena_take(keep, (count + 1) * sizeof *things);
  size_t i;
  if (things == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) EXPR_NEED(seen_thing(p, keep, ids[i], &things[i]));
  *out = things;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status seen_filler(poll *p, sprout_arena *keep, const sprout_role *role, const sprout_filled *filled,
                                      sprout_seen_filler *out) {
  size_t i;
  out->role = put_text(keep, role->name);
  if (out->role == NULL) return SPROUT_EVAL_NO_MEMORY;
  out->binds = SPROUT_SEEN_UNBOUND;
  if (!filled->filled) return SPROUT_EVAL_OK;
  switch (filled->bound.kind) {
    case SPROUT_BOUND_OBJECT:
      out->binds = SPROUT_SEEN_OBJECT;
      return seen_thing(p, keep, filled->bound.object, &out->thing);
    case SPROUT_BOUND_SET: {
      sprout_seen_thing *members =
          (sprout_seen_thing *)sprout_arena_take(keep, (filled->bound.set_count + 1) * sizeof *members);
      if (members == NULL) return SPROUT_EVAL_NO_MEMORY;
      for (i = 0; i < filled->bound.set_count; i++) EXPR_NEED(seen_thing(p, keep, filled->bound.set[i], &members[i]));
      out->binds = SPROUT_SEEN_SET;
      out->members = members;
      out->member_count = filled->bound.set_count;
      return SPROUT_EVAL_OK;
    }
    case SPROUT_BOUND_EXIT: {
      sprout_str direction = filled->bound.direction;
      sprout_str label = filled->bound.label;
      sprout_seen_exit *exit = &out->exit;
      out->binds = SPROUT_SEEN_EXIT;
      exit->direction = filled->bound.has_direction ? put_text(keep, direction.bytes) : NULL;
      exit->label = put_text(keep, label.bytes);
      if ((filled->bound.has_direction && exit->direction == NULL) || exit->label == NULL ||
          !put(keep, filled->bound.to, &exit->to))
        return SPROUT_EVAL_NO_MEMORY;
      return SPROUT_EVAL_OK;
    }
    case SPROUT_BOUND_VALUE:
      break;
  }
  return SPROUT_EVAL_OK;
}

static sprout_eval_status seen_options(poll *p, sprout_arena *keep, const sprout_role_options *roles, size_t count,
                                       const sprout_seen_options **out) {
  sprout_seen_options *options = (sprout_seen_options *)sprout_arena_take(keep, (count + 1) * sizeof *options);
  size_t i, j;
  if (options == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < count; i++) {
    options[i].role = put_text(keep, roles[i].role);
    options[i].symbol = roles[i].symbol;
    if (options[i].role == NULL) return SPROUT_EVAL_NO_MEMORY;
    if (roles[i].symbol) {
      sprout_seen_option *each =
          (sprout_seen_option *)sprout_arena_take(keep, (roles[i].option_count + 1) * sizeof *each);
      if (each == NULL) return SPROUT_EVAL_NO_MEMORY;
      for (j = 0; j < roles[i].option_count; j++) {
        sprout_str words;
        if (!put(keep, roles[i].options[j], &each[j].value) ||
            !sprout_humanised(p->turn, roles[i].options[j], &words) || !put(keep, words, &each[j].words))
          return SPROUT_EVAL_NO_MEMORY;
      }
      options[i].options = each;
      options[i].option_count = roles[i].option_count;
    } else {
      sprout_seen_range *ranges =
          (sprout_seen_range *)sprout_arena_take(keep, (roles[i].range_count + 1) * sizeof *ranges);
      if (ranges == NULL) return SPROUT_EVAL_NO_MEMORY;
      for (j = 0; j < roles[i].range_count; j++) {
        ranges[j].min = roles[i].ranges[j].min;
        ranges[j].max = roles[i].ranges[j].max;
      }
      options[i].ranges = ranges;
      options[i].range_count = roles[i].range_count;
    }
  }
  *out = options;
  return SPROUT_EVAL_OK;
}

static sprout_eval_status seen_reading(poll *p, sprout_arena *keep, const sprout_offer *offer,
                                       const sprout_role_options *options, size_t option_count,
                                       sprout_seen_reading *out) {
  const sprout_verb *verb = offer->reading.verb;
  size_t library = strlen(verb->library), name = strlen(verb->name), i;
  char *qualified = (char *)sprout_arena_take(keep, library + name + 2);
  sprout_seen_filler *fillers = (sprout_seen_filler *)sprout_arena_take(keep, (verb->role_count + 1) * sizeof *fillers);
  if (qualified == NULL || fillers == NULL) return SPROUT_EVAL_NO_MEMORY;
  memcpy(qualified, verb->library, library);
  qualified[library] = '.';
  memcpy(qualified + library + 1, verb->name, name);
  out->verb = qualified;
  if (!put(keep, (sprout_str){offer->typed, strlen(offer->typed)}, &out->typed)) return SPROUT_EVAL_NO_MEMORY;
  out->refused = offer->refused;
  if (offer->refused) {
    const sprout_move_refusal *refusal = &offer->refusal.refusal;
    const sprout_binding *names;
    strs lines;
    memset(&lines, 0, sizeof lines);
    EXPR_NEED(names_in_scope(p, refusal->bindings, refusal->binding_count, &names));
    EXPR_NEED(say_line(p, refusal->by, &refusal->said, names, &lines));
    EXPR_NEED(keep_strs(keep, &lines, &out->refusal, &out->refusal_count));
  }
  for (i = 0; i < verb->role_count; i++)
    EXPR_NEED(seen_filler(p, keep, &verb->roles[i], &offer->reading.roles[i], &fillers[i]));
  out->fillers = fillers;
  out->filler_count = verb->role_count;
  EXPR_NEED(seen_options(p, keep, options, option_count, &out->options));
  out->options_count = option_count;
  return SPROUT_EVAL_OK;
}

/* The parts a poll derived as its visitor reads them; the description too where `whole`. */
static sprout_eval_status render_parts(poll *p, const derived *d, bool whole, sprout_arena *keep, sprout_seen_view *out) {
  size_t i;
  if (whole) EXPR_NEED(render_description(p, &d->description, keep, out));
  if (d->has_exits) {
    sprout_seen_exit *exits = (sprout_seen_exit *)sprout_arena_take(keep, (d->way_count + 1) * sizeof *exits);
    if (exits == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < d->way_count; i++)
      EXPR_NEED(seen_exit(keep, d->ways[i].direction, d->ways[i].label, d->ways[i].to, &exits[i]));
    out->exits = exits;
    out->exit_count = d->way_count;
  }
  if (d->has_occupants) {
    EXPR_NEED(seen_things(p, keep, d->occupants, d->occupant_count, &out->occupants));
    out->occupant_count = d->occupant_count;
  }
  if (d->has_carried) {
    EXPR_NEED(seen_things(p, keep, d->carried, d->carried_count, &out->carried));
    out->carried_count = d->carried_count;
  }
  if (d->has_readings) {
    sprout_seen_reading *readings =
        (sprout_seen_reading *)sprout_arena_take(keep, (d->reading_count + 1) * sizeof *readings);
    if (readings == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < d->reading_count; i++)
      EXPR_NEED(seen_reading(p, keep, &d->offers[i], d->options[i], d->option_counts[i], &readings[i]));
    out->readings = readings;
    out->reading_count = d->reading_count;
  }
  return SPROUT_EVAL_OK;
}

/* ---- polling ---- */

/* The words of an engine line the visitor reads, found as every engine line is; the stock words where it renders nothing. */
static sprout_eval_status engine_words(poll *p, const char *name, bool in_place, sprout_arena *keep, sprout_seen_view *out) {
  const sprout_stored_instance *standing = sprout_draft_instance(&p->draft, p->place);
  sprout_str by;
  sprout_speech said;
  strs lines;
  const char *stock = prose_stock_words(name);
  sprout_str *one;
  memset(&lines, 0, sizeof lines);
  sprout_engine_said(&p->frame, name, &p->actor, in_place && standing != NULL ? &p->place : NULL, &by, &said);
  EXPR_NEED(say_line(p, by, &said, NULL, &lines));
  if (lines.count == 0) {
    one = (sprout_str *)sprout_arena_take(keep, sizeof *one);
    if (one == NULL || !put(keep, (sprout_str){stock, strlen(stock)}, one)) return SPROUT_EVAL_NO_MEMORY;
    out->description = one;
    out->description_count = 1;
    return SPROUT_EVAL_OK;
  }
  return keep_strs(keep, &lines, &out->description, &out->description_count);
}

/* Whether a visitor's place is a place still: there, live and holding actors. */
static bool stands_in_place(const poll *p) {
  const sprout_stored_instance *place = sprout_draft_instance(&p->draft, p->place);
  return place != NULL && !sprout_str_same(p->place, p->draft.base->world) && expr_live(&p->frame, p->place) &&
         place->kind->contains_actors;
}

/* The first attempt: the whole view, or, for a visitor whose place is gone, `displaced` alone. */
static sprout_eval_status whole_poll(poll *p, derived *d, sprout_arena *keep, sprout_seen_view *out) {
  if (!stands_in_place(p)) return engine_words(p, "displaced", true, keep, out);
  EXPR_NEED(derive(p, d));
  return render_parts(p, d, true, keep, out);
}

static void note_fault(const poll *p, sprout_eval_status status, sprout_seen_view *view) {
  view->faulted = true;
  view->steps = p->meter.steps;
  if (p->meter.faulted) {
    view->fault = p->meter.fault;
    view->fault_name = "BudgetExhausted";
    return;
  }
  view->fault.budget = p->fault.name;
  view->fault.message = p->meter.message;
  strncpy(view->fault.text, p->fault.text, sizeof view->fault.text - 1);
  view->fault_name = p->fault.name;
  (void)status;
}

static held *keep_for(const sprout_host *host) {
  sprout_arena boot;
  held *keep;
  if (sprout_arena_init(&boot, host) != SPROUT_OK) return NULL;
  keep = (held *)sprout_arena_take(&boot, sizeof *keep);
  if (keep == NULL) {
    sprout_arena_reset(&boot);
    return NULL;
  }
  keep->host = *host;
  keep->anchor = boot;
  keep->anchor.host = &keep->host;
  sprout_arena_init(&keep->arena, &keep->host);
  return keep;
}

void sprout_view_free(sprout_seen_view *view) {
  held *keep;
  sprout_arena anchor, data;
  sprout_host host;
  if (view == NULL || view->held == NULL) return;
  keep = (held *)view->held;
  host = keep->host;
  anchor = keep->anchor;
  data = keep->arena;
  anchor.host = &host;
  data.host = &host;
  sprout_arena_reset(&data);
  sprout_arena_reset(&anchor);
  memset(view, 0, sizeof *view);
}

static void refuse(sprout_seen_view *view, const char *before, const char *name, const char *after) {
  size_t room = sizeof view->fault.text, used = 0, i;
  const char *parts[3];
  parts[0] = before;
  parts[1] = name;
  parts[2] = after;
  for (i = 0; i < 3; i++) {
    size_t n = strlen(parts[i]);
    if (n > room - used - 1) n = room - used - 1;
    memcpy(view->fault.text + used, parts[i], n);
    used += n;
  }
  view->fault.text[used] = '\0';
}

/* The three attempts over one draft. */
static sprout_status polled(poll *p, held *keep, sprout_seen_view *view) {
  derived d;
  sprout_eval_status status;
  memset(&d, 0, sizeof d);
  poll_begin(p);
  status = whole_poll(p, &d, &keep->arena, view);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status == SPROUT_EVAL_OK) {
    view->steps = p->meter.steps;
    return SPROUT_OK;
  }
  /* The description is the engine's `unseen`, and what was derived before the poll ran out is kept. */
  note_fault(p, status, view);
  view->description = NULL;
  view->description_count = 0;
  view->exit_count = view->occupant_count = view->carried_count = view->reading_count = 0;
  poll_begin(p);
  status = engine_words(p, "unseen", true, &keep->arena, view);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) {
    const char *stock = prose_stock_words("unseen");
    sprout_str *one = (sprout_str *)sprout_arena_take(&keep->arena, sizeof *one);
    if (one == NULL || !put(&keep->arena, (sprout_str){stock, strlen(stock)}, one)) return SPROUT_NO_MEMORY;
    view->description = one;
    view->description_count = 1;
  }
  poll_begin(p);
  status = render_parts(p, &d, false, &keep->arena, view);
  if (status == SPROUT_EVAL_NO_MEMORY) return SPROUT_NO_MEMORY;
  if (status != SPROUT_EVAL_OK) view->exit_count = view->occupant_count = view->carried_count = view->reading_count = 0;
  return SPROUT_OK;
}

sprout_status sprout_view(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                          sprout_seen_view *view) {
  sprout_arena turn;
  poll p;
  const sprout_stored_visitor *visitor;
  const sprout_stored_instance *instance;
  held *keep;
  sprout_status status;
  if (view == NULL) return SPROUT_BAD_HOST;
  memset(view, 0, sizeof *view);
  if (world == NULL || state == NULL || host == NULL || visit == NULL) return SPROUT_BAD_INPUT;
  status = sprout_arena_init(&turn, host);
  if (status != SPROUT_OK) return status;
  memset(&p, 0, sizeof p);
  p.world = world;
  p.host = host;
  p.turn = &turn;
  if (sprout_draft_open(&p.draft, &turn, world, state) != SPROUT_DRAFT_OK) {
    sprout_arena_reset(&turn);
    return SPROUT_NO_MEMORY;
  }
  visitor = sprout_draft_visitor(&p.draft, (sprout_str){visit, strlen(visit)});
  if (visitor == NULL) {
    refuse(view, "`", visit, "` has never visited this world.");
    sprout_arena_reset(&turn);
    return SPROUT_BAD_INPUT;
  }
  p.actor = visitor->instance;
  instance = sprout_draft_instance(&p.draft, p.actor);
  if (instance == NULL || !instance->has_container) {
    refuse(view, "`", visit, "` is not in this world, so has no view.");
    sprout_arena_reset(&turn);
    return SPROUT_BAD_INPUT;
  }
  p.place = instance->container;
  keep = keep_for(host);
  if (keep == NULL) {
    sprout_arena_reset(&turn);
    return SPROUT_NO_MEMORY;
  }
  view->held = keep;
  status = polled(&p, keep, view);
  if (status == SPROUT_OK) {
    view->fault_object = (sprout_str){NULL, 0};
    if (view->faulted && !put(&keep->arena, p.place, &view->fault_object)) status = SPROUT_NO_MEMORY;
  }
  sprout_arena_reset(&turn);
  if (status != SPROUT_OK) sprout_view_free(view);
  return status;
}
