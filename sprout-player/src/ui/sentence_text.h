/*
 * The sentence builder's text: words that grow from the device's allocator and are found by offset,
 * since the block moves, and the labels the disc and the sentence are made of: a verb's name, a
 * filler's, a role's word, a number, a refusal. Nothing here draws or knows where the builder is.
 */
#ifndef PLAYER_UI_SENTENCE_TEXT_H
#define PLAYER_UI_SENTENCE_TEXT_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"
#include "sprout.h"

/* Text that grows from the device's allocator; strings in it are found by offset, since it moves. */
typedef struct sentence_text {
  char *bytes;
  size_t length, room;
} sentence_text;

/* Makes room for `want` items of `unit` bytes in the block at `*block`, which holds `*room`. */
bool sentence_grow(PlaydateAPI *pd, void **block, size_t *room, size_t want, size_t unit);

/* Appends the `n` bytes at `bytes` to the string being made at the end of `t`, which stays NUL-terminated. */
bool words_add(PlaydateAPI *pd, sentence_text *t, const char *bytes, size_t n);
bool words_add_text(PlaydateAPI *pd, sentence_text *t, const char *text);

/* Ends the string begun at `start`: 1 + its offset, or 0 where there was no memory. */
size_t words_close(PlaydateAPI *pd, sentence_text *t, size_t start, bool ok);

/* The string at 1 + its offset, or NULL for 0. */
const char *words_at(const sentence_text *t, size_t at);

/* A verb's name without its library, its underscores as spaces: `sprout.pick_up` is `pick up`. */
bool words_verb(PlaydateAPI *pd, sentence_text *t, const char *qualified);

/* The things' names, joined by commas. */
bool words_names(PlaydateAPI *pd, sentence_text *t, const sprout_seen_thing *const *things, size_t count);

/* What a filler is called on the disc: a thing's name, a set's names, a way out's direction or label. */
bool words_filler(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler);

/* A role as the disc offers it where a reading may leave it out: the words its phrase puts before it, or its name where the view carries none. */
bool words_role(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler);

/* The words the sentence shows before a pick made through its role's word, and a space; none where the view carries none. */
bool words_before(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler);

/* A whole number as digits, with its sign. */
bool words_number(PlaydateAPI *pd, sentence_text *t, double number);

/* A refusal's paragraphs as one line. */
bool words_refusal(PlaydateAPI *pd, sentence_text *t, const sprout_seen_reading *leaf);

#endif
