/*
 * A turn's effects, rendered (the spec's The runtime > Effects; Other people > What this costs;
 * Chance > The seed). Each thing the turn said is rendered once for each of its readers, in the
 * order said, and a reader who is cut short or for whom it renders nothing reads nothing of it.
 * A line an NPC says is heard as the NPC speaking, through the engine's `npc_says`. What each
 * reader reads is charged to their own output (prose/output.c). Every reader of one line reads the
 * same draw: the line's draws are taken from the turn's stream, after every draw its bodies
 * made, the first time it renders, and read again for every reader after.
 */
#include "prose.h"

#include "prose/prose.h"

/*
 * One line's draws. The first reader's rendering takes them from the turn's stream; each later
 * reader's renders from a copy of the stream as it stood before, so it draws the same words and
 * asks for the same number of draws, which a line must however many read it.
 */
typedef struct tape {
  bool recorded;
  sprout_draws start;
  uint64_t used;
} tape;

/* The draws a rendering reads: the turn's own the first time, a copy of where they began after. */
static sprout_draws *tape_open(tape *t, sprout_draws *turn, sprout_draws *copy) {
  if (turn == NULL) return NULL;
  if (!t->recorded) {
    t->start = *turn;
    return turn;
  }
  *copy = t->start;
  return copy;
}

static sprout_eval_status tape_close(const prose_reading *reading, tape *t, const sprout_draws *used, bool first) {
  sprout_frame frame = prose_frame(reading, NULL, (sprout_str){"", 0}, NULL, NULL);
  uint64_t asked = used->made - t->start.made;
  if (first) {
    t->recorded = true;
    t->used = asked;
    return SPROUT_EVAL_OK;
  }
  if (asked == t->used) return SPROUT_EVAL_OK;
  return expr_engine(&frame, "a line drew a different number of times for one reader than it did for another.");
}

/* A line to render: whose body said it, which is `self` when it renders, and the names in scope where it was said. */
typedef struct speaking {
  sprout_str by;
  const sprout_speech *said;
  const sprout_binding *bindings;
} speaking;

/*
 * The paragraphs `line` renders to for the reader, charged to nobody. A named passage runs one
 * passage deep; one that is absent renders nothing.
 */
static sprout_eval_status rendered_for(const prose_reading *reading, sprout_draws *turn_draws, const speaking *line,
                                       tape *t, prose_paragraphs *out) {
  const sprout_speech *said = line->said;
  sprout_draws copy, *draws;
  prose_pieces rendered;
  const sprout_node *prose = NULL;
  const char *library = NULL;
  sprout_frame frame;
  sprout_eval_status status;
  bool first = !t->recorded, known = true;
  memset(out, 0, sizeof *out);
  memset(&rendered, 0, sizeof rendered);
  frame = prose_frame(reading, NULL, line->by, NULL, line->bindings);
  switch (said->kind) {
    case SPROUT_SPEECH_ABSENT:
    case SPROUT_SPEECH_RECORDED:
      return SPROUT_EVAL_OK;
    case SPROUT_SPEECH_PASSAGE:
      prose = sprout_node_get(sprout_node_get(said->node, "body"), "prose");
      library = said->origin == NULL ? NULL : prose_library_of(reading->turn, said->origin);
      if (library == NULL) return expr_engine(&frame, "a passage was written by what is not a qualified kind.");
      break;
    case SPROUT_SPEECH_TEXT:
      prose = sprout_node_get(said->node, "prose");
      library = said->library;
      break;
    case SPROUT_SPEECH_ENGINE:
      EXPR_NEED(prose_engine_prose(reading->turn, reading->fault, said->name, &prose, &known));
      if (!known) return expr_engine(&frame, "an engine line was said that the engine has no words for.");
      library = "sprout";
      break;
  }
  draws = tape_open(t, turn_draws, &copy);
  frame = prose_frame(reading, draws, line->by, library, line->bindings);
  if (said->kind == SPROUT_SPEECH_PASSAGE) {
    EXPR_NEED(prose_enter_passage(reading));
    status = prose_render(reading, prose, &frame, &rendered);
    sprout_meter_leave_passage(reading->meter);
  } else {
    status = prose_render(reading, prose, &frame, &rendered);
  }
  EXPR_NEED(status);
  if (draws != NULL) EXPR_NEED(tape_close(reading, t, draws, first));
  if (!prose_reflow(reading->turn, &rendered, out)) return SPROUT_EVAL_NO_MEMORY;
  return SPROUT_EVAL_OK;
}

sprout_eval_status prose_render_speech(const prose_reading *reading, sprout_str by, const sprout_speech *said,
                                       const sprout_binding *bindings, prose_paragraphs *out) {
  speaking line;
  tape t;
  line.by = by;
  line.said = said;
  line.bindings = bindings;
  memset(&t, 0, sizeof t);
  return rendered_for(reading, NULL, &line, &t, out);
}

static uint64_t characters_of(const prose_paragraphs *paragraphs) {
  uint64_t total = 0;
  size_t i;
  for (i = 0; i < paragraphs->count; i++) total += prose_characters(paragraphs->items[i]);
  return total;
}

