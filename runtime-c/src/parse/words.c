/*
 * The parser's own word lists (the spec's Names > Articles; Verbs > Set roles, Exits; Parsing > Matching a line,
 * Pronouns, Sequences, again and all): `corpus/goldens/parser-words.json` pins them, list by list and in
 * order. A quotation mark is dropped only where it opens or closes a typed word, so an apostrophe inside one,
 * `king's`, is kept.
 */
#include <string.h>

#include "parse.h"

static const char *const DETERMINERS[] = {"a", "an", "the", "my", "this", "that"};
static const char *const CONNECTORS[] = {"and", ","};
static const char *const RELATIVE_WORDS[] = {"in", "on", "that", "is", "one"};
static const char *const ALL_WORDS[] = {"all", "everything"};
static const char *const HOLDER_WORDS[] = {"from", "off", "out of", "in", "on"};
static const char *const PARSER_WORDS[] = {"then", "again", "g", "all", "everything", "except"};
static const char *const DIRECTIONS[] = {"north", "south",     "east",      "west", "northeast", "northwest",
                                         "southeast", "southwest", "up", "down",      "in",        "out"};
static const char *const WAY_WORDS[] = {"through", "into", "down", "up"};
static const char *const PRONOUN_WORDS[] = {"it", "them", "him", "her"};
static const char *const PRONOUNS_MEANT[] = {"it", "they", "he", "she"};
/* Straight and curly, double and single: `"`, `'`, `“`, `”`, `‘`, `’`. */
static const char *const QUOTATION_MARKS[] = {"\"", "'", "\xe2\x80\x9c", "\xe2\x80\x9d", "\xe2\x80\x98", "\xe2\x80\x99"};
static const char *const ABBREVIATED[] = {"n", "s", "e", "w", "ne", "nw", "se", "sw", "u", "d"};
static const char *const ABBREVIATES[] = {"north",     "south",     "east",      "west", "northeast",
                                          "northwest", "southeast", "southwest", "up",   "down"};

#define LIST(name, words) {name, words, sizeof words / sizeof *words}

const parse_list parse_lists[] = {LIST("determiners", DETERMINERS),      LIST("connectors", CONNECTORS),
                                  LIST("relativeWords", RELATIVE_WORDS), LIST("allWords", ALL_WORDS),
                                  LIST("holderWords", HOLDER_WORDS),     LIST("parserWords", PARSER_WORDS),
                                  LIST("directions", DIRECTIONS),        LIST("wayWords", WAY_WORDS),
                                  LIST("quotationMarks", QUOTATION_MARKS)};
const size_t parse_list_count = sizeof parse_lists / sizeof *parse_lists;

const parse_pairs parse_pair_lists[] = {
    {"typedPronouns", PRONOUN_WORDS, PRONOUNS_MEANT, sizeof PRONOUN_WORDS / sizeof *PRONOUN_WORDS},
    {"abbreviations", ABBREVIATED, ABBREVIATES, sizeof ABBREVIATED / sizeof *ABBREVIATED}};
const size_t parse_pair_list_count = sizeof parse_pair_lists / sizeof *parse_pair_lists;

bool parse_is(sprout_str word, const char *text) {
  return word.length == strlen(text) && memcmp(word.bytes, text, word.length) == 0;
}

static bool among(sprout_str word, const char *const *words, size_t count) {
  size_t i;
  for (i = 0; i < count; i++)
    if (parse_is(word, words[i])) return true;
  return false;
}

bool parse_is_determiner(sprout_str word) { return among(word, DETERMINERS, sizeof DETERMINERS / sizeof *DETERMINERS); }

bool parse_is_connector(sprout_str word) { return among(word, CONNECTORS, sizeof CONNECTORS / sizeof *CONNECTORS); }

bool parse_is_way_word(sprout_str word) { return among(word, WAY_WORDS, sizeof WAY_WORDS / sizeof *WAY_WORDS); }

bool parse_is_all(sprout_str word) { return among(word, ALL_WORDS, sizeof ALL_WORDS / sizeof *ALL_WORDS); }

/* How many bytes of a quotation mark begin `word` (`at_end` false) or end it (`at_end` true); 0 where none does. */
static size_t quotation_mark(sprout_str word, bool at_end) {
  size_t i;
  for (i = 0; i < sizeof QUOTATION_MARKS / sizeof *QUOTATION_MARKS; i++) {
    size_t n = strlen(QUOTATION_MARKS[i]);
    if (n <= word.length && memcmp(word.bytes + (at_end ? word.length - n : 0), QUOTATION_MARKS[i], n) == 0) return n;
  }
  return 0;
}

