/*
 * The command parser's areas (the spec's Parsing; Verbs > Slots; Names > Addressing and display), each a module of
 * functions over what it reads: the parser's word lists (words.c), what a thing is called and answers to
 * (address.c), what an actor can name (reach.c), what a noun names (nouns.c), a run of things in a role that
 * takes one (runs.c), the way out a slot's words name (exits.c), what a slot's words fill its role with
 * (fill.c), `all` and `except` (all.c), where a phrase's slots fall in a line (match.c), the readings a placement
 * makes (readings.c), choosing among them (rank.c), a line read in part (partial.c), an object's synonym out of reach
 * (offered.c), the engine's answers to what it cannot read (answers.c), a run's items after its first (later.c),
 * `and` or a comma between two commands (chain.c), a reading a line planned (planned.c), the last reading run again
 * (again.c), an item of a run read on its own turn (item.c), and a line read as the command turn reads it
 * (command.c, `parse_command_turn` inside the turn and `sprout_parse` for a host). Every step is charged where `corpus/goldens/addresses.json` pins it. Scratch is the
 * turn's arena, or a phrase's rewound for the next; a reading kept is copied out of it, and what a host reads is
 * copied into the arena it hands in.
 */
#ifndef SPROUT_PARSE_H
#define SPROUT_PARSE_H

#include "../eval.h"
#include "../exits.h"
#include "../reading/reading.h"
#include "../turn.h"
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
/*
 * `words` with every quotation mark that opens or closes a word dropped, paired or not, and each word left empty
 * dropped; how many are left, in place (the spec's Parsing > Matching a line). A mark inside a word is kept.
 */
size_t parse_without_quotes(sprout_str *words, size_t count);
/* `through`, `into`, `down` or `up`, a word that may stand between a direction and a way's label: `south through the crawlway`. */
bool parse_is_way_word(sprout_str word);
/*
 * How many of `words`, from `at`, are a word that names what holds the things `all` takes, `from`, `off`, `out of`,
 * `in` or `on`; 0 where none stands there.
 */
size_t parse_holder_word_at(const sprout_str *words, size_t count, size_t at);
/*
 * What `word` is the plural of, where it ends in `s`: the word less `s`, less `es`, and with `ies` written `y`, in
 * `out`, the last made in `arena`; none where it does not. False where the arena is full.
 */
bool parse_singulars(sprout_arena *arena, sprout_str word, sprout_str out[3], size_t *count);
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

/* Where `words` are a direction, a way word and more, `south through the crawlway`: the direction, and in `label` the words from the way word on; NULL otherwise. */
const char *parse_direction_through(parse_words words, parse_words *label);

/* Whether `label`, from its way word on, names a label: the words after the way word, or with it, `up the ladder`. */
bool parse_through_label(const sprout_world *world, parse_words label);

/* The way `words` name among `ways`, in the order the place declares them: the first in the direction named, the first in the direction named through its own label, else the first whose label they are; NULL for none. */
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
  PARSE_FILLS_ALL,     /* `all` in a role that takes one thing: each thing it takes in turn, in the order reached */
  PARSE_FILLS_OUTWARD, /* a carried role: nothing carried answers, and these, further out, would fill it */
  PARSE_FILLS_REFUSED, /* an exit that refuses, which answers with its words */
  PARSE_FILLS_NO_WAY   /* a direction no exit that applies answers */
} parse_fills;

typedef struct parse_later parse_later;