/* The paragraphs joined by a space, as an NPC's words are. */
static bool joined(sprout_arena *arena, const prose_paragraphs *paragraphs, sprout_str *out) {
  size_t total = 0, i, at = 0;
  char *bytes;
  for (i = 0; i < paragraphs->count; i++) total += paragraphs->items[i].length + 1;
  bytes = (char *)sprout_arena_take(arena, total + 1);
  if (bytes == NULL) return false;
  for (i = 0; i < paragraphs->count; i++) {
    if (i > 0) bytes[at++] = ' ';
    memcpy(bytes + at, paragraphs->items[i].bytes, paragraphs->items[i].length);
    at += paragraphs->items[i].length;
  }
  out->bytes = bytes;
  out->length = at;
  return true;
}

/* The names in scope where a line was said, as a chain of bindings. */
static sprout_eval_status names_in_scope(const prose_reading *reading, const sprout_effect_binding *names, size_t count,
                                         const sprout_binding **chain) {
  sprout_frame frame = prose_frame(reading, NULL, (sprout_str){"", 0}, NULL, NULL);
  size_t i;
  for (i = 0; i < count; i++) {
    frame.bindings = sprout_bind(&frame, names[i].name, names[i].bound);
    if (frame.bindings == NULL) return SPROUT_EVAL_NO_MEMORY;
  }
  *chain = frame.bindings;
  return SPROUT_EVAL_OK;
}

/* What one line of the turn needs rendered: the effect, its names and, for an NPC's, the engine's `npc_says` that frames it. */
typedef struct line_to_render {
  const sprout_effect *effect;
  speaking said, frame;
  sprout_speech frame_speech;
  tape said_tape, frame_tape;
} line_to_render;

/* The line an NPC's words are framed by: the engine's `npc_says` of the speaker, with the speaker as `actor`. */
static sprout_eval_status npc_says(const prose_reading *reading, line_to_render *line) {
  sprout_frame frame = prose_frame(reading, NULL, line->effect->speaker, NULL, NULL);
  const sprout_stored_instance *speaker = expr_instance(&frame, line->effect->speaker);
  sprout_str place = {NULL, 0}, by;
  sprout_binding *made;
  if (speaker != NULL && speaker->has_container) place = speaker->container;
  sprout_engine_said(&frame, "npc_says", &line->effect->speaker, place.bytes == NULL ? NULL : &place, &by,
                     &line->frame_speech);
  line->frame.by = by;
  line->frame.said = &line->frame_speech;
  made = (sprout_binding *)sprout_arena_take(reading->turn, sizeof *made);
  if (made == NULL) return SPROUT_EVAL_NO_MEMORY;
  made->name = "actor";
  made->bound = sprout_evaluated_object(line->effect->speaker);
  line->frame.bindings = made;
  return SPROUT_EVAL_OK;
}

/*
 * An NPC's line as the reader reads it: the paragraphs of what it said as one, as the `words` of
 * the framing line, which every reader draws alike. The whole line is charged, and left out where
 * it renders nothing or does not fit someone other than the actor.
 */
static sprout_eval_status framed(const prose_reading *reading, sprout_draws *draws, prose_output *output,
                                 line_to_render *line, prose_paragraphs *out) {
  prose_paragraphs words, said;
  sprout_str joined_words, text;
  sprout_value value;
  sprout_binding *made;
  speaking framing = line->frame;
  prose_paragraphs framed_words;
  bool told;
  memset(out, 0, sizeof *out);
  EXPR_NEED(rendered_for(reading, draws, &line->said, &line->said_tape, &words));
  if (words.count == 0) return SPROUT_EVAL_OK;
  if (!joined(reading->turn, &words, &joined_words)) return SPROUT_EVAL_NO_MEMORY;
  if (!sprout_string(reading->turn, joined_words.bytes, joined_words.length, &value)) return SPROUT_EVAL_NO_MEMORY;
  made = (sprout_binding *)sprout_arena_take(reading->turn, sizeof *made);
  if (made == NULL) return SPROUT_EVAL_NO_MEMORY;
  made->name = "words";
  made->bound = sprout_evaluated_value(value);
  made->next = line->frame.bindings;
  framing.bindings = made;
  EXPR_NEED(rendered_for(reading, draws, &framing, &line->frame_tape, &framed_words));
  if (!joined(reading->turn, &framed_words, &text)) return SPROUT_EVAL_NO_MEMORY;
  if (text.length == 0) return SPROUT_EVAL_OK;
  EXPR_NEED(prose_charge(output, reading->reader, prose_characters(text), &told));
  if (!told) return SPROUT_EVAL_OK;
  said.count = 1;
  said.items = (sprout_str *)sprout_arena_take(reading->turn, sizeof(sprout_str));
  if (said.items == NULL) return SPROUT_EVAL_NO_MEMORY;
  said.items[0] = text;
  *out = said;
  return SPROUT_EVAL_OK;
}

