/*
 * What the prose modules share (the spec's Prose; Limits > Runtime budgets: output per
 * recipient): the words rendering gives before they are laid out, the names an object
 * renders under, what each reader has been charged, and the engine's own lines. Each module
 * is functions over a context, as the evaluator's are over a frame: slots.c renders a
 * passage's pieces, reflow.c lays rendered words out, names.c says what an object is called,
 * output.c counts what each reader is told, engine_lines.c holds the words the engine says
 * where no passage does.
 */
#ifndef SPROUT_PROSE_PROSE_H
#define SPROUT_PROSE_PROSE_H

#include "../address.h"
#include "../exec.h"
#include "../expr/expr.h"

/* ---- reflow.c: rendered words, laid out ---- */

/* What rendering prose gives, in order: words, or a break. */
typedef enum prose_piece_kind {
  PROSE_WORDS,
  PROSE_PARAGRAPH, /* a blank line */
  PROSE_LINE       /* `\n`, which reflow keeps */
} prose_piece_kind;

typedef struct prose_piece {
  prose_piece_kind kind;
  const char *bytes; /* UTF-8; words only */
  size_t length;
} prose_piece;

typedef struct prose_pieces {
  prose_piece *items;
  size_t count, capacity;
} prose_pieces;

/* The paragraphs a reflow lays out. */
typedef struct prose_paragraphs {
  size_t count;
  sprout_str *items;
} prose_paragraphs;

/* Appends a piece, in the arena; false when the host refuses a page. The bytes are not copied. */
bool prose_put(sprout_arena *arena, prose_pieces *pieces, prose_piece_kind kind, const char *bytes, size_t length);

/*
 * The paragraphs `rendered` lays out to (the spec's Prose > Passages, Slots): every run of white
 * space is one space and a paragraph has none at its ends, a blank line is a paragraph break and
 * a paragraph left with nothing is none, `\n` is kept, and the first letter of every line is
 * capitalised, past an opening quotation mark but not past a bracket. White space is what
 * JavaScript's `\s` is, and a letter or a number what `\p{L}` and `\p{N}` are.
 */
bool prose_reflow(sprout_arena *arena, const prose_pieces *rendered, prose_paragraphs *out);

/*
 * `rendered` as a slot puts it in its line (the spec's Prose > Slots): nothing where it holds no
 * words; otherwise its words with the space at their ends taken off, a blank line or two `\n` at
 * either end a paragraph break, and one `\n` a line break.
 */
bool prose_slotted(sprout_arena *arena, const prose_pieces *rendered, prose_pieces *out);

/* `line` with its first letter capitalised as reflow does. */
bool prose_capitalise(sprout_arena *arena, sprout_str line, sprout_str *out);

/* Whether the code point is white space to JavaScript's `\s`, `trim` and the spec's reflow. */
bool prose_is_space(unsigned long cp);

/* The code point at `bytes + at`, which is valid UTF-8 ending by `length`; *width is its bytes. */
unsigned long prose_decode(const char *bytes, size_t length, size_t at, size_t *width);

/* How many code points the bytes hold: what the host's output budget counts. */
size_t prose_characters(sprout_str text);

/* ---- names.c: what an object is called ---- */

/* `object` as `reader` reads it: "you", a visitor's nickname, or an article and a name. */
sprout_eval_status prose_object_words(const sprout_frame *frame, sprout_str object, sprout_str reader,
                                      sprout_str *words);


/* ---- output.c: what each reader may still be told ---- */

/* One reader's output this turn. */
typedef struct prose_recipient {
  sprout_str reader;
  uint64_t held;
  bool cut;
} prose_recipient;

/* What the turn has told each reader, and whom it has cut short, in the order it happened. */
typedef struct prose_output {
  sprout_arena *turn;
  sprout_meter *meter;
  sprout_eval_fault *fault;
  bool has_actor;
  sprout_str actor; /* whose own output past the host's figure faults the turn */
  size_t recipient_count, recipient_capacity;
  prose_recipient *recipients;
  size_t cut_count, cut_capacity;
  sprout_str *cut;
} prose_output;

