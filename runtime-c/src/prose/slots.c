/*
 * Prose, rendered for one reader (the spec's Prose > Passages, Slots, Conditionals and loops,
 * Bounds). A slot renders an object as the reader reads it, an option humanised, a number in
 * digits and a string as written; another object's passage runs with that object as its own
 * `self` and only `actor`, `here` and `seen` beside it, one passage deeper against the host's
 * bound. `{if}` renders the first branch whose condition holds, and `{for}` its body once for
 * each thing or element it walks, in order, with `$first`, `$last`, `$index` (counting from 1)
 * and `$count` bound. `{one of}` renders one of its choices, drawn from the line's draws. Every
 * expression is evaluated as a body's is and charged the same steps, and every iteration and every
 * choice is a step. Rendering writes nothing.
 */
#include "prose/prose.h"

sprout_frame prose_frame(const prose_reading *reading, sprout_draws *draws, sprout_str self, const char *library,
                         const sprout_binding *bindings) {
  sprout_frame frame;
  memset(&frame, 0, sizeof frame);
  frame.world = reading->world;
  frame.draft = reading->draft;
  frame.turn = reading->turn;
  frame.meter = reading->meter;
  frame.draws = draws;
  frame.self = self;
  frame.library = library;
  frame.bindings = bindings;
  frame.fault = reading->fault;
  return frame;
}

sprout_eval_status prose_enter_passage(const prose_reading *reading) {
  if (sprout_meter_enter_passage(reading->meter)) return SPROUT_EVAL_OK;
  return prose_budget_fault(reading->fault, reading->meter);
}

const char *prose_library_of(sprout_arena *arena, const char *qualified) {
  const char *dot = strchr(qualified, '.');
  if (dot == NULL || dot == qualified) return NULL;
  return sprout_arena_copy(arena, qualified, (size_t)(dot - qualified));
}

static sprout_eval_status pieces(const prose_reading *reading, const sprout_node *prose, const sprout_frame *frame,
                                 prose_pieces *out);

static bool is_kind(const sprout_node *piece, const char *kind) {
  return sprout_node_is(sprout_node_get(piece, "kind"), kind);
}

static sprout_eval_status put_words(const prose_reading *reading, prose_pieces *out, prose_piece_kind kind,
                                    const char *bytes, size_t length) {
  return prose_put(reading->turn, out, kind, bytes, length) ? SPROUT_EVAL_OK : SPROUT_EVAL_NO_MEMORY;
}

/* ---- another object's passage ---- */

/*
 * `{pot.greeting}`: the passage of that name as `pot`'s kind has it, with `pot` its own `self` and
 * `actor`, `here` and `seen` beside it where they are bound, laid in the line as `prose_slotted`
 * says. A passage its kind lacks, being in a `.prose` file the world was loaded without, renders
 * nothing.
 */
