/*
 * `and` or a comma before a verb, which joins two commands as `then` does (the spec's Parsing > Sequences, again and
 * all): `take sack and take bottle`, `open trap door, turn on lantern, go down`. A verb here is a word some phrase a
 * visitor may type begins with, or a direction where a phrase begins with a way out, so `take lamp and look` and
 * `take lamp, north` may split while `take x, y and z` stays a run. Where the `and` or comma falls is only a place the
 * line may split; whether it does is command.c's, which prefers a reading that takes the line whole.
 */
#include <string.h>

#include "parse.h"

/* Whether `word` is the first word of `parts`, or `parts` begins with a way out of `verb` and `word` is a direction. */
static bool begins(const sprout_typed_part *parts, size_t count, const sprout_verb *verb, sprout_str word) {
  if (count == 0) return false;
  if (!parts[0].is_slot) return parts[0].word_count > 0 && parse_is(word, parts[0].words[0]);
  return verb != NULL && verb->roles[parts[0].role].filler == SPROUT_FILLER_EXIT && parse_direction_of(word) != NULL;
}

bool parse_begins_command(const sprout_world *world, sprout_str word) {
  size_t i;
  for (i = 0; i < world->phrase_count; i++)
    if (begins(world->phrases[i].parts, world->phrases[i].part_count, world->phrases[i].verb, word)) return true;
  for (i = 0; i < world->intent_phrase_count; i++)
    if (begins(world->intent_phrases[i].parts, world->intent_phrases[i].part_count, NULL, word)) return true;
  return false;
}

size_t parse_chain_points(const sprout_world *world, parse_words words, size_t *out) {
  size_t at, count = 0;
  for (at = 0; at + 1 < words.count; at++) {
    if (!parse_is_connector(words.words[at])) continue;
    if (parse_command_before(words, at).count == 0) continue;
    if (parse_begins_command(world, words.words[at + 1])) out[count++] = at;
  }
  return count;
}

parse_words parse_command_before(parse_words words, size_t at) {
  parse_words before;
  while (at > 0 && parse_is(words.words[at - 1], ",")) at--;
  before.words = words.words;
  before.count = at;
  return before;
}

parse_words parse_stretch_after(parse_words words, size_t at) {
  parse_words after;
  size_t end = at + 1;
  while (end < words.count && !parse_is_connector(words.words[end])) end++;
  after.words = words.words + at + 1;
  after.count = end - at - 1;
  return after;
}

const char *parse_command_after(sprout_arena *arena, parse_words words, size_t at) {
  size_t length = 0, i, used = 0;
  char *out;
  for (i = at + 1; i < words.count; i++) length += words.words[i].length + 1;
  out = (char *)sprout_arena_take_aligned(arena, length + 1, 1);
  if (out == NULL) return NULL;
  for (i = at + 1; i < words.count; i++) {
    if (i > at + 1) out[used++] = ' ';
    memcpy(out + used, words.words[i].bytes, words.words[i].length);
    used += words.words[i].length;
  }
  out[used] = '\0';
  return out;
}
