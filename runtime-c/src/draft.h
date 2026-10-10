/*
 * One write turn's changes to a world's state (the spec's The runtime >
 * Turns, State; Spawning; Destroying). A draft reads through to the state it
 * was opened on and holds only what the turn changed, in the turn arena, so
 * dropping it (resetting the turn arena) leaves that state exactly as it was
 * and a poll reading the committed state sees none of it. Committing copies
 * the changed records into the state's own arena and says what changed.
 *
 * Two rules a store relies on. Every serial a draft issues follows the
 * state's own, so two drafts opened on one state mint the same ids; and a
 * serial is issued once, so a destroyed instance's id is never minted again.
 * A declared object among what is removed is tombstoned, gone for good (the
 * spec's Destroying).
 */
#ifndef SPROUT_DRAFT_H
#define SPROUT_DRAFT_H

#include "state.h"

typedef enum sprout_draft_result {
  SPROUT_DRAFT_OK,
  SPROUT_DRAFT_NO_MEMORY,
  SPROUT_DRAFT_CLOSED,       /* the turn has committed */
  SPROUT_DRAFT_MISSING,      /* not an instance in this world */
  SPROUT_DRAFT_TAKEN,        /* an id is never reused */
  SPROUT_DRAFT_CYCLE,        /* nothing goes inside itself */
  SPROUT_DRAFT_THE_WORLD,    /* the world has no container, and is never destroyed */
  SPROUT_DRAFT_NOT_A_VISITOR,/* only a visitor goes away from the tree */
  SPROUT_DRAFT_NO_ARRIVAL,   /* a contained instance arrives where it is put */
  SPROUT_DRAFT_MOVED         /* where an instance is changes only through place */
} sprout_draft_result;

/* A sentence for a result. */
const char *sprout_draft_text(sprout_draft_result result);

typedef struct sprout_draft {
  sprout_arena *turn;
  const sprout_world *world;
  sprout_state *base;
  uint64_t serial;
  size_t stored; /* the instances the world stores now */
  size_t written_count, written_capacity;
  sprout_stored_instance *written;
  size_t gone_count, gone_capacity;
  sprout_str *gone; /* ids removed this turn */
  size_t buried_count, buried_capacity;
  sprout_str *buried;
  size_t visitor_count, visitor_capacity;
  sprout_stored_visitor *visitors;
  bool committed;
} sprout_draft;

/* What one committed turn changed, by id: what a store upserts and deletes, each list in code-unit order. */
typedef struct sprout_changes {
  uint64_t serial;
  size_t written_count, removed_count, tombstoned_count, visitor_count;
  const sprout_str *written; /* instances written or added, and still there at the end */
  const sprout_str *removed; /* instances there before the turn and removed by it */
  const sprout_str *tombstoned;
  const sprout_str *visitors;
} sprout_changes;

/* Opens a draft over `base`, whose scratch lives in `turn`. */
sprout_draft_result sprout_draft_open(sprout_draft *draft, sprout_arena *turn, const sprout_world *world,
                                      sprout_state *base);

/* How many instances the world stores now: what the host's bound on live instances counts. */
size_t sprout_draft_held(const sprout_draft *draft);

/* Any record under this id as the turn stands, a dormant one included, or NULL (removed this turn, or never there). */
const sprout_stored_instance *sprout_draft_record(const sprout_draft *draft, sprout_str id);

/* The decoded instance under this id as the turn stands, or NULL: a dormant record is not one. */
const sprout_stored_instance *sprout_draft_instance(const sprout_draft *draft, sprout_str id);

/* The visitor record under this visit as the turn stands, or NULL. */
const sprout_stored_visitor *sprout_draft_visitor(const sprout_draft *draft, sprout_str visit);

/* Whether `id` is a declared object destroyed, this turn or before. */
bool sprout_draft_tombstoned(const sprout_draft *draft, sprout_str id);

/*
 * What `id` holds among decoded instances, in contents order: a declared
 * object still where it was declared before anything that arrived, and among
 * those by rank; what arrived by arrival. The ids are in the turn arena.
 */
sprout_draft_result sprout_draft_children(const sprout_draft *draft, sprout_str id,
                                          const sprout_str **ids, size_t *count);

/* The world's next serial: one counter for minted ids, arrivals and wakes. */
sprout_draft_result sprout_draft_next_serial(sprout_draft *draft, uint64_t *serial);

/* A new id, never issued before: `world#serial`. */
sprout_draft_result sprout_draft_mint(sprout_draft *draft, sprout_str *id);

/* Replaces an instance's record. Where it is, and when it arrived, change only through place. */
sprout_draft_result sprout_draft_write(sprout_draft *draft, const sprout_stored_instance *next);

/*
 * Moves an instance into `container`, last in its contents order under a new
 * arrival serial, or out of the tree (container NULL) for a visitor going
 * away, which keeps the serial it last arrived under.
 */
sprout_draft_result sprout_draft_place(sprout_draft *draft, sprout_str id, const sprout_str *container);

/* A spawn or a visitor, new to the world: its id is one no instance has had. */
sprout_draft_result sprout_draft_add(sprout_draft *draft, const sprout_stored_instance *created);

/*
 * Removes `id` and everything inside it, dormant records included, and says
 * what was removed in the order the removal visited them. Each declared
 * object removed is tombstoned. The world is never removed.
 */
sprout_draft_result sprout_draft_remove(sprout_draft *draft, sprout_str id, const sprout_str **removed,
                                        size_t *count);

/* Replaces or adds a visitor's record. */
sprout_draft_result sprout_draft_put_visitor(sprout_draft *draft, const sprout_stored_visitor *record);

/*
 * Applies the turn to the state it was opened on: the changed records are
 * copied into the state's arena and the state ends sorted, as a save writes
 * it. A draft commits once; `changes` is in the turn arena.
 */
sprout_draft_result sprout_draft_commit(sprout_draft *draft, sprout_changes *changes);

#endif