/*
 * Charges `characters` to `reader` (the spec's Limits > Runtime budgets): the actor's own output
 * past the host's figure faults the turn, and anyone else's that would pass it cuts them short,
 * so they are told nothing more. *told is whether the reader is told them.
 */
sprout_eval_status prose_charge(prose_output *output, sprout_str reader, uint64_t characters, bool *told);

/* A fault that names the budget the meter says is spent. */
sprout_eval_status prose_budget_fault(sprout_eval_fault *fault, const sprout_meter *meter);

/* ---- written.c: where the words a reader read were written ---- */

/* Where the words a reader read were written: a named passage, or a one-line passage. */
typedef struct sprout_noted {
  bool passage;
  const char *name;   /* a passage: its name */
  const char *origin; /* a passage: the kind that wrote it, qualified */
  const char *at;     /* `file:line:column` */
} sprout_noted;

/* The passages and one-line passages that gave one reader's words so far, each once, in the order they finished. */
typedef struct prose_notes {
  sprout_arena *arena;
  sprout_noted *items;
  size_t count, capacity;
} prose_notes;

/* ---- slots.c: passages, slots, conditionals and loops ---- */

/* What a passage is rendered by, and for whom. */
typedef struct prose_reading {
  const sprout_world *world;
  sprout_draft *draft;
  sprout_arena *turn;
  sprout_meter *meter;
  sprout_eval_fault *fault;
  sprout_str reader; /* a name for this reader is "you" */
  prose_notes *notes; /* where the words are noted, or NULL where nobody asks */
} prose_reading;

/* Notes the passage `passage` (a node with `name`, `origin` and `at`) as having given the reader words, once. */
void prose_note_passage(const prose_reading *reading, const sprout_node *passage);

/* Notes the one-line passage whose prose is `prose` as having given the reader words, once. */
void prose_note_line(const prose_reading *reading, const sprout_node *prose);

/* Notes the engine's own line, read where no passage writes it, as having given the reader words, once. */
void prose_note_engine(const prose_reading *reading);

/* The frame a passage's prose renders in: `self` is its owner, and `draws` is NULL where nothing draws. */
sprout_frame prose_frame(const prose_reading *reading, sprout_draws *draws, sprout_str self, const char *library,
                         const sprout_binding *bindings);

/* Renders `prose`, a node of kind `prose`, into `out`. */
sprout_eval_status prose_render(const prose_reading *reading, const sprout_node *prose, const sprout_frame *frame,
                                prose_pieces *out);

/* The library in a qualified name: `sprout` in `sprout.World`. */
const char *prose_library_of(sprout_arena *arena, const char *qualified);

/* Enters a passage's depth, faulting the turn past the host's bound; leave it with sprout_meter_leave_passage. */
sprout_eval_status prose_enter_passage(const prose_reading *reading);

/* ---- prose.c: one line, for one reader ---- */

/*
 * The paragraphs `said`, said by `by` with `bindings` in scope, renders to for the reader, charged to nobody
 * and drawing nothing: how a description and a refusal are read in a poll.
 */
sprout_eval_status prose_render_speech(const prose_reading *reading, sprout_str by, const sprout_speech *said,
                                       const sprout_binding *bindings, prose_paragraphs *out);

/* ---- engine_lines.c: the engine's own words ---- */

/*
 * The engine's line `name` in the standard library's words, read as a one-line passage in the turn
 * arena; *known is false for a name that is no engine line.
 */
sprout_eval_status prose_engine_prose(sprout_arena *turn, sprout_eval_fault *fault, const char *name,
                                      const sprout_node **prose, bool *known);

/* The standard library's words for an engine line as the spec's Engine lines gives them, or NULL. */
const char *prose_stock_words(const char *name);

#endif
