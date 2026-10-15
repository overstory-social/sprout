/*
 * The Sprout runtime's public API: what a host hands in and what it gets
 * back (the spec's The host contract and Limits > Runtime budgets).
 *
 * The runtime calls nothing from libc beyond string.h and math.h. Memory,
 * time, the turn's seed, stored bytes and output all come through
 * sprout_host, and every limit is a field of sprout_budgets that the host
 * fills: a limit the host leaves unset is unbounded, and the runtime
 * invents no figure. The spec's table figures are the defaults a host starts
 * from (Limits > Runtime budgets); the host adapter supplies them, so a host
 * that fills nothing runs with no step budget at all.
 */
#ifndef SPROUT_H
#define SPROUT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* What a call came to. Every status has text from sprout_status_text. */
typedef enum sprout_status {
  SPROUT_OK = 0,
  SPROUT_NO_MEMORY,     /* the host's alloc returned nothing */
  SPROUT_BAD_HOST,      /* the host record is missing something the runtime needs */
  SPROUT_BAD_SEED,      /* a seed outside 0 to 2^32 - 1: the host's defect */
  SPROUT_BAD_INPUT,     /* bytes the runtime cannot read */
  SPROUT_FAULT          /* the turn was abandoned; see sprout_outcome.fault */
} sprout_status;

/* One limit: unbounded unless the host sets it. */
typedef struct sprout_limit {
  bool set;
  uint64_t value;
} sprout_limit;

/* Every row of the spec's Runtime budgets table, filled by the host. */
typedef struct sprout_budgets {
  sprout_limit steps;                 /* per turn */
  sprout_limit poll_steps;            /* per poll */
  sprout_limit output;                /* characters per turn, per recipient */
  sprout_limit events;                /* per turn */
  sprout_limit cascade_depth;
  sprout_limit passage_depth;         /* a host must set it (the spec's default is 8): a passage naming itself recurses on the C stack until it faults */
  sprout_limit set_role_objects;
  sprout_limit spawns;                /* per turn */
  sprout_limit shortest_wake_seconds;
  sprout_limit pending_wakes;         /* per object */
  sprout_limit people_per_place;
  sprout_limit extension_effects;     /* per turn */
  sprout_limit nickname_characters;
  sprout_limit wall_clock_ms;         /* the backstop */
  sprout_limit list_elements;         /* the static cap on a list's length */
  sprout_limit instances;             /* live instances the host will store for one world, dormant ones included */
} sprout_budgets;

/* The host's side of the contract. A NULL callback the runtime needs is SPROUT_BAD_HOST. */
typedef struct sprout_host {
  void *ctx;
  /* Memory comes in pages of page_bytes (larger for one big request); a page is released whole. */
  size_t page_bytes;
  void *(*alloc)(void *ctx, size_t bytes);
  void (*release)(void *ctx, void *block, size_t bytes);
  /* Milliseconds elapsed since the host began the turn: the only time a turn sees. */
  uint64_t (*now)(void *ctx);
  /* The seed the host drew for this turn and recorded beside the command. */
  uint64_t (*seed)(void *ctx);
  /* Stored bytes under a key: *bytes and *length are the host's, valid until the next call. */
  bool (*read)(void *ctx, const char *key, const char **bytes, size_t *length);
  bool (*write)(void *ctx, const char *key, const char *bytes, size_t length);
  /* One line of output for one recipient. */
  bool (*emit)(void *ctx, const char *recipient, size_t recipient_length, const char *text,
               size_t text_length);
  sprout_budgets budgets;
  /* Whether each turn's outcome gives its account (`sprout_outcome`'s `ran` and `answer`), which an author's tools read. */
  bool accounts;
} sprout_host;

/* The kinds of turn (the spec's The runtime > Turns, Limits > Runtime budgets). */
typedef enum sprout_turn_kind {
  SPROUT_TURN_COMMAND,
  SPROUT_TURN_TICK,
  SPROUT_TURN_WAKE,
  SPROUT_TURN_MAINTENANCE,
  SPROUT_TURN_POLL,
  SPROUT_TURN_ARRIVAL,
  SPROUT_TURN_DEPARTURE
} sprout_turn_kind;

/* A loaded world: its declarations, held in the load arena. */
typedef struct sprout_world sprout_world;

/* A page arena of the runtime's (arena.h), which a host hands back to it to take a poll's readings from. */
typedef struct sprout_arena sprout_arena;
/* A world's stored state: its instances and visitors. */
typedef struct sprout_state sprout_state;

/* A fault names the budget, the host's figure for it, and the message being run. */
typedef struct sprout_fault {
  const char *budget;
  uint64_t limit;
  uint64_t message; /* the index of the message that exhausted it */
  char text[192];
} sprout_fault;

/* Text for a status: a sentence a host can show. */
const char *sprout_status_text(sprout_status status);

/* Why a load or a read was refused, in a sentence for whoever supplied the bytes. */
typedef struct sprout_refusal {
  char text[320];
} sprout_refusal;

/*
 * Loads a cartridge into a world held in a load arena the host's memory
 * backs. A cartridge that is not one, is damaged, or was made for a format
 * or language level newer than this runtime reads is SPROUT_BAD_INPUT; the
 * host record is copied, so it need not outlive the call.
 */
sprout_status sprout_load(const sprout_host *host, const char *cartridge, size_t length,
                          sprout_world **world);

/* sprout_load, with the words of a refusal written to `refusal` when it is not NULL. */
sprout_status sprout_load_explained(const sprout_host *host, const char *cartridge, size_t length,
                                    sprout_world **world, sprout_refusal *refusal);