typedef struct parse_filled {
  parse_fills fills;
  size_t start, end;           /* NOTHING */
  bool narrowed;               /* `all` narrowed by a noun or by what holds the things, NOTHING where none qualifies */
  size_t thing_count;          /* OPTIONS of a thing role, UNFIT, RUN's first item, OUTWARD, ALL */
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

/* What `words`, taken by a slot, fill `role` with; `all` is read before this (parse_all_in). */
sprout_eval_status parse_fill_slot(const parse_fill_context *context, const sprout_role *role, parse_words words,
                                   parse_filled *out);

/* What `words`, taken by an intent's slot given to `roles`, fill it with: each thing that fits one of them. */
sprout_eval_status parse_fill_intent_slot(const parse_fill_context *context, const sprout_role *const *roles,
                                          size_t role_count, parse_words words, parse_filled *out);

/*
 * The value `words` bind for the value role `role` of `reading`, whose things are bound: the option or whole number
 * they spell, as typed or after a leading article, where a participant's `from` hears it; `*bound` false where none
 * does, and the role is left unbound (the spec's Verbs > Value roles, A role-player narrows its own options).
 */
sprout_eval_status parse_value_of(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                  const sprout_role *role, parse_words words, bool *bound, sprout_stored_bound *value);

/* ---- all.c: `all` and `except` in a slot ---- */

/* What `all` reads besides the candidates: who types, where they stand, and the turn. */
typedef struct parse_all_context {
  parse_fill_context fill;
  sprout_str actor, here;
} parse_all_context;

/*
 * What `words` fill `role` of `verb` with where they are `all`, alone or with a noun, what holds them and `except`:
 * `*is_all` false where they do not begin with `all`, or the role takes a value or a way out, and the slot is read
 * as any other. A set role takes every thing at once, as one option; a role that takes one thing takes each in
 * turn (ALL). Each candidate weighed is a step, and each kind asked whether it plays the role.
 */
sprout_eval_status parse_all_in(const parse_all_context *context, parse_words words, const sprout_role *role,
                                const sprout_verb *verb, bool *is_all, parse_filled *out);

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

/* ---- readings.c: the readings one placement of a phrase makes ---- */

/* A reading as the parser makes it: a verb's, or an intent's, and what it binds, in the order bound. */
typedef struct parse_reading {
  const sprout_verb *verb;     /* NULL for an intent's */
  const sprout_intent *intent; /* NULL for a verb's */
  sprout_str actor;
  size_t count;
  const size_t *roles;               /* each binding's role, or the intent's slot, by index */
  const sprout_stored_bound *bounds; /* what each binding fills it with */
} parse_reading;

/* A thing a pronoun named, and the pronoun typed for it. */
typedef struct parse_pronoun_thing {
  sprout_str id;
  parse_pronoun pronoun;
} parse_pronoun_thing;

/*
 * What a reading a run made keeps to plan the run's later items once it is chosen: the placement's slots, what each
 * binds or that it is a value role's words, the run's slot, and each item after the first with what it fills the role
 * with.
 */
typedef struct parse_run {
  const sprout_typed_phrase *phrase;
  size_t count;
  const parse_span *spans;
  const bool *words;                 /* a value role's words, bound against the item's thing */
  const sprout_stored_bound *bounds; /* what the slot binds, where it is not words */
  size_t at;                         /* the run's slot */
  size_t later_count;
  const parse_later *later;
} parse_run;

/* A reading, and what it is ranked by (the spec's Parsing > Choosing a reading). */
typedef struct parse_ranked {
  parse_reading reading;
  bool allowed;           /* its consent pass allows it; an intent's always is */
  size_t literal;         /* the line's words it matched literally */
  size_t near_count;
  const size_t *near;     /* the nearness of what fills each role or slot, in declared order; 0 for none */
  size_t by_name;         /* the things it binds that were named by their whole name */
  size_t pronoun_count;
  const parse_pronoun_thing *pronouns;
  bool whole;             /* each item of its run names something, and every value typed is bound */
  size_t rest_count;
  const parse_reading *rest; /* `all`'s readings after this one, each a turn of its own */
  const parse_run *run;      /* a run's items after its first, planned once the reading is chosen; NULL for none */
} parse_ranked;

/* The readings a line made so far, one for each reading however many ways it was made, in the order first made. */
typedef struct parse_readings {
  parse_ranked *ranked;
  size_t count, capacity;
} parse_readings;

/* One placement of a phrase whose every slot fills: the phrase, where its slots fall, and what each fills. */
typedef struct parse_placement {
  const sprout_typed_phrase *phrase;        /* a verb's phrase, or NULL */
  const sprout_typed_intent_phrase *intent; /* an intent's phrase, or NULL */
  parse_words words;                        /* the line's */
  const parse_span *spans;
  size_t count;
  const parse_filled *const *fills;
} parse_placement;

/*
 * The reading a verb's placement makes, each slot binding `bounds[i]`, or, where `words[i]`, its words bound as a
 * value role's once the things are, since who hears a value depends on them.
 */
sprout_eval_status parse_reading_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                    const parse_placement *placement, const bool *words,
                                    const sprout_stored_bound *bounds, parse_reading *out);

/* The reading's roles filled as the passes take them, in the turn arena. */
sprout_eval_status parse_resolved_of(const sprout_frame *frame, const parse_reading *reading, sprout_resolved *out);

/* Whether the reading's consent pass allows it, charged to the turn. */
sprout_eval_status parse_allows(sprout_exec *x, const sprout_frame *frame, const parse_reading *reading, bool *allowed);

/*
 * Every reading one placement makes, each way of taking one option from each slot's a step, added to `readings`
 * (kept in `keep`) where it is new or matched more words than the same reading made before. `*nothing` is set where
 * `all` left nothing to run.
 */
sprout_eval_status parse_placement_readings(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                            const parse_placement *placement, sprout_arena *keep,
                                            parse_readings *readings, bool *nothing);

