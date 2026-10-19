/*
 * What the specs of the unseen share (the spec's Range > Unseen): the corpus world `unseen` with Marta arrived in
 * the hall, a command turn opened over it and never committed, its frame with Marta as `self`, and a way to write
 * `:unseen` in the turn's draft as an object's own `self.set` would.
 */
#ifndef SPROUT_TEST_UNSEEN_FIXTURE_H
#define SPROUT_TEST_UNSEEN_FIXTURE_H

#include "turn_fixture.h"

#include "exec.h"

typedef struct unseen_bench {
  turn_world w;
  turn_run run;
  sprout_frame frame;
  sprout_str marta;
} unseen_bench;

static inline sprout_str unseen_str(const char *text) { return (sprout_str){text, strlen(text)}; }

static inline void unseen_open(unseen_bench *b) {
  sprout_outcome arrived;
  memset(b, 0, sizeof *b);
  tw_open(&b->w, "unseen");
  tw_arrive(&b->w, "v-marta", "Marta", 1000, &arrived);
  sprout_outcome_free(&arrived);
  b->marta = unseen_str(tw_person(&b->w, "v-marta"));
  if (turn_open(&b->run, b->w.world, b->w.state, &b->w.host, SPROUT_TURN_COMMAND, 7, 0, NULL, NULL) != SPROUT_OK) {
    fprintf(stderr, "the unseen bench's turn would not open\n");
    exit(2);
  }
  b->frame = sprout_exec_frame(&b->run.x, b->marta, NULL, NULL);
}

/* Writes `:unseen` on `id` in `draft`, the record's other properties kept. */
static inline void unseen_write(sprout_draft *draft, sprout_arena *turn, const char *id, bool unseen) {
  const sprout_stored_instance *was = sprout_draft_instance(draft, unseen_str(id));
  sprout_stored_instance next;
  sprout_stored_property *properties;
  size_t i, n = 0;
  if (was == NULL) exit(2);
  next = *was;
  properties = (sprout_stored_property *)sprout_arena_take(turn, (was->property_count + 1) * sizeof *properties);
  if (properties == NULL) exit(2);
  for (i = 0; i < was->property_count; i++)
    if (!sprout_str_same(was->properties[i].name, unseen_str("unseen"))) properties[n++] = was->properties[i];
  memset(&properties[n], 0, sizeof properties[n]);
  properties[n].name = unseen_str("unseen");
  properties[n].value.kind = SPROUT_BOOL;
  properties[n].value.boolean = unseen;
  next.properties = properties;
  next.property_count = n + 1;
  if (sprout_draft_write(draft, &next) != SPROUT_DRAFT_OK) exit(2);
}

static inline void unseen_set(unseen_bench *b, const char *id, bool unseen) {
  unseen_write(&b->run.draft, b->frame.turn, id, unseen);
}

static inline void unseen_close(unseen_bench *b) {
  turn_drop(&b->run);
  tw_close(&b->w);
}

#endif