/*
 * A load in progress, so a host may read a big cartridge a little at a time
 * across its frames rather than in one call.
 */
typedef struct sprout_loading sprout_loading;

/*
 * Where a load reads a cartridge from, front to back, so the host need never
 * hold it whole: `read` puts its next bytes, up to `bytes` of them, in
 * `buffer` and sets `*got`, which is 0 only at the cartridge's end; false when
 * the host could not read them, which refuses the load in words. It is called
 * from sprout_load_begin and sprout_load_step, and `ctx` must stay valid until
 * the load is finished or abandoned.
 */
typedef struct sprout_source {
  void *ctx;
  bool (*read)(void *ctx, unsigned char *buffer, size_t bytes, size_t *got);
} sprout_source;

/*
 * Begins a load from `source` (copied): the header read and checked as
 * sprout_load checks it, nothing of the body inflated yet. A host holding the
 * cartridge whole loads it with sprout_load_explained.
 */
sprout_status sprout_load_begin(const sprout_host *host, const sprout_source *source, sprout_loading **loading,
                                sprout_refusal *refusal);

/*
 * Reads on: at most `budget` more bytes of the body inflated, the source read
 * as far as they need, and the world built from the body once it is whole;
 * `*done` once the world is ready. Any status but
 * SPROUT_OK has ended the load, freed it, and written `refusal` as
 * sprout_load_explained writes it.
 */
sprout_status sprout_load_step(sprout_loading *loading, size_t budget, bool *done, sprout_refusal *refusal);

/* How far a load is: bytes of the body inflated, of those it has (the preamble's alone for a peek). */
void sprout_load_progress(const sprout_loading *loading, size_t *read, size_t *counted);

/* The world a done load made, and the load freed; NULL (and nothing freed) before it is done. */
sprout_world *sprout_load_finish(sprout_loading *loading);

/* Frees a load part way; nothing of it remains. */
void sprout_load_abandon(sprout_loading *loading);

/*
 * Reads only what a shelf needs of a cartridge: its header and the caps it
 * was checked against, into a world with no graph or catalogue, cheap
 * however large the cartridge. Such a world is read through
 * sprout_world_header and sprout_world_caps and freed as any; it opens
 * nothing.
 */
sprout_status sprout_peek(const sprout_host *host, const char *cartridge, size_t length, sprout_world **world,
                          sprout_refusal *refusal);

/* Whether a world was peeked rather than loaded. */
bool sprout_world_peeked(const sprout_world *world);

/* Releases a world and everything it holds. */
void sprout_world_free(sprout_world *world);

/*
 * A world's stored state (the spec's The runtime > State), read from the JSON
 * the store adapters hold and written back in the same canonical form: keys in
 * the schema's order, no white space, whole numbers as digits. Reading checks
 * the stored form's rules and refuses what a store adapter would, in words;
 * what it keeps is exactly what was stored, so writing a state read gives the
 * bytes back.
 */
sprout_status sprout_state_read(const sprout_host *host, const char *bytes, size_t length,
                                sprout_state **state, sprout_refusal *refusal);

/* A new world's state: nothing stored, serial 0. */
sprout_status sprout_state_empty(const sprout_host *host, const char *world_id,
                                 sprout_state **state);

/* UTF-8 bytes with their length: a stored string may hold any scalar value, so none is a C string. */
typedef struct sprout_str {
  const char *bytes; /* NUL-terminated beyond length */
  size_t length;
} sprout_str;

/* Why a stored value was not kept when a state was opened against a world. */
typedef enum sprout_drop_reason {
  SPROUT_DROP_UNDECLARED,
  SPROUT_DROP_RETYPED,
  SPROUT_DROP_NO_LONGER_FITS
} sprout_drop_reason;

/* One stored value a load did not keep: its property is gone, was retyped, or no longer fits. */
typedef struct sprout_dropped {
  sprout_str id;
  sprout_str property;
  bool has_actor; /* a remembered value is dropped for the actor it was remembered about */
  sprout_str actor;
  sprout_drop_reason why;
} sprout_dropped;

/* What opening a state against a world made of it; the arrays live in the state. */
typedef struct sprout_opened {
  size_t created_count;
  const sprout_str *created; /* declared objects nothing was stored for and none destroyed, in declared order */
  size_t dormant_count;
  const sprout_str *dormant; /* kept untouched because they cannot be decoded now, by id */
  size_t dropped_count;
  const sprout_dropped *dropped;
  size_t stranded_count;
  const sprout_str *stranded; /* actors stored where nothing holds actors: an engine error to report */
} sprout_opened;

/*
 * Reconciles a state with the world it is played in (the spec's The runtime >
 * State): a stored value keeps its place when it still fits the declared type
 * and falls to the default otherwise, what cannot be decoded stays dormant and
 * is saved back as read, declared objects with nothing stored and no tombstone
 * are made, and a destroyed one never is. The state ends sorted as a save
 * writes it; `report` (which may be NULL) says what changed. A store of another
 * world is SPROUT_BAD_INPUT with `refusal` (which may be NULL) filled.
 */
sprout_status sprout_state_open(sprout_state *state, const sprout_world *world, sprout_opened *report,
                                sprout_refusal *refusal);

/* The canonical JSON of a state, built in `scratch` and valid until that arena is reset. */
sprout_status sprout_state_write(const sprout_state *state, sprout_arena *scratch, const char **bytes,
                                 size_t *length);

/*
 * A committed turn writes into the state and leaves what it replaced behind,
 * counted; the state is crowded once that passes a quarter of it. Compacting
 * copies the live records into a fresh arena and releases the old, so the two
 * are held together while it runs: a turn compacts a crowded state once its
 * own scratch is released, and a host may compact sooner, at a quiet moment.
 */