size_t parse_without_quotes(sprout_str *words, size_t count) {
  size_t i, kept = 0, n;
  for (i = 0; i < count; i++) {
    sprout_str word = words[i];
    bool trimmed = false;
    while ((n = quotation_mark(word, false)) > 0) {
      word.bytes += n;
      word.length -= n;
    }
    while ((n = quotation_mark(word, true)) > 0) {
      word.length -= n;
      trimmed = true;
    }
    /* The word's bytes are the line's own, made for this read, so its end may be written. */
    if (trimmed) ((char *)word.bytes)[word.length] = '\0';
    if (word.length > 0) words[kept++] = word;
  }
  return kept;
}

size_t parse_holder_word_at(const sprout_str *words, size_t count, size_t at) {
  size_t i;
  for (i = 0; i < sizeof HOLDER_WORDS / sizeof *HOLDER_WORDS; i++) {
    const char *written = HOLDER_WORDS[i];
    size_t taken = 0;
    while (*written != '\0') {
      const char *space = strchr(written, ' ');
      size_t length = space == NULL ? strlen(written) : (size_t)(space - written);
      if (at + taken >= count || words[at + taken].length != length ||
          memcmp(words[at + taken].bytes, written, length) != 0)
        break;
      taken++;
      written += space == NULL ? length : length + 1;
    }
    if (*written == '\0') return taken;
  }
  return 0;
}

/* `length` bytes of `word`, then `tail`, NUL-terminated in `arena`, as `*out`. */
static bool written(sprout_arena *arena, sprout_str word, size_t length, const char *tail, sprout_str *out) {
  size_t extra = strlen(tail);
  char *text = (char *)sprout_arena_take(arena, length + extra + 1);
  if (text == NULL) return false;
  memcpy(text, word.bytes, length);
  memcpy(text + length, tail, extra + 1);
  out->bytes = text;
  out->length = length + extra;
  return true;
}

bool parse_singulars(sprout_arena *arena, sprout_str word, sprout_str out[3], size_t *count) {
  size_t n = word.length;
  *count = 0;
  if (n < 2 || word.bytes[n - 1] != 's') return true;
  if (!written(arena, word, n - 1, "", &out[(*count)++])) return false;
  if (n > 2 && word.bytes[n - 2] == 'e' && !written(arena, word, n - 2, "", &out[(*count)++])) return false;
  if (n > 3 && word.bytes[n - 3] == 'i' && word.bytes[n - 2] == 'e' && !written(arena, word, n - 3, "y", &out[(*count)++]))
    return false;
  return true;
}

parse_pronoun parse_pronoun_in(sprout_str word) {
  size_t i;
  for (i = 0; i < sizeof PRONOUN_WORDS / sizeof *PRONOUN_WORDS; i++)
    if (parse_is(word, PRONOUN_WORDS[i])) return (parse_pronoun)(PARSE_PRONOUN_IT + i);
  return PARSE_PRONOUN_NONE;
}

parse_pronoun parse_pronoun_named(const char *declared) {
  size_t i;
  for (i = 0; declared != NULL && i < sizeof PRONOUNS_MEANT / sizeof *PRONOUNS_MEANT; i++)
    if (strcmp(declared, PRONOUNS_MEANT[i]) == 0) return (parse_pronoun)(PARSE_PRONOUN_IT + i);
  return PARSE_PRONOUN_NONE;
}

const char *parse_pronoun_text(parse_pronoun pronoun) {
  return pronoun == PARSE_PRONOUN_NONE ? NULL : PRONOUNS_MEANT[pronoun - PARSE_PRONOUN_IT];
}

const char *parse_direction_of(sprout_str word) {
  size_t i;
  for (i = 0; i < sizeof DIRECTIONS / sizeof *DIRECTIONS; i++)
    if (parse_is(word, DIRECTIONS[i])) return DIRECTIONS[i];
  for (i = 0; i < sizeof ABBREVIATED / sizeof *ABBREVIATED; i++)
    if (parse_is(word, ABBREVIATED[i])) return ABBREVIATES[i];
  return NULL;
}
