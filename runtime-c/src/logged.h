/*
 * A turn's outcome in the JSON forms a host keeps and hands on (the spec's The runtime > Effects, Faults, The
 * log): what it said as the language shapes an effect, its fault, and the entry the log keeps of it, with every
 * effect at debug depth or their count and SHA-256 at play depth. The digest is of the effects as debug depth
 * logs them, every object's keys in code-unit order, so it is the digest a log written by any host would hold.
 * The trees are built in the arena the caller gives; their strings point into the outcome.
 */
#ifndef SPROUT_LOGGED_H
#define SPROUT_LOGGED_H

#include "json.h"

/* What a turn said: as the log keeps each effect (`logged`), or in the language's shape, with where its words were written. */
sprout_json *sprout_logged_effects(sprout_arena *arena, const sprout_outcome *outcome, bool logged);

/* A fault: as the log keeps it (`logged`, with its level), or in the language's shape. */
sprout_json *sprout_logged_fault(sprout_arena *arena, const char *name, sprout_str detail,
                                 const sprout_fault_about *about, bool logged);

/* The entry a write turn leaves in the log, as sprout_log_write describes it, as a tree. */
sprout_status sprout_logged_entry(sprout_arena *arena, const sprout_host *host, const sprout_outcome *outcome,
                                  sprout_log_depth depth, sprout_json **entry);

/* A copy of `node` with every object's members in code-unit order of their names, all the way down. */
sprout_json *sprout_logged_canonical(sprout_arena *arena, const sprout_json *node);

#endif