bool sprout_state_crowded(const sprout_state *state);
sprout_status sprout_state_compact(sprout_state *state);

/* Releases a state and everything it holds. */
void sprout_state_free(sprout_state *state);

/*
 * A reading (the spec's Verbs, Parsing > The three roles): a verb, who
 * performs it, and what fills each of its roles, by id. Nothing here is
 * text: a host builds one from the view's chips, and the runtime reads a
 * typed line to one itself. A filling has the fields of the view's filler
 * less the words a visitor reads, and a value role carries the value chosen.
 */
typedef enum sprout_fill {
  SPROUT_FILL_UNBOUND, /* a tool left out; a set role left out is the empty set */
  SPROUT_FILL_OBJECT,
  SPROUT_FILL_SET,
  SPROUT_FILL_EXIT,
  SPROUT_FILL_TEXT,    /* a symbol role's option */
  SPROUT_FILL_NUMBER   /* an integer role's value */
} sprout_fill;

typedef struct sprout_filling {
  const char *role;
  sprout_fill binds;
  const char *id;               /* OBJECT: the thing; EXIT: where it leads */
  size_t id_count;
  const char *const *ids;       /* SET: the things, in the order typed */
  const char *direction;        /* EXIT: NULL for a link */
  const char *label;            /* EXIT */
  const char *text;             /* TEXT */
  double number;                /* NUMBER */
} sprout_filling;

typedef struct sprout_reading {
  const char *verb;  /* by its full identity, `sprout.take` */
  const char *actor; /* the id of the instance performing it */
  size_t filling_count;
  const sprout_filling *fillings; /* in the order the reading binds its roles, which a visitor's last reading keeps */
} sprout_reading;

/* How a reading ended: both passes ran, the consent pass refused, or its actor destroyed itself. */
typedef enum sprout_read_end { SPROUT_READ_ACTED, SPROUT_READ_REFUSED, SPROUT_READ_GONE } sprout_read_end;

/*
 * What a reading came to. `refused` (when the end is SPROUT_READ_REFUSED) is
 * a JSON object naming `by`, the `role` refused in, the `origin` kind that
 * wrote the `permit` (null where the engine refused), the words `said` and
 * the names they render with; `effects` is a JSON array of the lines the
 * turn said, unrendered, in the order said, each with `effect`, `to`, `by`,
 * `speaker`, `said` and `bindings`. Both are in the form corpus/goldens/
 * readings.json holds and live until sprout_reading_outcome_free. On
 * SPROUT_FAULT, `fault` says why and the world is as it was.
 */
typedef struct sprout_reading_outcome {
  sprout_read_end end;
  bool faulted;
  sprout_fault fault;
  const char *refused;
  size_t refused_length;
  const char *effects;
  size_t effects_length;
  void *held;
} sprout_reading_outcome;

/*
 * Runs one reading through the consent pass and then the effect pass
 * against a draft of `state`, drains the queue its bodies filled, and
 * commits the draft: the turn's one write, which a refusal does not make.
 * `instant` is when the turn runs, in host seconds. A reading the world
 * cannot take, an unknown verb or role or thing, or a filling the role
 * does not take, is SPROUT_BAD_INPUT with `fault.text` saying which; a
 * budget exhausted or a rule broken is SPROUT_FAULT, and nothing is
 * written. The seed is the host's, drawn once for the turn.
 */
sprout_status sprout_reading_run(sprout_world *world, sprout_state *state, const sprout_reading *reading,
                                 uint64_t instant, sprout_reading_outcome *outcome);

/* Releases what an outcome holds. */
void sprout_reading_outcome_free(sprout_reading_outcome *outcome);

/*
 * A visitor's view (the spec's The runtime > The view): what a poll gives one visitor standing in a
 * place, as the visitor reads it. Everything a view holds lives until sprout_view_free.
 */
typedef struct sprout_seen_thing {
  sprout_str id;
  sprout_str name; /* its article and name, or a visitor's nickname */
} sprout_seen_thing;

/* One way out that applies: an exit by its direction, a link (direction NULL) by its label. */
typedef struct sprout_seen_exit {
  const char *direction;
  const char *label;
  sprout_str to;
} sprout_seen_exit;

/* One option of a symbol role: the value it binds, and the words a visitor types for it. */
typedef struct sprout_seen_option {
  sprout_str value;
  sprout_str words;
} sprout_seen_option;

typedef struct sprout_seen_range {
  double min, max;
} sprout_seen_range;

/* What a value role can be filled with: a symbol role's options, or an integer role's ranges. */
typedef struct sprout_seen_options {
  const char *role;
  bool symbol;
  size_t option_count;
  const sprout_seen_option *options;
  size_t range_count;
  const sprout_seen_range *ranges;
} sprout_seen_options;

typedef enum sprout_seen_binds {
  SPROUT_SEEN_UNBOUND, /* a value role (its options are beside the reading) or a tool left out */
  SPROUT_SEEN_OBJECT,
  SPROUT_SEEN_SET,
  SPROUT_SEEN_EXIT
} sprout_seen_binds;

/* What fills one role of a reading, as a client offers it. */
typedef struct sprout_seen_filler {
  const char *role;
  sprout_seen_binds binds;
  sprout_seen_thing thing; /* OBJECT */
  size_t member_count;
  const sprout_seen_thing *members; /* SET, one at a time as the view offers them */
  sprout_seen_exit exit;            /* EXIT */
  bool all; /* OBJECT and SET: whether a typed `all` in the role would take the thing, or the set's first */
} sprout_seen_filler;