static sprout_eval_status passage_of(const prose_reading *reading, const sprout_node *receiver, const char *name,
                                     const sprout_frame *frame, prose_pieces *out) {
  static const char *const CARRIED[] = {"actor", "here", "seen"};
  sprout_evaluated owner;
  const sprout_stored_instance *instance;
  sprout_speech speech;
  const sprout_binding *bindings = NULL;
  const char *library;
  sprout_frame inner;
  prose_pieces rendered, slotted;
  size_t i;
  sprout_eval_status status;
  memset(&rendered, 0, sizeof rendered);
  EXPR_NEED(sprout_eval(frame, receiver, &owner));
  if (owner.binds != SPROUT_BINDS_OBJECT) return expr_engine(frame, "a passage was rendered of what is not an object.");
  instance = expr_instance(frame, owner.id);
  if (instance == NULL || !sprout_passage_on(instance->kind, name, &speech)) return SPROUT_EVAL_OK;
  for (i = 0; i < sizeof CARRIED / sizeof CARRIED[0]; i++) {
    const sprout_binding *carried = expr_binding(frame, CARRIED[i]);
    sprout_frame scope = *frame;
    scope.bindings = bindings;
    if (carried == NULL) continue;
    bindings = sprout_bind(&scope, CARRIED[i], carried->bound);
    if (bindings == NULL) return SPROUT_EVAL_NO_MEMORY;
  }
  library = prose_library_of(frame->turn, speech.origin);
  if (library == NULL) return expr_engine(frame, "a passage was written by what is not a qualified kind.");
  inner = prose_frame(reading, frame->draws, owner.id, library, bindings);
  EXPR_NEED(prose_enter_passage(reading));
  status = pieces(reading, sprout_node_get(sprout_node_get(speech.node, "body"), "prose"), &inner, &rendered);
  sprout_meter_leave_passage(reading->meter);
  EXPR_NEED(status);
  if (!prose_slotted(frame->turn, &rendered, &slotted)) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < slotted.count; i++)
    EXPR_NEED(put_words(reading, out, slotted.items[i].kind, slotted.items[i].bytes, slotted.items[i].length));
  /* Noted only where it gave its reader words to read, after any passage it holds. */
  if (slotted.count > 0) prose_note_passage(reading, speech.node);
  return SPROUT_EVAL_OK;
}

/* ---- a slot ---- */

static sprout_eval_status slot(const prose_reading *reading, const sprout_node *piece, const sprout_frame *frame,
                               prose_pieces *out) {
  const sprout_node *expr = sprout_node_get(piece, "expr");
  sprout_evaluated value;
  sprout_str words;
  char digits[32];
  size_t length;
  /* A member the checker resolved as a dotted path's last step is the object it names. */
  if (expr_kind_of(expr) == EXPR_MEMBER && strcmp(expr_ident(expr, "member"), "count") != 0 &&
      sprout_world_bound(frame->world, expr) == NULL)
    return passage_of(reading, sprout_node_get(expr, "receiver"), expr_ident(expr, "member"), frame, out);
  EXPR_NEED(sprout_eval(frame, expr, &value));
  switch (value.binds) {
    case SPROUT_BINDS_OBJECT:
      EXPR_NEED(prose_object_words(frame, value.id, reading->reader, &words));
      return put_words(reading, out, PROSE_WORDS, words.bytes, words.length);
    case SPROUT_BINDS_SET:
    case SPROUT_BINDS_READINGS:
      return expr_engine(frame, "a slot rendered a set or `readings` whole, which the checker refuses.");
    case SPROUT_BINDS_VALUE:
      break;
  }
  switch (value.value.kind) {
    case SPROUT_BOOL:
    case SPROUT_LIST:
      return expr_engine(frame, "a slot rendered a boolean or a list, which the checker refuses.");
    case SPROUT_NUMBER:
      if (!sprout_number_text(value.value.as.number, digits, sizeof digits, &length))
        return expr_engine(frame, "a slot rendered a number that is not a whole number, which the checker refuses.");
      words.bytes = sprout_arena_copy(frame->turn, digits, length);
      if (words.bytes == NULL) return SPROUT_EVAL_NO_MEMORY;
      return put_words(reading, out, PROSE_WORDS, words.bytes, length);
    case SPROUT_STRING:
      words = (sprout_str){value.value.as.string.bytes, value.value.as.string.length};
      if (piece->index != SPROUT_NOT_AN_ENTRY && frame->world->option_slot[piece->index] &&
          !sprout_humanised(frame->turn, words, &words))
        return SPROUT_EVAL_NO_MEMORY;
      return put_words(reading, out, PROSE_WORDS, words.bytes, words.length);
  }
  return SPROUT_EVAL_OK;
}

/* ---- {if} ---- */