/* ---- rank.c: choosing a reading ---- */

/* Negative where `a` ranks before `b`, positive where after, 0 where they tie. */
int parse_compare_ranked(const parse_ranked *a, const parse_ranked *b);

/* The reading chosen, and the draw it was, where it was drawn. */
typedef struct parse_chosen {
  const parse_ranked *ranked;
  size_t among;              /* how many tied, 1 where none did */
  const sprout_str *meant;   /* the thing the engine's `meant` names, or NULL */
} parse_chosen;

/*
 * The best of `count` readings (at least one): where several tie, a step and then a draw below how many from the
 * turn's stream, and the thing `meant` names where words could tell the drawn one from a rival.
 */
sprout_eval_status parse_choose(const sprout_frame *frame, const parse_ranked *ranked, size_t count,
                                parse_chosen *out);

/* ---- partial.c: a line read in part ---- */

/* A partial reading: the line as far as it was understood, and what it is ranked by. */
typedef struct parse_partial {
  sprout_str words;      /* as a visitor would type it */
  size_t literal;        /* the line's words it matched literally, what a role cannot take included */
  size_t bound;          /* the roles its slots fill */
  sprout_str uncarried;  /* the thing a carried role names that the actor does not carry, where that is all that is wrong; no bytes for `cannot` */
} parse_partial;

/* The partial readings a line made that are tied for best so far, in the order made. */
typedef struct parse_partials {
  parse_partial *best;
  size_t count, capacity;
} parse_partials;

/* Negative where `a` ranks before `b`: more words matched, then more roles filled; 0 where they tie. */
int parse_compare_partial(const parse_partial *a, const parse_partial *b);

/*
 * Every partial reading a placement makes, each a step, kept in `keep` where it ranks with the best so far: none
 * where no slot names a thing it cannot take or does not carry, or a slot names nothing, or no thing.
 */
sprout_eval_status parse_partials_of(const sprout_frame *frame, const parse_placement *placement, sprout_arena *keep,
                                     parse_partials *partials);

/* A thing as a visitor names it in a line, in `arena`: `the` and its name in lower case, or its name alone where it takes no article. */
bool parse_definite(sprout_arena *arena, const parse_address *address, sprout_str *out);

/* The partial reading the world answers among `count` (at least one): the best, a tie a step and a draw from the turn's stream below how many tied. */
sprout_eval_status parse_choose_partial(const sprout_frame *frame, const parse_partial *partials, size_t count,
                                        const parse_partial **chosen, size_t *among);

/* ---- offered.c: an object's synonym out of reach ---- */

/*
 * Whether a placement of an object's synonym's phrase, some noun of which names nothing in reach, would read were
 * the object in reach: it is live, and each such noun names it, tried alone, in a role it may fill, each noun a
 * step. False for any other phrase.
 */
sprout_eval_status parse_offered_out_of_reach(const parse_fill_context *fill, const parse_placement *placement,
                                              bool *named);

/* ---- answers.c: the engine's answers to what it cannot read ---- */

/* A line answered rather than understood: which answer, who says it, what is said, and what it binds, unrendered. */
typedef struct parse_answer {
  const char *answer; /* `cannot`, `not_carrying`, `no_way`, `not_here`, `unknown`, or `refused`, an exit's own words */
  sprout_str by;
  sprout_speech said;
  size_t binding_count;
  sprout_said_binding bindings[3]; /* `actor`, `here`, then `cannot`'s `reading`, `not_carrying`'s `thing` or `no_way`'s `way` */
  const char *tried;               /* `refused`'s: the direction of the exit that refused, which what follows the command reads */
} parse_answer;

/* The engine's line `answer`, said to `actor` standing in `here`, with `given` bound after them where it is not NULL. */
void parse_answer_of(const sprout_frame *frame, const char *answer, sprout_str actor, sprout_str here,
                     const sprout_said_binding *given, parse_answer *out);

/* The words of `way`, an exit that refuses, said by its place to `actor` standing in `here`. */
void parse_refused(const sprout_way *way, sprout_str actor, sprout_str here, parse_answer *out);

/* ---- later.c: a run's items after its first ---- */

/* A turn a reading plans after it: the reading, and the item of a run its turn reads afresh, or NULL. */
typedef struct parse_following {
  parse_reading planned;
  const sprout_reread *reread;
} parse_following;

/*
 * The turns a run's items after its first make, in the order written, `run` being the chosen reading's: each a reading
 * planned now with every other role as the line binds them, the item's role filled by the thing it names best; or,
 * where it names nothing it may fill or ties between things, the line's reading less the item's role and the value
 * roles, with the item's words for its own turn to read afresh. Each thing tried is a step. Kept in `keep`.
 */