/* One reading a visitor could make now. */
typedef struct sprout_seen_reading {
  const char *verb; /* by its qualified name, `sprout.take` */
  sprout_str typed; /* the line that types it, each value role's slot written as an ellipsis */
  bool refused;     /* the consent pass refused it, or the engine would: `refusal` says why */
  size_t refusal_count;
  const sprout_str *refusal; /* the refusal, rendered for the visitor, one paragraph each */
  size_t filler_count;
  const sprout_seen_filler *fillers; /* one for each role, in the order the verb declares them */
  size_t options_count;
  const sprout_seen_options *options;
} sprout_seen_reading;

/* What an extension's statement in the place's description recorded into the view. */
typedef struct sprout_seen_effect {
  const char *extension, *statement;
  sprout_str payload;    /* as JSON text; empty where the runtime holds no code for the extension */
  sprout_str transcript; /* the words a client that cannot use the payload reads */
} sprout_seen_effect;

typedef struct sprout_seen_view {
  sprout_seen_thing place; /* the visitor's place, by id and as the visitor reads it; its name is empty where the place is gone */
  size_t description_count;
  const sprout_str *description; /* the place's description as paragraphs; the engine's `unseen` for a poll that faulted */
  size_t effect_count;
  const sprout_seen_effect *effects; /* what the description's extension statements recorded, in order */
  size_t exit_count;
  const sprout_seen_exit *exits;
  size_t occupant_count;
  const sprout_seen_thing *occupants;
  size_t carried_count;
  const sprout_seen_thing *carried;
  size_t reading_count;
  const sprout_seen_reading *readings;
  size_t verb_count;
  const char *const *verbs; /* the verbs that could be offered here, by qualified name, in the order the readings come */
  uint64_t steps;          /* what the poll spent of its budget */
  bool faulted;            /* the poll ran out: the description is `unseen`, the rest is what it derived before */
  sprout_fault fault;
  const char *fault_name;  /* the rule broken, for the host's log: `BudgetExhausted` */
  sprout_str fault_object; /* what the fault is laid against: the object it names, or the visitor's place */
  void *held;
} sprout_seen_view;

/*
 * Polls the view of the visitor under the key `visit` over the committed `state`, under the poll's own
 * step budget in `host`: derives it, renders it with the visitor as its one reader, draws nothing and
 * writes nothing. A poll that spends its budget is SPROUT_OK with `faulted` set. A visit the state does not
 * hold, or one that is away, is SPROUT_BAD_INPUT with `fault.text` saying which.
 */
sprout_status sprout_view(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                          sprout_seen_view *view);

/* Releases what a view holds. */
void sprout_view_free(sprout_seen_view *view);

/*
 * The scene alone: the same poll without the readings, so a host that shows the place and asks for a
 * verb's readings as the visitor reaches it (sprout_readings_for) never runs the offers for every verb at
 * once. `readings` is empty and `verbs` lists what sprout_readings_for may be asked for. Freed as a view.
 */
sprout_status sprout_scene(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           sprout_seen_view *view);

/*
 * The readings of one verb, by its qualified name (`sprout.take`), over the committed `state`, under the
 * poll's own budget: the offers and consent passes for that verb alone, over what is in range. Everything
 * the view holds is taken from `keep`, which the host owns, so there is nothing to free: `held` is NULL and
 * sprout_view_free does nothing. A poll that spends its budget is SPROUT_OK with `faulted` set and no
 * readings. A verb the world does not have, a visit the state does not hold, or one that is away, is
 * SPROUT_BAD_INPUT with `fault.text` saying which.
 */
sprout_status sprout_readings_for(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                                  const char *verb, sprout_arena *keep, sprout_seen_view *view);

/* The engine's `acted` as one reader reads it: its paragraphs, or none and `faulted` where rendering it faulted. */
typedef struct sprout_acted_line {
  size_t paragraph_count;
  const sprout_str *paragraphs;
  bool faulted; /* the rendering spent the poll's budget or broke a rule: there are no paragraphs */
} sprout_acted_line;

/*
 * The engine's `acted` (the spec's Prose > Engine lines; The command line): the line `typed` (`typed_length` bytes
 * of UTF-8) the visitor under the key `actor` typed, as the visitor under `reader` reads it where both play from
 * one console, rendered as a poll renders: over the committed `state`, under the poll's own budget, drawing
 * nothing and writing nothing. Nobody in the world reads it. The paragraphs are taken from `keep`, which the host
 * owns. A visit the state does not hold is SPROUT_BAD_INPUT.
 */
sprout_status sprout_acted(sprout_world *world, sprout_state *state, const sprout_host *host, const char *reader,
                           const char *actor, const char *typed, size_t typed_length, sprout_arena *keep,
                           sprout_acted_line *out);

/*
 * Reading a typed line (the spec's Parsing; The runtime > Turns): what the words a visitor typed make, read as
 * the command turn they begin reads them, over the committed state, under that turn's step budget and with
 * the stream begun from the seed the host draws for it (`seed`), and nothing written. A host previews a line
 * with it, as `sprout parse` does, and `sproutc play --offered` looks for what it reads in the view. A runtime built without the
 * parser (CMake's SPROUT_PARSER, which the Playdate leaves off) reads no typed line: every call is
 * SPROUT_BAD_INPUT.
 */

/* An item of a run read afresh on its own turn: the role it fills and its words, each value role's words as the line typed them, and what the actor's pronouns named when the line began. */
typedef struct sprout_reread_value {
  const char *role;
  const char *words;
} sprout_reread_value;

