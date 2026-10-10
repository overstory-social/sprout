/*
 * What the evaluator's modules share (the spec's The type system > What the
 * compiler checks; Limits > Runtime budgets): the kinds of expression node,
 * the words a fault is told in, and the reads a frame makes of the draft.
 * Each module is functions over a frame, as the checker's are over a checker.
 */
#ifndef SPROUT_EXPR_H
#define SPROUT_EXPR_H

#include <string.h>

#include "../eval.h"

/* The language's integer range (the spec's Properties > The types). */
#define INTEGER_MIN (-2147483648.0)
#define INTEGER_MAX 2147483647.0

#define EXPR_NEED(expr)                                      \
  do {                                                       \
    sprout_eval_status need_ = (expr);                       \
    if (need_ != SPROUT_EVAL_OK) return need_;               \
  } while (0)

/* ---- faults.c: the words a fault is told in ---- */

/* A message being written into the frame's fault text; it stops at the end rather than overrun. */
typedef struct expr_text {
  char *at;
  char *end;
} expr_text;

expr_text expr_text_begin(const sprout_frame *frame);
void expr_put(expr_text *text, const char *words);
void expr_put_str(expr_text *text, sprout_str str);
void expr_put_number(expr_text *text, double number);
/* Names the rule broken, whose words are in the frame's fault text, and ends the evaluation with SPROUT_EVAL_FAULT. */
sprout_eval_status expr_fail(const sprout_frame *frame, const char *name);
/* Something the checker refuses reached the evaluator: "`what` reached the evaluator, which the checker refuses." */
sprout_eval_status expr_unchecked(const sprout_frame *frame, const char *what);
/* An engine error in its own words. */
sprout_eval_status expr_engine(const sprout_frame *frame, const char *words);
/* One step of the turn's budget; SPROUT_EVAL_FAULT when it is spent. */
sprout_eval_status expr_spend(const sprout_frame *frame);
/* A charge to some other budget that the meter refused. */
sprout_eval_status expr_budget_fault(const sprout_frame *frame);

/* ---- nodes.c: reading the nodes a cartridge holds ---- */

typedef enum expr_kind {
  EXPR_BOOLEAN,
  EXPR_INTEGER,
  EXPR_STRING,
  EXPR_BINDING,
  EXPR_SYMBOL,
  EXPR_KIND,
  EXPR_UNARY,
  EXPR_BINARY,
  EXPR_MEMBER,
  EXPR_CALL,
  EXPR_FREE_CALL,
  EXPR_BOUND,
  EXPR_OTHER
} expr_kind;

expr_kind expr_kind_of(const sprout_node *node);
/* The text of the identifier a node holds in `field`, or NULL. */
const char *expr_ident(const sprout_node *node, const char *field);
/* Whether `node` is `a && b`. */
bool expr_is_and(const sprout_node *node);
/* A call's arguments. */
size_t expr_argument_count(const sprout_node *call);
const sprout_node *expr_argument(const sprout_node *call, size_t index);
/* A member chain written on a name as the author wrote it, `kiln.shelf`, or NULL where it is not on a name. */
sprout_eval_status expr_written_members(const sprout_frame *frame, const sprout_node *member, const char **out);
/* The kind a kind expression names from the library that wrote the body, or NULL. */
const sprout_kind_def *expr_kind_named(const sprout_frame *frame, const sprout_node *written);
sprout_str expr_str(const char *text);

/* ---- instances.c: reading the draft ---- */

/* The decoded instance under `id`, or NULL. */
const sprout_stored_instance *expr_instance(const sprout_frame *frame, sprout_str id);
/* The same, where the checker guarantees there is one: an engine error otherwise. */
sprout_eval_status expr_instance_of(const sprout_frame *frame, sprout_str id, const sprout_stored_instance **out);
/* Matching is nominal and by composition: whether `kind` composes the kind named. */
bool expr_composes(const sprout_kind_def *kind, const char *qualified);
/* The value of a stored property, decoded under its declared type. */
sprout_eval_status expr_decode(const sprout_frame *frame, const sprout_decl_type *type,
                               const sprout_stored_value *stored, sprout_value *out);
