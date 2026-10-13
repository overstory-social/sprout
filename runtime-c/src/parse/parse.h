/*
 * The command parser's areas (the spec's Parsing; Verbs > Slots; Names > Addressing and display), each a module of
 * functions over what it reads: the parser's word lists (words.c), what a thing is called and answers to
 * (address.c), what an actor can name (reach.c), what a noun names (nouns.c), a run of things in a role that
 * takes one (runs.c), the way out a slot's words name (exits.c), what a slot's words fill its role with
 * (fill.c), where a phrase's slots fall in a line (match.c), and a line read as the command turn reads it
 * (command.c, `sprout_parse`). Every candidate a noun is tried against is a step, charged where the TypeScript
 * parser charges it. Scratch is the turn's arena, rewound with it; what a host reads is copied into the arena it
 * hands in.
 */
#ifndef SPROUT_PARSE_H
#define SPROUT_PARSE_H

#include "../eval.h"
#include "../exits.h"
#include "../world.h"

/* ---- words.c: the parser's word lists ---- */

/* One list, by the name the golden gives it. */
typedef struct parse_list {
  const char *name;
  const char *const *words;
  size_t count;
} parse_list;

/* One list of pairs: a typed word and what it means. */
typedef struct parse_pairs {
  const char *name;
  const char *const *typed, *const *meant;
  size_t count;
} parse_pairs;

extern const parse_list parse_lists[];
extern const size_t parse_list_count;
extern const parse_pairs parse_pair_lists[];
extern const size_t parse_pair_list_count;

/* A pronoun as a thing declares it: `it`, `they`, `he` or `she`. */
typedef enum parse_pronoun { PARSE_PRONOUN_NONE, PARSE_PRONOUN_IT, PARSE_PRONOUN_THEY, PARSE_PRONOUN_HE, PARSE_PRONOUN_SHE } parse_pronoun;

bool parse_is(sprout_str word, const char *text);
/* An article, `my`, `this` or `that`, each optional before a noun (the spec's Names > Articles). */
bool parse_is_determiner(sprout_str word);
/* `and` or a comma, which separate the things of a run (the spec's Set roles). */
bool parse_is_connector(sprout_str word);
/* `all`, or `everything` for it. */
bool parse_is_all(sprout_str word);
/* The pronoun a typed word is, `them` being `they`; PARSE_PRONOUN_NONE where it is none a visitor types. */
parse_pronoun parse_pronoun_in(sprout_str word);
/* The pronoun a grammar block's `pronouns` value names; PARSE_PRONOUN_NONE for NULL. */
parse_pronoun parse_pronoun_named(const char *declared);
/* `it`, `they`, `he` or `she`; NULL for none. */
const char *parse_pronoun_text(parse_pronoun pronoun);
/* The direction one typed word names, written out or abbreviated, as the world writes it; NULL where it names none. */
const char *parse_direction_of(sprout_str word);

/* ---- address.c: what a thing is called and answers to ---- */

/* A run of typed words. */
typedef struct parse_words {
  const sprout_str *words;
  size_t count;
} parse_words;

/* How the engine writes a thing and what a visitor may type for it. */
typedef struct parse_address {
  sprout_str name;     /* as the engine writes it, after its article */
  const char *article; /* `a`, `an`, `the` or `none` */
  parse_pronoun pronoun;
  size_t noun_count;
  parse_words *nouns; /* every noun it answers to, the full name first, each once */
  size_t adjective_count;
  sprout_str *adjectives; /* every adjective, each one word and once: these alone name it weakly */
} parse_address;

/*
 * What `instance` is called and answers to, in the turn arena: a thing by its grammar block and the defaults, its
 * identifier among its nouns; a visitor by their nickname, with no article, and the nouns and adjectives their
 * kind writes. Charges nothing.
 */
sprout_eval_status parse_address_of(const sprout_frame *frame, const sprout_stored_instance *instance, parse_address *out);

/* `article name`, the name in lower case: how the engine writes a thing, all a visitor has to tell two apart by. */
sprout_eval_status parse_written_as(const sprout_frame *frame, const parse_address *address, sprout_str *out);

/* ---- reach.c: what an actor can name ---- */

/* One thing a noun may name. */
typedef struct parse_candidate {
  const sprout_stored_instance *instance;
  parse_address address;
  size_t near;  /* smaller is nearer, and equal only among the equally near */
  bool carried; /* the one typing carries it, through open containers they carry */
} parse_candidate;

