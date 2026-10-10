/*
 * What an instance is called while the world runs (the spec's Names > Addressing and display,
 * Nicknames). A thing's name is its grammar block's `name`, or its identifier humanised, or, for a
 * spawn, which has none, its kind's name humanised in lower case; a visitor is called by their
 * nickname as the turn leaves it. The words a visitor types for it and the article the engine puts
 * before it are built on this name. It is shared so that offers.c and the view name things without
 * importing prose/: inside runtime-c the layers run expr, then stmt and reading, then prose, with
 * address beside them for whoever needs a name.
 */
#ifndef SPROUT_ADDRESS_H
#define SPROUT_ADDRESS_H

#include "eval.h"

/* The visitor record whose person is `instance` as the turn stands, or NULL. */
const sprout_stored_visitor *sprout_visitor_of(const sprout_draft *draft, sprout_str instance);

/* `_` read as a space: an identifier as a name, an option as a slot renders it. False when the host refuses a page. */
bool sprout_humanised(sprout_arena *arena, sprout_str text, sprout_str *words);

/* The `value` of a text line the composed kind's grammar writes (`name`, `article`), or NULL. */
const sprout_node *sprout_grammar_text(const sprout_kind_def *kind, const char *line);

/* What `instance` is called, as the engine writes it after its article. */
sprout_eval_status sprout_name_of(const sprout_frame *frame, const sprout_stored_instance *instance, sprout_str *name);

#endif