/* A line as the reader reads it, charged to what they may still be told. */
static sprout_eval_status read_by(const prose_reading *reading, sprout_draws *draws, prose_output *output,
                                  line_to_render *line, prose_paragraphs *out) {
  bool told;
  EXPR_NEED(rendered_for(reading, draws, &line->said, &line->said_tape, out));
  EXPR_NEED(prose_charge(output, reading->reader, characters_of(out), &told));
  if (!told) memset(out, 0, sizeof *out);
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_render_effects(const sprout_exec *x, const sprout_str *actor, sprout_rendered *out) {
  prose_output output;
  prose_reading reading;
  sprout_told *told = NULL;
  size_t told_count = 0, told_capacity = 0, e, r;
  memset(&output, 0, sizeof output);
  memset(out, 0, sizeof *out);
  output.turn = x->turn;
  output.meter = x->meter;
  output.fault = x->fault;
  output.has_actor = actor != NULL;
  if (actor != NULL) output.actor = *actor;
  reading.world = x->world;
  reading.draft = x->draft;
  reading.turn = x->turn;
  reading.meter = x->meter;
  reading.fault = x->fault;
  reading.reader = (sprout_str){"", 0};
  for (e = 0; e < x->effect_count; e++) {
    line_to_render *line;
    /* An extension's effect is the extension's to put into words; the C runtime holds no extension. */
    if (x->effects[e].kind == SPROUT_EFFECT_EXTENSION) continue;
    line = (line_to_render *)sprout_arena_take(x->turn, sizeof *line);
    if (line == NULL) return SPROUT_EVAL_NO_MEMORY;
    line->effect = &x->effects[e];
    line->said.by = line->effect->by;
    line->said.said = &line->effect->said;
    EXPR_NEED(names_in_scope(&reading, line->effect->bindings, line->effect->binding_count, &line->said.bindings));
    if (line->effect->has_speaker) EXPR_NEED(npc_says(&reading, line));
    for (r = 0; r < line->effect->to_count; r++) {
      prose_paragraphs paragraphs;
      const sprout_stored_visitor *visitor;
      sprout_told *slot;
      reading.reader = line->effect->to[r];
      if (line->effect->has_speaker) EXPR_NEED(framed(&reading, x->draws, &output, line, &paragraphs));
      else EXPR_NEED(read_by(&reading, x->draws, &output, line, &paragraphs));
      if (paragraphs.count == 0) continue;
      visitor = sprout_visitor_of(x->draft, reading.reader);
      if (visitor == NULL) {
        sprout_frame frame = prose_frame(&reading, NULL, reading.reader, NULL, NULL);
        expr_text text = expr_text_begin(&frame);
        expr_put(&text, "`");
        expr_put_str(&text, reading.reader);
        expr_put(&text, "` reads a line, and is not a visitor.");
        x->fault->name = "Error";
        return SPROUT_EVAL_ENGINE;
      }
      slot = (sprout_told *)sprout_exec_grow(x->turn, (void **)&told, &told_count, &told_capacity, sizeof *slot);
      if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
      slot->kind = line->effect->kind;
      slot->from = line->effect->by;
      slot->to = reading.reader;
      slot->visit = visitor->visit;
      slot->paragraph_count = paragraphs.count;
      slot->paragraphs = paragraphs.items;
    }
  }
  out->told_count = told_count;
  out->told = told;
  out->cut_count = output.cut_count;
  out->cut = output.cut;
  return SPROUT_EVAL_OK;
}

sprout_status sprout_rendered_outcome(sprout_arena *turn, const sprout_draft *draft, const sprout_rendered *rendered,
                                      sprout_outcome *outcome) {
  size_t lines = 0, at = 0, i, j;
  sprout_line *made;
  sprout_cut *cuts;
  for (i = 0; i < rendered->told_count; i++) lines += rendered->told[i].paragraph_count;
  made = (sprout_line *)sprout_arena_take(turn, (lines + 1) * sizeof *made);
  cuts = (sprout_cut *)sprout_arena_take(turn, (rendered->cut_count + 1) * sizeof *cuts);
  if (made == NULL || cuts == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < rendered->told_count; i++)
    for (j = 0; j < rendered->told[i].paragraph_count; j++, at++) {
      made[at].recipient = rendered->told[i].visit.bytes;
      made[at].recipient_length = rendered->told[i].visit.length;
      made[at].text = rendered->told[i].paragraphs[j].bytes;
      made[at].text_length = rendered->told[i].paragraphs[j].length;
    }
  for (i = 0; i < rendered->cut_count; i++) {
    const sprout_stored_visitor *visitor = sprout_visitor_of(draft, rendered->cut[i]);
    if (visitor == NULL) return SPROUT_BAD_INPUT;
    cuts[i].recipient = visitor->visit.bytes;
    cuts[i].recipient_length = visitor->visit.length;
  }
  outcome->line_count = lines;
  outcome->lines = made;
  outcome->cut_count = rendered->cut_count;
  outcome->cuts = cuts;
  return SPROUT_OK;
}
