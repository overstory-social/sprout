/*
 * A world's stored state (the spec's The runtime > State, and The host
 * contract > Storage): the instances, visitors and tombstones as the JSON the
 * store adapters hold them, with every value carrying the type key it was
 * written under. A state owns an arena; what it holds is exactly what was
 * stored, in the order stored, until it is opened against a world (state.c),
 * which reconciles it with the catalogue the way load does, or a draft's
 * commit replaces records.
 */
#ifndef SPROUT_STATE_H
#define SPROUT_STATE_H

#include "world.h"

/* A value as JSON holds it: a list is an array, an extension's value the text it persists as. */
typedef struct sprout_stored_value {
  sprout_kind kind;
  bool boolean;
  double number;
  sprout_str string;
  size_t count;
  struct sprout_stored_value *items;
} sprout_stored_value;

/* A value with the type key it was written under, so a retyped property is never reinterpreted. */
typedef struct sprout_stored_property {
  sprout_str name;
  sprout_str type;
  sprout_stored_value value;
} sprout_stored_property;

typedef struct sprout_stored_memory {
  sprout_str actor;
  size_t count;
  sprout_stored_property *properties;
} sprout_stored_memory;

typedef struct sprout_stored_link {
  sprout_str name;
  sprout_str to;
} sprout_stored_link;

/* One pending wake: the serial it was asked under, and when it was asked and is due, in host seconds. */
typedef struct sprout_stored_wake {
  uint64_t serial, asked_at, due_at;
} sprout_stored_wake;

typedef enum sprout_made_from {
  SPROUT_MADE_WORLD,
  SPROUT_MADE_DECLARED,
  SPROUT_MADE_VISITOR,
  SPROUT_MADE_SPAWNED,
  SPROUT_MADE_GIVEN
} sprout_made_from;

typedef struct sprout_stored_instance {
  sprout_str id;
  sprout_made_from made;
  sprout_str made_kind; /* spawned and given */
  size_t path_count;
  sprout_str *path; /* given: the path in the kind's body */
  bool has_container;
  sprout_str container;
  bool has_arrival;
  uint64_t arrival;
  size_t property_count;
  sprout_stored_property *properties;
  size_t link_count;
  sprout_stored_link *links;
  size_t wake_count;
  sprout_stored_wake *wakes;
  size_t memory_count;
  sprout_stored_memory *memory;
  bool has_last_tick;
  uint64_t last_tick;
  /* Set by opening a state against a world: whether the catalogue can decode it now, and under what kind. */
  bool dormant;
  const sprout_kind_def *kind;
} sprout_stored_instance;

typedef enum sprout_bound_kind {
  SPROUT_BOUND_OBJECT,
  SPROUT_BOUND_SET,
  SPROUT_BOUND_VALUE,
  SPROUT_BOUND_EXIT
} sprout_bound_kind;

/* What one role of a stored reading is filled with: a thing, a set, a value, or a way out. */
typedef struct sprout_stored_bound {
  sprout_bound_kind kind;
  sprout_str object;
  size_t set_count;
  sprout_str *set;
  bool value_is_string;
  sprout_str value_string;
  double value_number;
  bool has_direction;
  sprout_str direction;
  sprout_str label;
  sprout_str to;
} sprout_stored_bound;

typedef struct sprout_stored_binding {
  sprout_str role;
  sprout_stored_bound bound;
} sprout_stored_binding;

/* A reading as a store keeps it: its verb by library and name, and what fills each role. */
typedef struct sprout_stored_reading {
  sprout_str library, name;
  size_t binding_count;
  sprout_stored_binding *bindings;
} sprout_stored_reading;

typedef struct sprout_stored_visitor {
  sprout_str visit, nickname, instance;
  bool has_last_place;
  sprout_str last_place;
  size_t referent_count;
  sprout_str *referents;
  bool has_reading;
  sprout_stored_reading reading;
} sprout_stored_visitor;

struct sprout_state {
  sprout_host host;
  sprout_arena anchor; /* holds this struct and nothing else, so `arena` can be rebuilt without moving it */
  sprout_arena arena;  /* everything the state holds; a commit copies the live records into a new one and releases this */
  sprout_str world;
  uint64_t serial; /* the last serial issued, 0 before the first */
  size_t instance_count;
  sprout_stored_instance *instances;
  size_t visitor_count;
  sprout_stored_visitor *visitors;
  size_t tombstone_count;
  sprout_str *tombstones;
  bool instances_sorted, visitors_sorted, tombstones_sorted; /* by id, visit and id: lookups then bisect */
};

/* Whether two stored strings are the same. */
bool sprout_str_same(sprout_str a, sprout_str b);
bool sprout_str_is(sprout_str a, const char *text);
/* Code-unit order, which is the same on every host: how stored state is sorted. */
int sprout_str_compare(sprout_str a, sprout_str b);
/* A copy in the state's arena; length 0 and NULL bytes only when the host refuses a page. */
bool sprout_state_copy_str(sprout_arena *arena, sprout_str from, sprout_str *to);

/* The shape of an id under a world (the spec's State: ids). */
typedef enum sprout_id_form { SPROUT_ID_NONE, SPROUT_ID_WORLD, SPROUT_ID_DECLARED, SPROUT_ID_MINTED } sprout_id_form;
sprout_id_form sprout_id_form_of(sprout_str world, sprout_str id);

/* A deep copy of a record into `arena`: every string, list and map is the arena's own. */
sprout_status sprout_stored_instance_copy(sprout_arena *arena, const sprout_stored_instance *from,
                                          sprout_stored_instance *to);
sprout_status sprout_stored_visitor_copy(sprout_arena *arena, const sprout_stored_visitor *from,
                                         sprout_stored_visitor *to);
/* Orders a record's properties, links and memory by key, as a save writes them. */
sprout_status sprout_stored_instance_order(sprout_arena *arena, sprout_stored_instance *in);

/* The instance stored under this id, or NULL. */
sprout_stored_instance *sprout_state_find(const sprout_state *state, sprout_str id);
/* The visitor stored under this visit, or NULL. */
sprout_stored_visitor *sprout_state_find_visitor(const sprout_state *state, sprout_str visit);
bool sprout_state_tombstoned(const sprout_state *state, sprout_str id);

/* Orders instances by id, visitors by visit and tombstones by code unit, as a save writes them; lookups then bisect. */
sprout_status sprout_state_sort(sprout_state *state);

/*
 * Reads the stored form's shape without its cross-checks: the first half of
 * sprout_state_read, which a spec uses to hand sprout_state_check a store
 * that is well formed and inconsistent.
 */
sprout_status sprout_state_read_shape(const sprout_host *host, const char *bytes, size_t length,
                                      sprout_state **state, sprout_refusal *refusal);

/* The sentence a refusal of the stored form is written as, to `refusal` when it is not NULL. */
sprout_status sprout_stored_refuse(sprout_refusal *refusal, const char *path, const char *what,
                                   const char *a, const char *b);

/*
 * The cross-checks of a stored world (the stored form's schema): every id is
 * one of the world's forms and agrees with how its instance was made, no
 * serial is past the world's, no id or visit is stored twice, visitor records
 * and the instances made for visitors pair one to one, and a tombstone is a
 * declared id that no instance is stored under or inside.
 */
sprout_status sprout_state_check(const sprout_state *state, sprout_refusal *refusal);

#endif
