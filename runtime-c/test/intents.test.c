/*
 * Tests for src/intents.c (the spec's Parsing > Intents): every step is
 * planned before the line runs, against the world as the visitor typed into
 * it. A step whose roles what was bound cannot fill is left out without its
 * `when` being read, a step whose `when` is false is left out, and the rest
 * are the line's readings, in order. Planning only reads.
 */
#include "reading_fixture.h"

static const sprout_intent *intent_named(const sprout_world *world, const char *qualified) {
  size_t i;
  for (i = 0; i < world->intent_count; i++) {
    char name[256];
    snprintf(name, sizeof name, "%s.%s", world->intents[i].library, world->intents[i].name);
    if (strcmp(name, qualified) == 0) return &world->intents[i];
  }
  fprintf(stderr, "the world declares no intent `%s`\n", qualified);
  exit(2);
}

/* The line a golden intent stands for, with each slot filled by the thing it names. */
static sprout_intended intended_by(exec_case *c, const sprout_json *golden) {
  sprout_intended intended;
  const sprout_json *slots = sprout_json_get(golden, "slots");
  sprout_filled *filled;
  size_t i;
  intended.intent = intent_named(c->world, exec_text(golden, "intent"));
  intended.actor = exec_str(exec_text(golden, "actor"));
  filled = (sprout_filled *)sprout_arena_take(&c->turn, (intended.intent->slot_count + 1) * sizeof *filled);
  for (i = 0; i < intended.intent->slot_count; i++) {
    const sprout_json *thing = sprout_json_get(slots, intended.intent->slots[i]);
    if (thing == NULL) continue;
    filled[i].filled = true;
    filled[i].bound.kind = SPROUT_BOUND_OBJECT;
    filled[i].bound.object = reading_str(thing);
  }
  intended.slots = filled;
  return intended;
}

static void the_steps_an_intent_plans_are_those_that_can_be_filled_and_whose_when_holds(void) {
  exec_bench b;
  const sprout_json *intents;
  size_t i, j, k;
  reading_bench_open(&b);
  intents = sprout_json_get(b.golden, "intents");
  CHECK(intents->count >= 3);
  for (i = 0; i < intents->count; i++) {
    exec_case c;
    const sprout_json *golden = intents->items[i], *expect = sprout_json_get(golden, "expect");
    const sprout_json *want = sprout_json_get(expect, "planned");
    const sprout_resolved *planned;
    sprout_intended intended;
    size_t count;
    int before = check_failures;
    reading_open(&b, &c, golden, exec_text(golden, "actor"));
    intended = intended_by(&c, golden);
    CHECK_INT(sprout_plan_intent(&c.frame, &intended, &planned, &count), SPROUT_EVAL_OK);
    CHECK_INT(count, want->count);
    for (j = 0; j < count && j < want->count; j++) {
      const sprout_json *fillers = sprout_json_get(want->items[j], "fillers");
      char name[256];
      size_t seen = 0;
      snprintf(name, sizeof name, "%s.%s", planned[j].verb->library, planned[j].verb->name);
      CHECK_STR(name, exec_text(want->items[j], "verb"));
      CHECK(sprout_str_same(planned[j].actor, intended.actor));
      for (k = 0; k < planned[j].verb->role_count; k++) {
        const sprout_json *one = NULL;
        size_t f;
        for (f = 0; f < fillers->count; f++)
          if (strcmp(exec_text(fillers->items[f], "role"), planned[j].verb->roles[k].name) == 0) one = fillers->items[f];
        CHECK_INT(planned[j].roles[k].filled, one != NULL);
        if (one == NULL || !planned[j].roles[k].filled) continue;
        seen++;
        CHECK(exec_same_str(planned[j].roles[k].bound.object, sprout_json_get(one, "id")));
      }
      CHECK_INT(seen, fillers->count);
    }
    CHECK_INT(c.meter.steps, exec_number(expect, "steps"));
    if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", exec_text(golden, "name"));
    exec_case_close(&c);
  }
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void planning_reads_the_world_and_writes_nothing(void) {
  exec_bench b;
  exec_case c;
  sprout_intended intended;
  const sprout_resolved *planned;
  size_t count;
  const sprout_json *golden;
  reading_bench_open(&b);
  golden = sprout_json_get(b.golden, "intents")->items[0];
  reading_open(&b, &c, golden, exec_text(golden, "actor"));
  intended = intended_by(&c, golden);
  CHECK_INT(sprout_plan_intent(&c.frame, &intended, &planned, &count), SPROUT_EVAL_OK);
  CHECK_INT(count, 2);
  CHECK_INT(c.draft.written_count, 0);
  CHECK_INT(c.x.effect_count, 0);
  CHECK_INT(c.x.queued_count, 0);
  exec_case_close(&c);
  exec_bench_close(&b);
}

static void a_step_that_cannot_be_read_for_want_of_steps_faults_the_plan(void) {
  exec_bench b;
  exec_case c;
  sprout_intended intended;
  const sprout_resolved *planned;
  size_t count;
  const sprout_json *golden;
  reading_bench_open(&b);
  golden = sprout_json_get(b.golden, "intents")->items[0];
  reading_open(&b, &c, golden, exec_text(golden, "actor"));
  c.host.budgets.steps.set = true;
  c.host.budgets.steps.value = 1;
  intended = intended_by(&c, golden);
  CHECK_INT(sprout_plan_intent(&c.frame, &intended, &planned, &count), SPROUT_EVAL_FAULT);
  CHECK_STR(c.meter.fault.budget, "steps");
  exec_case_close(&c);
  exec_bench_close(&b);
}

int main(void) {
  RUN(the_steps_an_intent_plans_are_those_that_can_be_filled_and_whose_when_holds);
  RUN(planning_reads_the_world_and_writes_nothing);
  RUN(a_step_that_cannot_be_read_for_want_of_steps_faults_the_plan);
  return REPORT();
}