typedef struct sprout_reread {
  const char *role;
  const char *words;
  size_t value_count;
  const sprout_reread_value *values;
  size_t referent_count;
  const char *const *referents;
} sprout_reread;

/* What a later turn of a line is handed in place of reading its words: the reading planned for it, and the item of a run it re-reads, or NULL. */
typedef struct sprout_handed {
  const sprout_reading *planned;
  const sprout_reread *reread;
} sprout_handed;

/* A turn a line runs after the one that read it: a reading planned for it, with the item it re-reads, or a command of words `and` or a comma joined. */
typedef struct sprout_following {
  const sprout_reading *planned; /* NULL for words */
  const sprout_reread *reread;   /* NULL where nothing is re-read */
  const char *text;              /* words: the command, read on its own turn */
} sprout_following;

/*
 * A line the parser says before the reading's own (the spec's Parsing > Pronouns, Choosing a reading): the world's
 * `pronoun_correction` for a thing a pronoun named, with the pronoun the thing declares, or the engine's `meant`,
 * telling the actor which thing a reading drawn from a tie took the words to name.
 */
typedef struct sprout_aside {
  const char *line;    /* `pronoun_correction` or `meant` */
  const char *thing;   /* the thing it names, by id */
  const char *pronoun; /* pronoun_correction: the pronoun the thing declares */
} sprout_aside;

/* A name a line of the engine's binds: a thing by id, or a value, which an answer only ever binds to words. */
typedef struct sprout_said_binding {
  const char *name;
  bool object;
  sprout_str text; /* the thing's id, or the words */
} sprout_said_binding;

/* How a line ended: understood as a verb's reading or an intent's, answered with a line in place of one, or faulted. */
typedef enum sprout_parse_end {
  SPROUT_PARSED_READING,
  SPROUT_PARSED_INTENT,
  SPROUT_PARSED_ANSWERED,
  SPROUT_PARSED_FAULTED
} sprout_parse_end;

typedef struct sprout_parsed {
  sprout_parse_end end;
  /*
   * READING: the verb's reading, its fillings in the order it binds them, and what is said before it.
   * INTENT: the same, `verb` naming the intent and the fillings its slots.
   */
  sprout_reading reading;
  size_t aside_count;
  const sprout_aside *asides;
  size_t rest_count;
  const sprout_following *rest; /* the turns the line runs after it, in order */
  bool drawn;                   /* drawn from readings that tied */
  uint64_t drawn_among;
  /* ANSWERED: which answer, the line said in place of a reading, who says it and what it binds. */
  const char *answer; /* `cannot`, `not_carrying`, `no_way`, `not_here`, `unknown`, or `refused`: an exit's own words */
  const char *line;   /* the passage's name: an engine line's (`unknown`), or one an exit refuses with */
  const char *words; /* the words where it is said in quotes: the engine's own, where nothing writes the line, or an exit's */
  bool absent;       /* a passage whose prose file the world was loaded without */
  sprout_str by;
  size_t binding_count;
  const sprout_said_binding *bindings;
  /* Every outcome: the bounds drawn below, in order, which begin the turn's stream, and the steps spent. */
  size_t draw_count;
  const uint64_t *draws;
  uint64_t steps;
  /* FAULTED: why, as a turn's fault says it. */
  const char *fault_name;
  sprout_fault fault;
} sprout_parsed;

/*
 * Reads `line` (`length` bytes of UTF-8) as the visitor under the key `visit` typed it, or, with `handed`, a later
 * turn of a line as it was handed. Everything the outcome holds is taken from `keep`, which the host owns. A visit
 * the state does not hold, one that is away, one whose place is gone (the turn displaces them and reads nothing),
 * and a handed reading whose verb or role the world does not have are SPROUT_BAD_INPUT with `fault.text` saying
 * which. The runtime reads a line to the reading the best of its readings makes, a tie drawn, with the turns it runs
 * after it in `rest`: `all`'s readings, a run's later items, each planned or left to read afresh, and the command
 * after an `and` or a comma that splits the line; a pronoun's correction and a draw's `meant` are among its asides.
 * `again` runs the visitor's last reading where it still fits its verb. It answers a line no reading reads:
 * `cannot` or `not_carrying` where a phrase reads it in part, the partial reading a tie drawn; `no_way` or an exit's
 * own words where it names a way that does not go; `not_here` where a noun names nothing in reach but is made of the
 * world's words, a way out written elsewhere is named, an object's synonym names its object out of reach, or `all`
 * leaves nothing; and `unknown` otherwise. A handed turn runs its planned reading where what it binds is still in
 * reach, and `not_here` where it is not; with an item to re-read, it reads the item's words alone, every other role
 * as the line bound it (the spec's Parsing > Sequences, again and all).
 */
sprout_status sprout_parse(sprout_world *world, sprout_state *state, const sprout_host *host, const char *visit,
                           const char *line, size_t length, const sprout_handed *handed, sprout_arena *keep,
                           sprout_parsed *out);

/*
 * Turns (the spec's The runtime > Turns, Effects, The log, Faults; Time; The host contract > Admission and
 * identity, Time, Storage). Every write turn runs in a draft over the last committed state, under a budget
 * of its own and one stream of draws begun from its seed, and either commits or is abandoned, leaving the
 * state exactly as it was. The host runs them one at a time for one world, in the order its clock and its
 * people give: catch-up as a maintenance turn before it admits anyone, then the arrival; a tick for each
 * place that holds a visitor; a wake when one falls due while anyone stands in the world; a reading when
 * a visitor types or chooses one; a departure when one goes away.
 */