/*
 * What `actor` may name, nearest first: every live thing the range walk reaches but the world, with its nearness
 * and whether the actor carries it; in the dark only the actor and what they carry (the spec's Range; Range >
 * Sight; Parsing > Choosing a reading). Every object the walk visits is a step.
 */
sprout_eval_status parse_reach_of(const sprout_frame *frame, sprout_str actor, parse_candidate **out, size_t *count);

/* ---- nouns.c: what a noun names ---- */

/* What resolving a noun reads besides the candidates: the turn (its meter and arena) and what the pronouns name. */
typedef struct parse_noun_context {
  const sprout_frame *frame;
  const sprout_str *referents;
  size_t referent_count;
} parse_noun_context;

/* One thing a noun may name: how near, how many typed words its name matched, whether its whole name was typed. */
typedef struct parse_named {
  const parse_candidate *candidate;
  size_t near, literal;
  bool by_name;
  parse_pronoun pronoun; /* the pronoun typed for it, where a pronoun named it */
} parse_named;

typedef enum parse_found {
  PARSE_FOUND_SOME,    /* every thing that fits, nearest first */
  PARSE_FOUND_NOTHING, /* nothing among the candidates answers */
  PARSE_FOUND_UNFIT    /* something answers, and none of it may fill the role: what answers */
} parse_found;

typedef struct parse_noun_found {
  parse_found found;
  size_t count;
  parse_named *things;
} parse_noun_found;

/* Whether a thing may fill the slot a noun is for. */
typedef bool (*parse_fitting)(const void *context, const sprout_stored_instance *instance);

/* The words as typed, and without a leading article or determiner where one leads more words: 1 or 2 forms. */
size_t parse_forms(parse_words words, parse_words forms[2]);

/* How an address answers to words: by its whole name, by a noun, by adjectives alone, or not at all. */
typedef enum parse_by { PARSE_BY_NAME, PARSE_BY_NOUN, PARSE_BY_ADJECTIVE, PARSE_BY_NONE } parse_by;
parse_by parse_answers_to(parse_words words, const parse_address *address);

/* What one noun names among `candidates`, nearest first, of what `fitting` says may fill its slot. */
sprout_eval_status parse_things_in(const parse_noun_context *context, parse_words words, parse_fitting fitting,
                                   const void *fit, const parse_candidate *candidates, size_t count,
                                   parse_noun_found *out);

/* Whether `instance` may fill `role`: any thing an open role, one composing its kind a kind's. */
bool parse_fits(const sprout_role *role, const sprout_stored_instance *instance);

/* One set a run may name: its things in the order typed, duplicates collapsed, and how they matched. */
typedef struct parse_named_set {
  size_t count;
  const parse_candidate **things;
  size_t near, literal, by_name;
  size_t pronoun_count;
  const parse_named *pronouns; /* those of its things a pronoun named */
} parse_named_set;

/* What a set role's run names: every set its nouns make, or what its first noun that names nothing it may take found, and where that noun runs. */
typedef struct parse_run_found {
  bool sets;
  parse_found found; /* NOTHING or UNFIT where `sets` is false */
  size_t start, end;
  size_t count;
  parse_named_set *named;
} parse_run_found;

/* What a set role's run names, each noun on its own, every set its nouns' things make together, each set a step. */
sprout_eval_status parse_run_in(const parse_noun_context *context, parse_words words, const sprout_role *role,
                                const parse_candidate *candidates, size_t count, parse_run_found *out);

/* Where one noun of a run stands among its words, `end` one past its last. */
typedef struct parse_stretch {
  size_t start, end;
} parse_stretch;

/*
 * Where a run's nouns stand, split at every connector, a comma before `and` counting as one; an empty one where
 * connectors stand together otherwise, or at an end. `out` has room for one more than the words.
 */
size_t parse_nouns_of_run(parse_words words, parse_stretch *out);

/* ---- runs.c: a run of things in a role that takes one ---- */

/*
 * The items `words` hold as a run in `role`, in the order written, at most a set role's figure: none (0) where they
 * are no run. A stretch is one item where it names something outright, the longest first; each tried is a noun
 * tried, and each candidate counted for connectors a step. `out` has room for one more than the words.
 */
sprout_eval_status parse_items_of_run(const parse_noun_context *context, parse_words words, const sprout_role *role,
                                      const parse_candidate *candidates, size_t count, parse_stretch *out,
                                      size_t *items);

/* Whether a noun of the run `words` is `all` or `everything`, which a run of things does not hold. */
bool parse_holds_all(parse_words words, parse_stretch *scratch);

