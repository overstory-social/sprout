/*
 * What the engine adds to the lines a turn's bodies said (the spec's Verbs > Engine verbs; Movement
 * and consent > After the move; The runtime > Effects). A person who moved between places reads the
 * place they arrived in, derived once the queue is empty and read where the body that moved them
 * ended; one who typed `look`, `examine`, `inventory`, `wait` or `help` reads the engine's answer after
 * everything the queue said. Both are carried unrendered among the turn's lines, in the order the
 * reader reads them.
 */
#ifndef SPROUT_ANSWERS_H
#define SPROUT_ANSWERS_H

#include "describe.h"
#include "reading/reading.h"

/* A description a move owed, and how many of the turn's lines are said before it is read. */
typedef struct sprout_arrived {
  size_t after;
  sprout_effect effect;
} sprout_arrived;

/*
 * The place each person a move carried between places arrived in, as they read it: once for each place
 * and only where they still stand there, since a later move's arrival stands in for an earlier one's;
 * each placed where the last move that owed it was, in order. Each description is a step like any other.
 */
sprout_eval_status sprout_arrivals_read(sprout_exec *x, const sprout_frame *frame, const sprout_arrived **out,
                                        size_t *count);

/*
 * What the engine answers a person's reading, once the queue is empty: nothing for any reading but
 * `look`, `examine`, `inventory`, `wait` and `help`, and nothing for an NPC.
 */
sprout_eval_status sprout_engine_answers(sprout_exec *x, const sprout_frame *frame, const sprout_resolved *reading,
                                         const sprout_effect **out, size_t *count);

/*
 * The turn's lines as the person reads them: `before`, then what the exec recorded with each arrival read
 * where its `after` falls among them, then `later`. The exec's lines are replaced by the result, which is
 * what rendering reads.
 */
sprout_eval_status sprout_lines_assembled(sprout_exec *x, const sprout_effect *before, size_t before_count,
                                          const sprout_arrived *arrived, size_t arrived_count,
                                          const sprout_effect *later, size_t later_count);

#endif
