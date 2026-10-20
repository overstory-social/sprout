/*
 * The parser's own word lists (the spec's Names > Articles; Verbs > Set roles, Exits; Parsing > Matching a line,
 * Pronouns, Sequences, again and all): `corpus/goldens/parser-words.json` pins them, list by list and in
 * order.
 */
#include <string.h>

#include "parse.h"

static const char *const DETERMINERS[] = {"a", "an", "the", "my", "this", "that"};
static const char *const CONNECTORS[] = {"and", ","};
static const char *const RELATIVE_WORDS[] = {"in", "on", "that", "is", "one"};
static const char *const ALL_WORDS[] = {"all", "everything"};
static const char *const PARSER_WORDS[] = {"then", "again", "g", "all", "everything", "except"};
static const char *const DIRECTIONS[] = {"north", "south",     "east",      "west", "northeast", "northwest",
                                         "southeast", "southwest", "up", "down",      "in",        "out"};
static const char *const WAY_WORDS[] = {"through", "into", "down", "up"};
static const char *const PRONOUN_WORDS[] = {"it", "them", "him", "her"};
static const char *const PRONOUNS_MEANT[] = {"it", "they", "he", "she"};
static const char *const ABBREVIATED[] = {"n", "s", "e", "w", "ne", "nw", "se", "sw", "u", "d"};
static const char *const ABBREVIATES[] = {"north",     "south",     "east",      "west", "northeast",
                                          "northwest", "southeast", "southwest", "up",   "down"};

#define LIST(name, words) {name, words, sizeof words / sizeof *words}

const parse_list parse_lists[] = {LIST("determiners", DETERMINERS),      LIST("connectors", CONNECTORS),
                                  LIST("relativeWords", RELATIVE_WORDS), LIST("allWords", ALL_WORDS),
                                  LIST("parserWords", PARSER_WORDS),     LIST("directions", DIRECTIONS),
                                  LIST("wayWords", WAY_WORDS)};
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