/* What a nickname is refused for (the spec's Names > Nicknames). */
typedef enum sprout_nickname_reason {
  SPROUT_NICKNAME_OK,
  SPROUT_NICKNAME_EMPTY,
  SPROUT_NICKNAME_NOT_WORDS,
  SPROUT_NICKNAME_TOO_LONG,
  SPROUT_NICKNAME_SOURCE_SHAPED,
  SPROUT_NICKNAME_WORLD_WORD,
  SPROUT_NICKNAME_RESERVED,
  SPROUT_NICKNAME_HELD
} sprout_nickname_reason;

/* Whether a nickname may be admitted, and where it may not, the words the host shows the person and what it collided on. */
typedef struct sprout_admission {
  sprout_nickname_reason reason;
  sprout_str kept; /* the nickname as the world keeps it: its words, single-spaced */
  sprout_str words;
  size_t collide_count;
  const sprout_str *collides;
  void *held;
} sprout_admission;

/*
 * Checks `nickname` for `visit` against the world's word set and the language's reserved words, the host's
 * length bound and the people present now; moderation is the host's, asked only of a nickname this admits.
 * Two nicknames are one where they are typed alike, which is lower case; someone away holds nothing.
 */
sprout_status sprout_admit(const sprout_world *world, const sprout_state *state, const sprout_host *host,
                           const char *visit, const char *nickname, size_t nickname_length,
                           sprout_admission *admission);

/* Releases what an admission holds. */
void sprout_admission_free(sprout_admission *admission);

/*
 * What the host hands one turn; the seed it draws from is the host's `seed`, drawn once for the turn. A command is
 * one of three: a `reading` the visitor built from the view's chips, run as it is; a typed line in `text`, read in
 * the turn, under its budget and on its stream, before it runs (the spec's The runtime > Turns); or a later turn of
 * a line (sprout_line_next), the reading an earlier turn `planned` with the item of a run it re-reads, if any.
 */
typedef struct sprout_turn_input {
  sprout_turn_kind kind;
  uint64_t instant;              /* when the turn runs, in host seconds */
  const char *visit;             /* ARRIVAL, DEPARTURE, COMMAND: the visit key */
  const char *nickname;          /* ARRIVAL: the nickname sprout_admit admitted */
  size_t nickname_length;
  const sprout_reading *reading; /* COMMAND: a reading built from chips, or NULL */
  const char *text;              /* COMMAND: the words the turn reads where it is handed no reading; the log keeps them */
  size_t text_length;
  const sprout_reading *planned; /* COMMAND: a later turn of a line, the reading an earlier turn planned for it, or NULL */
  const sprout_reread *reread;   /* COMMAND: with `planned`, the item of a run read afresh, or NULL */
  const char *place;             /* TICK: the place ticked, by id */
  const char *object;            /* WAKE: the object woken, by id */
  uint64_t serial;               /* WAKE: the serial the wake was asked under */
} sprout_turn_input;

/* What a turn came to. */
typedef enum sprout_turn_result {
  SPROUT_RESULT_DONE,    /* it ran and committed */
  SPROUT_RESULT_FAULTED, /* it faulted and was abandoned; `fault` says why */
  SPROUT_RESULT_REFUSED, /* an arrival the place's `accept` or the host's bound on a crowd refused: nothing is written */
  SPROUT_RESULT_CLOSED,  /* an arrival to a world that admits no one: nothing ran */
  SPROUT_RESULT_IDLE     /* nothing to run: a tick's place holds no visitor now, or a wake is no longer pending */
} sprout_turn_result;

/* The kinds of line a turn tells (the spec's The runtime > Effects). */
typedef enum sprout_line_kind {
  SPROUT_LINE_SAID,
  SPROUT_LINE_TOLD,
  SPROUT_LINE_REFUSED,
  SPROUT_LINE_DESCRIBED,
  SPROUT_LINE_NOTICE,
  SPROUT_LINE_EXTENSION
} sprout_line_kind;

/* One paragraph a turn told one person (the spec's The runtime > Effects): the reader's visit, and the effect it belongs to. */
typedef struct sprout_line {
  const char *recipient; /* the visit key, NUL-terminated beyond its length */
  size_t recipient_length;
  const char *text; /* UTF-8, NUL-terminated beyond length */
  size_t text_length;
  sprout_line_kind kind;
  size_t effect; /* the index of its effect among the outcome's */
} sprout_line;

/* Where the words of an effect were written: a named passage, or a one-line passage, for an author's tools. */
typedef struct sprout_written {
  bool passage;
  const char *name;   /* a passage: its name */
  const char *origin; /* a passage: the kind that wrote it, qualified */
  const char *at;     /* `file:line:column` */
} sprout_written;

/* One effect a person reads, as the log keeps it: a line a turn said, or a description, rendered for one reader. */
typedef struct sprout_told_effect {
  sprout_line_kind kind;
  sprout_str from; /* the object whose body said it */
  bool has_actor;
  sprout_str actor; /* whose turn said it: the person who typed, arrived or left */
  sprout_str to;    /* the person who reads it */
  sprout_str visit; /* the visit that is them */
  size_t line_first, line_count; /* its paragraphs among the outcome's lines */
  size_t written_count;
  const sprout_written *written; /* every passage and one-line passage that gave it words, each once, a passage after any it holds */
  const char *extension, *statement; /* an extension's effect: the statement that recorded it; NULL for any other */
  sprout_str payload;                /* an extension's effect: its payload as JSON text; empty where the runtime holds no code for the extension */
} sprout_told_effect;

/* Someone a line would have taken past their output: they read nothing more that turn. */
typedef struct sprout_cut {
  const char *recipient; /* their visit */
  size_t recipient_length;
  sprout_str id; /* the instance that is them */
} sprout_cut;

