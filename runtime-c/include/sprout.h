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
  SPROUT_NOT_YET,       /* the call is declared and its body has not landed */
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
  sprout_limit passage_depth;
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

/* The kinds of turn (the spec's Runtime budgets). */
typedef enum sprout_turn_kind {
  SPROUT_TURN_COMMAND,
  SPROUT_TURN_TICK,
  SPROUT_TURN_WAKE,
  SPROUT_TURN_MAINTENANCE,
  SPROUT_TURN_POLL
} sprout_turn_kind;

/* A loaded world: its declarations, held in the load arena. */
typedef struct sprout_world sprout_world;
/* A world's stored state: its instances and visitors. */
typedef struct sprout_state sprout_state;

typedef struct sprout_turn {
  sprout_turn_kind kind;
  const char *visitor; /* who acted, or NULL for a tick or a wake */
  const char *command; /* the typed command, for SPROUT_TURN_COMMAND */
  size_t command_length;
} sprout_turn;

/* A fault names the budget, the host's figure for it, and the message being run. */
typedef struct sprout_fault {
  const char *budget;
  uint64_t limit;
  uint64_t message; /* the index of the message that exhausted it */
  char text[192];
} sprout_fault;

typedef struct sprout_outcome {
  bool faulted;
  sprout_fault fault;
} sprout_outcome;

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

/* Runs one turn. Declared here; the body lands with the engine and returns SPROUT_NOT_YET. */
sprout_status sprout_run_turn(sprout_world *world, sprout_state *state, const sprout_turn *turn,
                              sprout_outcome *outcome);

#endif