sprout_eval_status parse_later_of(sprout_exec *x, const sprout_frame *frame, sprout_str actor, parse_words line,
                                  const parse_run *run, const sprout_str *referents, size_t referent_count,
                                  sprout_arena *keep, parse_following **out, size_t *count);

/* ---- chain.c: `and` or a comma between two commands ---- */

/* Whether `word` begins a command: the first word of a phrase a visitor may type, or a direction where a phrase begins with a way out. */
bool parse_begins_command(const sprout_world *world, sprout_str word);

/*
 * Where `words` may split as two commands, in the order written, into `out` (room for as many as the words): each
 * `and` or comma with a command's words before it and a word beginning one after it.
 */
size_t parse_chain_points(const sprout_world *world, parse_words words, size_t *out);

/* The words before the `and` or comma at `at`, without the commas just before it. */
parse_words parse_command_before(parse_words words, size_t at);

/* The words after the `and` or comma at `at`, up to the next `and` or comma: what a name beginning there would be. */
parse_words parse_stretch_after(parse_words words, size_t at);

/* The command after the `and` or comma at `at`, its words joined by single spaces, in `arena`; NULL where it has no room. */
const char *parse_command_after(sprout_arena *arena, parse_words words, size_t at);

/* ---- planned.c: a reading a line handed its later turn ---- */

/* Whether every thing and way out `reading` binds is among `candidates` and the ways out that lead. */
bool parse_in_reach(const parse_reading *reading, const parse_candidate *candidates, size_t candidate_count,
                    const sprout_way *ways, size_t way_count);

/* `reading`, as a host hands one, as the parser holds it, in `arena`; SPROUT_BAD_INPUT where its verb or a role is not the world's. */
sprout_status parse_handed_reading(const sprout_world *world, sprout_arena *arena, const sprout_reading *reading,
                                   parse_reading *out);

/* ---- again.c: the actor's last reading run again ---- */

/*
 * The visitor's last reading, kept as a store keeps it, run by `actor`, in the turn arena: `*fits` false where it is
 * no longer one its verb takes (the verb or a role gone, a thing gone or no longer of the role's kind, a role it
 * must bind unbound).
 */
sprout_eval_status parse_again_reading(const sprout_frame *frame, const sprout_stored_reading *last, sprout_str actor,
                                       parse_reading *out, bool *fits);

/* ---- item.c: an item of a run read on its own turn ---- */

/* An item read: the readings its words make, or the world's answer to them. */
typedef struct parse_item_read {
  parse_readings readings;   /* one for each thing it names, where it names some it may fill the role with */
  const char *answer;        /* otherwise: `unknown`, `not_here`, `not_carrying` or `cannot` */
  bool given;                /* `not_carrying`'s thing or `cannot`'s reading */
  sprout_said_binding binding;
} parse_item_read;

/*
 * `reread`'s words as the item filling its role of `within`, each value role bound from its words against what the
 * item names, over what the actor can reach and the ways out that apply; every thing named a step and its consent
 * pass asked; in the turn arena.
 */
sprout_eval_status parse_read_item(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                   const parse_reading *within, const sprout_reread *reread, const sprout_way *ways,
                                   size_t way_count, parse_item_read *out);

/* ---- command.c: a line as the command turn reads it ---- */

/* `line` without a trailing `?`, which is read as nothing; a `?` alone is kept, since it is a phrase of `help`. */
sprout_str parse_without_question(sprout_str line);

/* `reading` as a host reads one, in `keep`: its verb or intent by qualified name, its actor, and what it binds in order. */
bool parse_reading_out(sprout_arena *keep, const parse_reading *reading, sprout_reading *out);

/* What a command turn reads of its parse beside what sprout_parse gives a host. */
typedef struct parse_turned {
  sprout_eval_status status; /* FAULTED: what stopped it; the run holds the fault */
  parse_answer said;         /* ANSWERED: the answer, unrendered, its ids and words the turn's */
  parse_reading reading;     /* READING, INTENT: the reading, in the turn's arena */
} parse_turned;

/*
 * The parse a command turn begins with (the spec's The runtime > Turns): `line`, or what a line `handed` the turn, read
 * as sprout_parse reads it, but over the turn's own draft, meter and stream, so its steps and draws are the turn's.
 * What a host reads is taken from `keep`. A call sprout_parse refuses is refused alike, with the words in `out`.
 */
sprout_status parse_command_turn(turn_run *run, const char *visit, sprout_str line, const sprout_handed *handed,
                                 sprout_arena *keep, sprout_parsed *out, parse_turned *turned);

#endif