/*
 * What a fault is laid against, beside its name and words (the spec's The runtime > Faults, The log): the
 * object the rule broken names, if it names one; whether nothing the world did explains it, the engine's own
 * defect, which a host reports loudly; and the extension whose code it is, NULL for every other fault.
 */
typedef struct sprout_fault_about {
  bool has_object;
  sprout_str object;
  bool engine;
  const char *extension;
} sprout_fault_about;

/* A wake as a maintenance turn's entry names it, with the fault its part ended in where it faulted. */
typedef struct sprout_logged_wake {
  sprout_str object;
  uint64_t serial;
  uint64_t asked_at;
  const char *fault_name;
  sprout_str fault_detail;
  sprout_fault_about fault_about;
} sprout_logged_wake;

/*
 * The entry a write turn that ran leaves in the log (the spec's The runtime > The log): which kind, the
 * world's last serial once it ended, the seed it drew from, the instant, and whom it was for. What it said
 * is the outcome's effects; this adds what the entry holds beside them.
 */
typedef struct sprout_log_entry {
  sprout_turn_kind kind;
  uint64_t serial;
  uint64_t seed;
  uint64_t seconds;
  sprout_str who;      /* the visit, the place or the object; empty for catch-up */
  sprout_str nickname; /* an arrival: the nickname they came in with */
  sprout_str text;     /* a command: the line typed */
  const sprout_reading *planned; /* a command: the step an earlier turn of the line planned, or NULL */
  const sprout_reread *reread;   /* a command: the item of a run it read afresh, or NULL */
  uint64_t drawn_among;          /* a command: how many readings tied where it was drawn from them; 0 otherwise */
  uint64_t wake_serial;
  bool faulted;
  const char *fault_name;
  sprout_str fault_detail;
  sprout_fault_about fault_about;
  size_t delivered_count, faulted_count, abandoned_count; /* catch-up: the wakes it delivered, consumed after a fault, and left pending */
  const sprout_logged_wake *delivered, *faulted_wakes, *abandoned;
} sprout_log_entry;

/*
 * What a turn changed of the stored state, across every commit it made, as a store writes it (the spec's The
 * host contract > Storage): the world's serial after it, the instance records to write whole, the ids of
 * those to delete, the tombstones to add and the visitor records to write whole, each list in code-unit
 * order. An id written and then removed within the turn is in neither list when the turn made it, and among
 * those removed when it was stored before.
 */
typedef struct sprout_stored_changes {
  uint64_t serial;
  size_t upsert_count, remove_count, tombstone_count, visitor_count;
  const sprout_str *upsert;
  const sprout_str *remove;
  const sprout_str *tombstones;
  const sprout_str *visitors;
} sprout_stored_changes;

/*
 * A handler or hook a turn ran: the kind that wrote it, what it answers (a message by its key, or `changed :p` for
 * a hook), and where it is written, `file:line:column`, which tells two apart.
 */
typedef struct sprout_ran {
  const char *origin;
  const char *on;
  const char *at;
} sprout_ran;

/*
 * What a turn came to. The lines, effects and cuts are the turn's own, in the order told, valid until
 * sprout_outcome_free; a faulted turn tells nothing but what the world says of the fault to the one who
 * typed. `committed` is that the turn's own draft was committed; `state_changed` that the stored state is
 * not what it was, which a faulted wake (its consumption) and a faulted departure (the visitor gone
 * quietly) also do. `words` is what a host tells a person outside the world of an arrival that was
 * closed or faulted.
 *
 * Where the turn committed or changed the stored state, `changes` is what a store writes of it; empty
 * otherwise. Where it committed, `stale` is every visit present once it is over, in code-unit order: their
 * views are stale (the spec's The view). A turn that faulted names nobody, a faulted wake's consumption
 * and a faulted departure's quiet going included.
 *
 * A command also says what became of its line (the spec's Parsing > Sequences, again and all; Intents): whether
 * no reading ran, the parser having answered or an intent having planned no step; how many readings tied where
 * the one run was drawn from them; the reading it ran as a step of a line of several, an intent's, `all`'s or a
 * run's, which a host logs at info; the turns the line runs after it, in order; and whether the line goes on.
 *
 * Its account, for an author's tools that ask what a playthrough reached, is given where the host `accounts`:
 * `ran`, every handler and hook the turn's commits ran, in the order run, and, for a command the parser answered,
 * `answer`, its line's passage name or its words. `refused` is that the consent pass refused a command's reading,
 * told apart from a body's refusal, and is given whatever the host asks.
 */
typedef struct sprout_outcome {
  sprout_turn_result result;
  bool committed;
  bool state_changed;
  bool faulted;
  sprout_fault fault;
  const char *fault_name;
  sprout_fault_about fault_about;
  const char *words;
  size_t line_count;
  const sprout_line *lines;
  size_t effect_count;
  const sprout_told_effect *effects;
  size_t cut_count;
  const sprout_cut *cuts;
  bool has_log;
  sprout_log_entry log;
  uint64_t elapsed; /* a tick or a wake: the seconds its object was handed as `elapsed` */
  bool has_changes;
  sprout_stored_changes changes;
  size_t stale_count;
  const sprout_str *stale;
  bool answered;
  uint64_t drawn_among; /* 0 where the reading was not drawn */
  const sprout_reading *step;
  size_t next_count;
  const sprout_following *next;
  bool goes_on;
  bool refused;
  size_t ran_count;
  const sprout_ran *ran;
  const char *answer;
  void *held;
} sprout_outcome;