/* An `{if}` chain: the first branch whose condition holds, each condition tested a step. */
static sprout_eval_status branch(const prose_reading *reading, const sprout_node *block, const sprout_frame *frame,
                                 prose_pieces *out) {
  const sprout_node *link = block;
  for (;;) {
    sprout_frame inner;
    bool taken;
    const sprout_node *otherwise;
    EXPR_NEED(expr_spend(frame));
    EXPR_NEED(sprout_eval_branch(frame, sprout_node_get(link, "condition"), &taken, &inner));
    if (taken) return pieces(reading, sprout_node_get(link, "then"), &inner, out);
    otherwise = sprout_node_get(link, "otherwise");
    if (otherwise == NULL || otherwise->kind == SPROUT_NODE_NULL) return SPROUT_EVAL_OK;
    if (is_kind(otherwise, "prose")) return pieces(reading, otherwise, frame, out);
    link = otherwise;
  }
}

/* ---- {one of} ---- */

/* A `{one of}`: one of its choices, each as likely, drawn as a step. */
static sprout_eval_status choose(const prose_reading *reading, const sprout_node *block, const sprout_frame *frame,
                                 prose_pieces *out) {
  const sprout_node *choices = sprout_node_get(block, "choices");
  uint32_t drawn;
  EXPR_NEED(expr_spend(frame));
  if (frame->draws == NULL)
    return expr_engine(frame, "a `{one of}` was rendered where nothing draws, which the checker refuses.");
  if (choices == NULL || choices->count == 0 || !sprout_draws_below(frame->draws, choices->count, &drawn))
    return expr_engine(frame, "a `{one of}` was written with nothing to choose, which the checker refuses.");
  return pieces(reading, choices->items[drawn], frame, out);
}

/* ---- {for} ---- */

/* What a `{for}` walks: a container's contents as `each` walks them, a set, a list's elements, or the readings `help` offers. */
static sprout_eval_status walk(const sprout_node *block, const sprout_frame *frame, sprout_evaluated **walked,
                               size_t *count) {
  sprout_evaluated over, *found;
  const sprout_node *filter = sprout_node_get(block, "filter");
  const sprout_str *ids;
  const sprout_kind_def *kind = NULL;
  size_t n, kept = 0, i;
  sprout_str container;
  EXPR_NEED(sprout_eval(frame, sprout_node_get(block, "over"), &over));
  if (sprout_node_is(sprout_node_get(block, "walks"), "of")) {
    if (over.binds == SPROUT_BINDS_SET || over.binds == SPROUT_BINDS_READINGS) n = over.count;
    else if (over.binds == SPROUT_BINDS_VALUE && over.value.kind == SPROUT_LIST) n = over.value.as.list->count;
    else return expr_engine(frame, "`{for … of}` walked what is not a list or a set, which the checker refuses.");
    found = (sprout_evaluated *)sprout_arena_take(frame->turn, (n + 1) * sizeof *found);
    if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
    for (i = 0; i < n; i++) {
      if (over.binds == SPROUT_BINDS_SET) found[i] = sprout_evaluated_object(over.items[i]);
      else if (over.binds == SPROUT_BINDS_READINGS) {
        sprout_value line;
        if (!sprout_string(frame->turn, over.items[i].bytes, over.items[i].length, &line))
          return SPROUT_EVAL_NO_MEMORY;
        found[i] = sprout_evaluated_value(line);
      } else found[i] = sprout_evaluated_value(over.value.as.list->items[i]);
    }
    *walked = found;
    *count = n;
    return SPROUT_EVAL_OK;
  }
  if (over.binds != SPROUT_BINDS_OBJECT)
    return expr_engine(frame, "`{for … in}` walked what is not a container, which the checker refuses.");
  EXPR_NEED(expr_as_object(frame, &over, &container));
  EXPR_NEED(expr_contents_seen(frame, container, &ids, &n));
  if (filter != NULL && filter->kind != SPROUT_NODE_NULL) {
    kind = expr_kind_named(frame, filter);
    if (kind == NULL) return expr_unchecked(frame, "a kind that is not declared");
  }
  found = (sprout_evaluated *)sprout_arena_take(frame->turn, (n + 1) * sizeof *found);
  if (found == NULL) return SPROUT_EVAL_NO_MEMORY;
  for (i = 0; i < n; i++) {
    const sprout_stored_instance *instance;
    EXPR_NEED(expr_instance_of(frame, ids[i], &instance));
    if (kind == NULL || expr_composes(instance->kind, kind->qualified)) found[kept++] = sprout_evaluated_object(ids[i]);
  }
  *walked = found;
  *count = kept;
  return SPROUT_EVAL_OK;
}

