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

/* The canonical JSON of a state, in an arena the state owns and valid until the state is freed. */
sprout_status sprout_state_write(sprout_state *state, const char **bytes, size_t *length);

/* Releases a state and everything it holds. */
void sprout_state_free(sprout_state *state);

/*
 * A reading (the spec's Verbs, Parsing > The three roles): a verb, who
 * performs it, and what fills each of its roles, by id. Nothing here is
 * text: whoever submits it has already read a typed line, or built a reading
 * from the view's chips. A filling has the fields of the view's filler less
 * the words a visitor reads, and a value role carries the value chosen.
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
  const sprout_filling *fillings;
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

typedef struct sprout_seen_view {
  size_t description_count;
  const sprout_str *description; /* the place's description as paragraphs; the engine's `unseen` for a poll that faulted */
  size_t exit_count;
  const sprout_seen_exit *exits;
  size_t occupant_count;
  const sprout_seen_thing *occupants;
  size_t carried_count;
  const sprout_seen_thing *carried;
  size_t reading_count;
  const sprout_seen_reading *readings;
  uint64_t steps;          /* what the poll spent of its budget */
  bool faulted;            /* the poll ran out: the description is `unseen`, the rest is what it derived before */
  sprout_fault fault;
  const char *fault_name;  /* the rule broken, for the host's log: `BudgetExhausted` */
  sprout_str fault_object; /* the visitor's place, which the fault is laid against */
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

/* What the host hands one turn; the seed it draws from is the host's `seed`, drawn once for the turn. */
typedef struct sprout_turn_input {
  sprout_turn_kind kind;
  uint64_t instant;              /* when the turn runs, in host seconds */
  const char *visit;             /* ARRIVAL, DEPARTURE, COMMAND: the visit key */
  const char *nickname;          /* ARRIVAL: the nickname sprout_admit admitted */
  size_t nickname_length;
  const sprout_reading *reading; /* COMMAND: what the visitor typed or chose, read */
  const char *text;              /* COMMAND: the typed line, which the log keeps (may be NULL) */
  size_t text_length;
  const char *place;             /* TICK: the place ticked, by id; its turn is seeded from the host's seed and the place's path */
  const char *object;            /* WAKE: the object woken, by id */
  uint64_t serial;               /* WAKE: the serial the wake was asked under */
  uint64_t nth;                  /* WAKE: how many times this object has woken in this step of time, from 0 */
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
} sprout_told_effect;

/* A visit a line would have taken past their output: they read nothing more that turn. */
typedef struct sprout_cut {
  const char *recipient;
  size_t recipient_length;
} sprout_cut;

/* A wake as a maintenance turn's entry names it, with the fault its part ended in where it faulted. */
typedef struct sprout_logged_wake {
  sprout_str object;
  uint64_t serial;
  uint64_t asked_at;
  const char *fault_name;
  sprout_str fault_detail;
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
  uint64_t wake_serial;
  bool faulted;
  const char *fault_name;
  sprout_str fault_detail;
  size_t delivered_count, faulted_count, abandoned_count; /* catch-up: the wakes it delivered, consumed after a fault, and left pending */
  const sprout_logged_wake *delivered, *faulted_wakes, *abandoned;
} sprout_log_entry;

/*
 * What a turn came to. The lines, effects and cuts are the turn's own, in the order told, valid until
 * sprout_outcome_free; a faulted turn tells nothing but what the world says of the fault to the one who
 * typed. `committed` is that the turn's own draft was committed; `state_changed` that the stored state is
 * not what it was, which a faulted wake (its consumption) and a faulted departure (the visitor gone
 * quietly) also do. `words` is what a host tells a person outside the world of an arrival that was
 * closed or faulted.
 */
typedef struct sprout_outcome {
  sprout_turn_result result;
  bool committed;
  bool state_changed;
  bool faulted;
  sprout_fault fault;
  const char *fault_name;
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
  void *held;
} sprout_outcome;

/*
 * Runs one write turn of `input->kind` over the committed `state` at `input->instant`, drawing from the seed
 * `host` gives and charging the budgets `host` holds. SPROUT_OK is that the turn ran, or had nothing to run,
 * and the outcome says which; a fault is SPROUT_OK with `faulted` set and the state as it was. A call the host
 * should not have made, a visit not in the world, an instant before a wake is due or a tick's last, is
 * SPROUT_BAD_INPUT with the words in `outcome->fault.text`, and nothing is written.
 */
sprout_status sprout_run_turn(sprout_world *world, sprout_state *state, const sprout_host *host,
                              const sprout_turn_input *input, sprout_outcome *outcome);

/* Releases what an outcome holds. */
void sprout_outcome_free(sprout_outcome *outcome);

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
 * anything minted. This is what a tick's or a wake's seed is made from, and how a host names an object in its own log.
 */
sprout_str sprout_path_of(const sprout_world *world, sprout_str id);
#endif