/* Whether `words` name something in reach by a noun or its whole name, not adjectives alone. */
sprout_eval_status parse_names_outright(const parse_noun_context *context, parse_words words,
                                        const parse_candidate *candidates, size_t count, bool *named);

/* ---- exits.c: the way out a slot's words name ---- */

/* A label's words without the article, `my`, `this` or `that` it starts with; a lone word is kept. */
parse_words parse_label_words(parse_words words);

/* The way `words` name among `ways`, in the order the place declares them: the first in the direction named, else the first whose label they are; NULL for none. */
const sprout_way *parse_exit_named(const sprout_graph *graph, parse_words words, const sprout_way *ways, size_t count);

/* Whether `words`, less a leading article, are the label some exit or link in the world is written with. Charges nothing. */
bool parse_way_label(const sprout_world *world, parse_words words);

/* ---- fill.c: what a slot's words fill its role with ---- */

typedef enum parse_fills {
  PARSE_FILLS_OPTIONS, /* every way they fill it: things, sets, or the exit */
  PARSE_FILLS_WORDS,   /* a value role's words, bound once the reading's participants are known */
  PARSE_FILLS_NOTHING, /* nothing in range answers to the noun from `start` to `end` of the slot's words */
  PARSE_FILLS_UNFIT,   /* the phrase does not match: what answers cannot fill the role, or no exit or set fits */
  PARSE_FILLS_RUN,     /* a run in a role that takes one thing: its first item's options, and the items after it */
  PARSE_FILLS_OUTWARD, /* a carried role: nothing carried answers, and these, further out, would fill it */
  PARSE_FILLS_REFUSED, /* an exit that refuses, which answers with its words */
  PARSE_FILLS_NO_WAY   /* a direction no exit that applies answers */
} parse_fills;

typedef struct parse_later parse_later;

typedef struct parse_filled {
  parse_fills fills;
  size_t start, end;           /* NOTHING */
  size_t thing_count;          /* OPTIONS of a thing role, UNFIT, RUN's first item, OUTWARD */
  const parse_named *things;
  size_t set_count;            /* OPTIONS of a set role */
  const parse_named_set *sets;
  const sprout_way *way;       /* OPTIONS of an exit role, REFUSED */
  size_t literal;              /* OPTIONS of an exit role: the label's words typed */
  const char *direction;       /* NO_WAY */
  size_t later_count;          /* RUN */
  const parse_later *later;
} parse_filled;

/* An item of a run after its first: where it stands among the slot's words, and what it fills the role with. */
struct parse_later {
  size_t start, end;
  parse_filled filled;
};

/* What filling a slot reads: the noun context, what the actor can reach, and the ways out that apply. */
typedef struct parse_fill_context {
  parse_noun_context nouns;
  const parse_candidate *candidates;
  size_t candidate_count;
  const sprout_way *ways;
  size_t way_count;
} parse_fill_context;

/* What `words`, taken by a slot, fill `role` with; `all` is read before this, by its own owner. */
sprout_eval_status parse_fill_slot(const parse_fill_context *context, const sprout_role *role, parse_words words,
                                   parse_filled *out);

/* What `words`, taken by an intent's slot given to `roles`, fill it with: each thing that fits one of them. */
sprout_eval_status parse_fill_intent_slot(const parse_fill_context *context, const sprout_role *const *roles,
                                          size_t role_count, parse_words words, parse_filled *out);

/* ---- match.c: where a phrase's slots fall ---- */

/* The words one slot takes: its role, by index, and where in the line they run, `end` one past the last. */
typedef struct parse_span {
  size_t role, start, end;
} parse_span;

/* Called with each placement in the order tried; anything but SPROUT_EVAL_OK stops the walk with it. */
typedef sprout_eval_status (*parse_placed)(void *context, const parse_span *spans, size_t count);

/*
 * Every way `parts` cover `words` exactly, each slot at least one word, the phrase's words standing where they are
 * written, an earlier slot's longer run tried first (the spec's Verbs > Slots; Names > Nicknames: longest first).
 */
sprout_eval_status parse_slot_spans(sprout_arena *scratch, const sprout_typed_part *parts, size_t part_count,
                                    const sprout_str *words, size_t word_count, parse_placed each, void *context);

/* ---- command.c: a line as the command turn reads it ---- */

/* `line` without a trailing `?`, which is read as nothing; a `?` alone is kept, since it is a phrase of `help`. */
sprout_str parse_without_question(sprout_str line);

#endif
