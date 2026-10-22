/*
 * What the specs of one thing in several places share (the spec's The world model > One thing in several places):
 * the corpus world `several-places`, whose door stands in the tiny room and the dreary room and whose four walls
 * stand in each of the bank's four rooms, with Wren in the tiny room and Ash in the dreary room, and a turn's draft,
 * runner and frame opened over it, as a body's run has them.
 */
#ifndef SPROUT_TEST_SEVERAL_FIXTURE_H
#define SPROUT_TEST_SEVERAL_FIXTURE_H

#include "exec_fixture.h"
#include "expr/expr.h"
#include "turn_fixture.h"

#define SEVERAL_TINY "several_places.tiny_room"
#define SEVERAL_DREARY "several_places.dreary_room"
#define SEVERAL_DOOR "several_places.tiny_room.pdoor"
#define SEVERAL_EAST_WALL "several_places.west_teller.east_wall"

typedef struct several {
  turn_world w;
  char wren[64], ash[64];
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
} several;

/* Ash opens the door and goes through it to the dreary room; Wren stays in the tiny room. */
static inline void several_open(several *s) {
  sprout_outcome out;
  memset(s, 0, sizeof *s);
  tw_open(&s->w, "several-places");
  tw_arrive(&s->w, "v-wren", "Wren", 1000, &out);
  sprout_outcome_free(&out);
  tw_arrive(&s->w, "v-ash", "Ash", 1001, &out);
  sprout_outcome_free(&out);
  snprintf(s->wren, sizeof s->wren, "%s", tw_person(&s->w, "v-wren"));
  snprintf(s->ash, sizeof s->ash, "%s", tw_person(&s->w, "v-ash"));
  tw_do(&s->w, "v-ash", "swing", "tiny_room.pdoor", 1002, &out);
  sprout_outcome_free(&out);
  tw_go(&s->w, "v-ash", "east", "east, through the door", "dreary_room", 1003, &out);
  CHECK(tw_told(&out, "v-ash", "A dreary room. A door is set in the west wall."));
  sprout_outcome_free(&out);
  sprout_arena_init(&s->turn, &s->w.host);
  sprout_draft_open(&s->draft, &s->turn, s->w.world, s->w.state);
  sprout_meter_begin(&s->meter, &s->w.host, SPROUT_TURN_COMMAND);
  sprout_draws_begin(&s->draws, 1);
  sprout_exec_begin(&s->x, s->w.world, &s->draft, &s->turn, &s->meter, &s->draws, &s->fault, 0);
  s->frame = sprout_exec_frame(&s->x, exec_str("several_places"), "several_places", NULL);
}

static inline void several_close(several *s) {
  sprout_arena_reset(&s->turn);
  tw_close(&s->w);
}

/* Whether a walk reached `id`, and how many times. */
static inline size_t several_reached(const sprout_reached *walked, size_t count, const char *id) {
  size_t i, times = 0;
  for (i = 0; i < count; i++)
    if (sprout_str_same(walked[i].node, exec_str(id))) times++;
  return times;
}

#endif