/*
 * Runs one write turn of `input->kind` over the committed `state` at `input->instant`, drawing from the seed and
 * charging the budgets `host` gives (the spec's Host contract > Storage and Time). SPROUT_OK is that the turn ran or
 * had nothing to run; a fault is SPROUT_OK with `faulted` set and its draft dropped, so the state is as it was but
 * for a faulted departure, which still takes the visitor out, and a faulted wake, which is consumed (`state_changed`
 * says whether it is). A call the host should not have made, a visit not in the world, an instant before a wake is
 * due or a tick's last, is SPROUT_BAD_INPUT with the words in `outcome->fault.text`, and nothing is written.
 */
sprout_status sprout_run_turn(sprout_world *world, sprout_state *state, const sprout_host *host,
                              const sprout_turn_input *input, sprout_outcome *outcome);

/* Releases what an outcome holds. */
void sprout_outcome_free(sprout_outcome *outcome);

/*
 * A line a visitor typed, as the command turns it runs (the spec's Parsing > Sequences, again and all; Intents):
 * split at each `.` and each word `then` into commands, each its own turn, and each command's turn followed by the
 * turns it planned, in order, a command `and` or a comma joined run with the turns it plans in turn. A turn that
 * does not let the line go on ends it, and what ran before stays done. The host runs each turn the line hands it,
 * with a seed of its own, and hands back what it came to. Everything the line holds is taken from `keep`.
 */
typedef struct sprout_commands {
  sprout_arena *keep;
  const char *visit;
  size_t part_count, part_at;
  const sprout_str *parts; /* the line's commands */
  size_t depth, room;
  void *frames; /* the commands under way, the innermost last */
  bool waiting; /* a turn was handed out, and what it came to is the next call's */
} sprout_commands;

/* Begins `text` (`length` bytes of UTF-8), typed by the visitor under `visit`. */
sprout_status sprout_line_begin(sprout_commands *line, sprout_arena *keep, const char *visit, const char *text,
                                size_t length);

/*
 * The next turn of the line, written into `input` (its kind, visit, words and what it was planned; the instant is
 * the host's), `*more` false once the line is over. `last` is what the turn the call before handed out came to,
 * and NULL on the first call; a turn the host could not run (anything but SPROUT_OK) ends the line.
 */
sprout_status sprout_line_next(sprout_commands *line, const sprout_outcome *last, sprout_turn_input *input, bool *more);

/*
 * A turn's stored changes as the JSON a store writes, `{serial, upsert, remove, tombstones, visitors}`, each
 * record written whole in its stored form and read from `state`, which must be as the turn left it. Built in
 * `scratch`, and valid until that arena is reset.
 */
sprout_status sprout_changes_write(const sprout_state *state, const sprout_stored_changes *changes,
                                   sprout_arena *scratch, const char **bytes, size_t *length);

/* How much of a turn the log keeps (the spec's The runtime > The log): every effect, or how many and their digest. */
typedef enum sprout_log_depth { SPROUT_LOG_PLAY, SPROUT_LOG_DEBUG } sprout_log_depth;

/*
 * The entry a write turn leaves in the log, as the JSON a host's log keeps it (the spec's The runtime > The
 * log): the turn's inputs, the budgets `host` gave it, what it was for, its fault, who it cut short, and, at
 * debug depth, every effect, or at play depth how many and the SHA-256 of them; a command's also keeps the
 * step a line planned for it, the item it re-read, and the draw its reading was. Built in `scratch`. An
 * outcome with no entry, and a row of the budgets the log keeps that `host` leaves unset, are
 * SPROUT_BAD_INPUT and SPROUT_BAD_HOST.
 */
sprout_status sprout_log_write(const sprout_host *host, const sprout_outcome *outcome, sprout_log_depth depth,
                               sprout_arena *scratch, const char **bytes, size_t *length);

/*
 * What a turn said, as a JSON array in the language's shape of an effect: `kind`, `from`, `actor`, `to`,
 * `visit`, `paragraphs` and `written`, and for an extension's, `extension`, `statement` and `payload`.
 * Built in `scratch`.
 */
sprout_status sprout_effects_write(const sprout_outcome *outcome, sprout_arena *scratch, const char **bytes,
                                   size_t *length);

/* The ids of every place a visitor stands in, once each in code-unit order: the places a host ticks. */
typedef struct sprout_places {
  size_t count;
  const sprout_str *ids;
  void *held;
} sprout_places;

sprout_status sprout_places_occupied(const sprout_world *world, const sprout_state *state, const sprout_host *host,
                                     sprout_places *places);

void sprout_places_free(sprout_places *places);

/* One pending wake and the object that asked for it. */
typedef struct sprout_due_wake {
  sprout_str object;
  uint64_t serial;
  uint64_t asked_at;
  uint64_t due_at;
} sprout_due_wake;

typedef struct sprout_wakes {
  size_t count;
  const sprout_due_wake *wakes;
  void *held;
} sprout_wakes;

/*
 * Every wake due at `until` or before, oldest first (by when it fell due, then the serial it was asked under,
 * then the object), on an object in the tree: a wake on something carried away waits until it is back.
 */
sprout_status sprout_wakes_due(const sprout_world *world, const sprout_state *state, const sprout_host *host,
                               uint64_t until, sprout_wakes *wakes);

void sprout_wakes_free(sprout_wakes *wakes);

/*
 * How the world's body writes `id`: its path under the world for a declared object, and the id itself for
 * anything minted. This is what a host makes a tick's or a wake's seed from (seeds.h), and how it names an object in
 * its own log.
 */
sprout_str sprout_path_of(const sprout_world *world, sprout_str id);
#endif