/* A `{for}`: its body once for each thing or element walked, each iteration a step. */
static sprout_eval_status loop(const prose_reading *reading, const sprout_node *block, const sprout_frame *frame,
                               prose_pieces *out) {
  const char *variable = expr_ident(block, "variable");
  sprout_evaluated *walked;
  size_t count, i;
  EXPR_NEED(walk(block, frame, &walked, &count));
  for (i = 0; i < count; i++) {
    sprout_frame inner = *frame;
    EXPR_NEED(expr_spend(frame));
    inner.bindings = sprout_bind(&inner, variable, walked[i]);
    if (inner.bindings != NULL) inner.bindings = sprout_bind(&inner, "$first", sprout_evaluated_value(sprout_bool(i == 0)));
    if (inner.bindings != NULL)
      inner.bindings = sprout_bind(&inner, "$last", sprout_evaluated_value(sprout_bool(i + 1 == count)));
    if (inner.bindings != NULL)
      inner.bindings = sprout_bind(&inner, "$index", sprout_evaluated_value(sprout_number((double)(i + 1))));
    if (inner.bindings != NULL)
      inner.bindings = sprout_bind(&inner, "$count", sprout_evaluated_value(sprout_number((double)count)));
    if (inner.bindings == NULL) return SPROUT_EVAL_NO_MEMORY;
    EXPR_NEED(pieces(reading, sprout_node_get(block, "body"), &inner, out));
  }
  return SPROUT_EVAL_OK;
}

/* ---- the pieces of a block ---- */

static sprout_eval_status pieces(const prose_reading *reading, const sprout_node *prose, const sprout_frame *frame,
                                 prose_pieces *out) {
  const sprout_node *list = sprout_node_get(prose, "pieces");
  size_t i;
  for (i = 0; list != NULL && i < list->count; i++) {
    const sprout_node *piece = list->items[i];
    const char *kind = sprout_node_text(piece, "kind");
    const sprout_node *text;
    if (kind == NULL) return expr_unchecked(frame, "a piece of prose with no kind");
    if (strcmp(kind, "prose-words") == 0) {
      text = sprout_node_get(piece, "text");
      if (text == NULL || text->kind != SPROUT_NODE_STRING) return expr_unchecked(frame, "words with no text");
      EXPR_NEED(put_words(reading, out, PROSE_WORDS, text->text, text->length));
    } else if (strcmp(kind, "prose-paragraph") == 0) {
      EXPR_NEED(put_words(reading, out, PROSE_PARAGRAPH, NULL, 0));
    } else if (strcmp(kind, "prose-newline") == 0) {
      EXPR_NEED(put_words(reading, out, PROSE_LINE, NULL, 0));
    } else if (strcmp(kind, "prose-slot") == 0) {
      EXPR_NEED(slot(reading, piece, frame, out));
    } else if (strcmp(kind, "prose-if") == 0) {
      EXPR_NEED(branch(reading, piece, frame, out));
    } else if (strcmp(kind, "prose-for") == 0) {
      EXPR_NEED(loop(reading, piece, frame, out));
    } else if (strcmp(kind, "prose-one-of") == 0) {
      EXPR_NEED(choose(reading, piece, frame, out));
    } else {
      return expr_unchecked(frame, "a piece of prose of a kind this runtime does not know");
    }
  }
  return SPROUT_EVAL_OK;
}

sprout_eval_status prose_render(const prose_reading *reading, const sprout_node *prose, const sprout_frame *frame,
                                prose_pieces *out) {
  return pieces(reading, prose, frame, out);
}
