/* The sentence builder's text; see sentence_text.h. */
#include "sentence_text.h"

#include <string.h>

bool sentence_grow(PlaydateAPI *pd, void **block, size_t *room, size_t want, size_t unit) {
  size_t bigger = *room < 16 ? 16 : *room;
  void *moved;
  if (want <= *room) return true;
  while (bigger < want) bigger *= 2;
  moved = pd->system->realloc(*block, bigger * unit);
  if (moved == NULL) return false;
  *block = moved;
  *room = bigger;
  return true;
}

bool words_add(PlaydateAPI *pd, sentence_text *t, const char *bytes, size_t n) {
  void *block = t->bytes;
  if (!sentence_grow(pd, &block, &t->room, t->length + n + 1, 1)) return false;
  t->bytes = (char *)block;
  if (n > 0) memcpy(t->bytes + t->length, bytes, n);
  t->length += n;
  t->bytes[t->length] = '\0';
  return true;
}

bool words_add_text(PlaydateAPI *pd, sentence_text *t, const char *text) { return words_add(pd, t, text, strlen(text)); }

size_t words_close(PlaydateAPI *pd, sentence_text *t, size_t start, bool ok) {
  if (!ok || !words_add(pd, t, "", 0)) return 0;
  t->length++;
  return start + 1;
}

const char *words_at(const sentence_text *t, size_t at) { return at == 0 ? NULL : t->bytes + at - 1; }

bool words_verb(PlaydateAPI *pd, sentence_text *t, const char *qualified) {
  const char *name = strrchr(qualified, '.');
  size_t from = t->length, i;
  name = name == NULL ? qualified : name + 1;
  if (!words_add_text(pd, t, name)) return false;
  for (i = from; i < t->length; i++)
    if (t->bytes[i] == '_') t->bytes[i] = ' ';
  return true;
}

bool words_names(PlaydateAPI *pd, sentence_text *t, const sprout_seen_thing *const *things, size_t count) {
  size_t i;
  for (i = 0; i < count; i++)
    if ((i > 0 && !words_add_text(pd, t, ", ")) || !words_add(pd, t, things[i]->name.bytes, things[i]->name.length)) return false;
  return true;
}

bool words_filler(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler) {
  size_t i;
  switch (filler->binds) {
    case SPROUT_SEEN_OBJECT:
      return words_add(pd, t, filler->thing.name.bytes, filler->thing.name.length);
    case SPROUT_SEEN_SET:
      for (i = 0; i < filler->member_count; i++)
        if ((i > 0 && !words_add_text(pd, t, ", ")) || !words_add(pd, t, filler->members[i].name.bytes, filler->members[i].name.length))
          return false;
      return true;
    case SPROUT_SEEN_EXIT:
      return words_add_text(pd, t, filler->exit.direction != NULL ? filler->exit.direction : filler->exit.label);
    default:
      return words_add_text(pd, t, filler->role);
  }
}

bool words_role(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler) {
  return words_add_text(pd, t, filler->words[0] != '\0' ? filler->words : filler->role);
}

bool words_before(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler) {
  return filler->words[0] == '\0' || (words_add_text(pd, t, filler->words) && words_add_text(pd, t, " "));
}

bool words_number(PlaydateAPI *pd, sentence_text *t, double number) {
  char digits[32];
  size_t at = sizeof digits;
  long long whole = (long long)number;
  unsigned long long left = whole < 0 ? (unsigned long long)(-(whole + 1)) + 1u : (unsigned long long)whole;
  digits[--at] = '\0';
  do {
    digits[--at] = (char)('0' + (int)(left % 10u));
    left /= 10u;
  } while (left > 0);
  if (whole < 0) digits[--at] = '-';
  return words_add_text(pd, t, digits + at);
}

bool words_refusal(PlaydateAPI *pd, sentence_text *t, const sprout_seen_reading *leaf) {
  size_t i;
  for (i = 0; i < leaf->refusal_count; i++)
    if ((i > 0 && !words_add_text(pd, t, " ")) || !words_add(pd, t, leaf->refusal[i].bytes, leaf->refusal[i].length)) return false;
  return true;
}