sprout_eval_status expr_get(const sprout_frame *frame, const sprout_stored_instance *instance, const char *name,
                            sprout_value *out);
/* What `self` remembers about `actor`: what was written, or the declared default. */
sprout_eval_status expr_recalled(const sprout_frame *frame, sprout_str actor, const char *name, sprout_value *out);

/* ---- range.c, passes.c: what is in range of what ---- */

bool expr_live(const sprout_frame *frame, sprout_str id);
/* Whether a container lets `asking` through (a message's qualified name, or NULL for any). */
sprout_eval_status expr_passes(const sprout_frame *frame, sprout_str container, const char *asking, bool *open);
/* Whether `target` is in range of `asker` by the path between them alone. */
sprout_eval_status expr_reaches(const sprout_frame *frame, sprout_str asker, sprout_str target, const char *asking,
                                bool *out);
/* Whether `id` is live and in range of the frame's `self`. */
sprout_eval_status expr_seen_by(const sprout_frame *frame, sprout_str id, bool *out);
/* What `container` directly holds that the frame's `self` can see, in the container's order. */
sprout_eval_status expr_contents_seen(const sprout_frame *frame, sprout_str container, const sprout_str **ids,
                                      size_t *count);
/* Everything `from` sees, nearest first, itself included. */
sprout_eval_status expr_seen_from(const sprout_frame *frame, sprout_str from, const sprout_str **ids, size_t *count);

/* ---- names.c: what a name written in a body reaches ---- */

/* What the name table says `written` reaches from `self`'s body, read through: in range, or a fault. */
sprout_eval_status expr_reached_by_name(const sprout_frame *frame, const sprout_node *named, const char *written,
                                        sprout_str *out);
/* The instance `named` reaches from `self`'s body, whatever its range; *found is false where nothing is decoded there now. */
sprout_eval_status expr_named_object(const sprout_frame *frame, const sprout_node *named, sprout_str *out,
                                     bool *found);
/* `frame` with the name `operand` tests by `is(K)` bound to what it reaches now, where it is one in a kind's body. */
sprout_eval_status expr_narrowed(const sprout_frame *frame, const sprout_node *operand, sprout_frame *out);
const sprout_binding *expr_binding(const sprout_frame *frame, const char *name);

/* ---- operators.c: the operators, and reading an evaluation as what the checker guaranteed ---- */

sprout_eval_status expr_as_value(const sprout_frame *frame, const sprout_evaluated *evaluated, sprout_value *out);
sprout_eval_status expr_as_boolean(const sprout_frame *frame, const sprout_evaluated *evaluated, bool *out);
sprout_eval_status expr_as_integer(const sprout_frame *frame, const sprout_evaluated *evaluated, double *out);
sprout_eval_status expr_as_object(const sprout_frame *frame, const sprout_evaluated *evaluated, sprout_str *out);
sprout_eval_status expr_as_list(const sprout_frame *frame, const sprout_evaluated *evaluated, const sprout_list **out);
/* `!` or `-` on what a unary expression is written on. */
sprout_eval_status expr_unary(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *operand,
                              sprout_evaluated *out);
/* A binary expression other than `&&`, given its left already evaluated. */
sprout_eval_status expr_binary(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *left,
                               sprout_evaluated *out);

/* ---- members.c: `x.count` and the readings ---- */

sprout_eval_status expr_member(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *receiver,
                               sprout_evaluated *out);
/* `get`, `recall`, `count(K)`, `holds`, `is`, `includes` and `sees` on a receiver already evaluated. */
sprout_eval_status expr_reading(const sprout_frame *frame, const sprout_node *expr, const sprout_evaluated *receiver,
                                sprout_evaluated *out);

/* ---- draws.c: `chance` and `random` ---- */

sprout_eval_status expr_drawn(const sprout_frame *frame, const sprout_node *expr, sprout_evaluated *out);

#endif
