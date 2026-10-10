/*
 * Tests for src/submit.c (the spec's The host contract; The runtime > Turns,
 * Effects): a host hands in a reading by id, and it runs through both passes
 * against a draft of the stored world, drains its queue, and commits unless
 * it was abandoned. Every reading the goldens hold is submitted and must
 * come back as the oracle ended it, with the lines it said in the goldens' own
 * JSON and the world committed as the golden says; a reading the world cannot
 * take is bad input, in words; a fault writes nothing.
 */
#include "reading_fixture.h"

static uint64_t seed_now = 1;

static uint64_t seed_of(void *ctx) {
  (void)ctx;
  return seed_now;
}

typedef struct submitted {
  exec_bench b;
  sprout_host host;
  sprout_world *world;
  sprout_state *state;
  const char *stored;
} submitted;

static void submitted_open(submitted *s, const char *state) {
  sprout_refusal refusal;
  reading_bench_open(&s->b);
  s->host = s->b.host;
  s->host.seed = seed_of;
  s->stored = exec_text(sprout_json_get(s->b.golden, "states"), state);
  if (sprout_load(&s->host, s->b.cartridge, s->b.cartridge_length, &s->world) != SPROUT_OK) exit(2);
  if (sprout_state_read(&s->host, s->stored, strlen(s->stored), &s->state, &refusal) != SPROUT_OK ||
      sprout_state_open(s->state, s->world, NULL, &refusal) != SPROUT_OK)
    exit(2);
}

static void submitted_close(submitted *s) {
  sprout_state_free(s->state);
  sprout_world_free(s->world);
  exec_bench_close(&s->b);
}

/* The reading a golden holds, as the host's struct; the arrays are malloc'd, and freed by free_reading. */
static sprout_reading reading_from(const sprout_json *golden, sprout_filling **fillings) {
  sprout_reading reading;
  const sprout_json *fillers = sprout_json_get(golden, "fillers");
  size_t i, j;
  *fillings = (sprout_filling *)calloc(fillers->count + 1, sizeof **fillings);
  reading.verb = exec_text(golden, "verb");
  reading.actor = exec_text(golden, "actor");
  reading.filling_count = fillers->count;
  reading.fillings = *fillings;
  for (i = 0; i < fillers->count; i++) {
    const sprout_json *one = fillers->items[i], *value = sprout_json_get(one, "value");
    const char *binds = exec_text(one, "binds");
    sprout_filling *out = &(*fillings)[i];
    out->role = exec_text(one, "role");
    if (strcmp(binds, "object") == 0) {
      out->binds = SPROUT_FILL_OBJECT;
      out->id = exec_text(one, "id");
    } else if (strcmp(binds, "set") == 0) {
      const sprout_json *ids = sprout_json_get(one, "ids");
      const char **list = (const char **)calloc(ids->count + 1, sizeof *list);
      for (j = 0; j < ids->count; j++) list[j] = ids->items[j]->bytes;
      out->binds = SPROUT_FILL_SET;
      out->ids = list;
      out->id_count = ids->count;
    } else if (strcmp(binds, "exit") == 0) {
      const sprout_json *direction = sprout_json_get(one, "direction");
      out->binds = SPROUT_FILL_EXIT;
      out->id = exec_text(one, "to");
      out->label = exec_text(one, "label");
      out->direction = direction->kind == SPROUT_JSON_STRING ? direction->bytes : NULL;
    } else if (strcmp(binds, "value") == 0 && value->kind == SPROUT_JSON_STRING) {
      out->binds = SPROUT_FILL_TEXT;
      out->text = value->bytes;
    } else if (strcmp(binds, "value") == 0) {
      out->binds = SPROUT_FILL_NUMBER;
      out->number = value->number;
    }
  }
  return reading;
}

static void free_reading(sprout_reading *reading, sprout_filling *fillings) {
  size_t i;
  for (i = 0; i < reading->filling_count; i++) free((void *)fillings[i].ids);
  free(fillings);
}

static void check_written(submitted *s, const char *want) {
  const char *written;
  size_t length;
  CHECK_INT(sprout_state_write(s->state, &written, &length), SPROUT_OK);
  CHECK_BYTES(written, length, want);
}

static void every_golden_reading_submitted_comes_back_as_the_oracle_ended_it(void) {
  exec_bench b;
  const sprout_json *cases;
  size_t i, run = 0;
  reading_bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  for (i = 0; i < cases->count; i++) {
    const sprout_json *golden = cases->items[i], *expect = sprout_json_get(golden, "expect");
    const char *how = exec_text(expect, "how");
    sprout_filling *fillings;
    sprout_reading reading = reading_from(sprout_json_get(golden, "reading"), &fillings);
    sprout_reading_outcome outcome;
    submitted s;
    int before = check_failures;
    sprout_status status;
    seed_now = exec_has_number(golden, "seed") ? (uint64_t)exec_number(golden, "seed") : 1;
    submitted_open(&s, exec_text(golden, "state"));
    status = sprout_reading_run(s.world, s.state, &reading, (uint64_t)exec_number(golden, "instant"), &outcome);
    if (strcmp(how, "fault") == 0) {
      CHECK_INT(status, SPROUT_FAULT);
      CHECK(outcome.faulted);
      if (sprout_json_get(expect, "detail") != NULL)
        CHECK(strstr(outcome.fault.text, exec_text(expect, "detail")) != NULL);
      check_written(&s, s.stored);
    } else {
      const char *text;
      size_t text_length;
      CHECK_INT(status, SPROUT_OK);
      CHECK(!outcome.faulted);
      CHECK_INT(outcome.end, strcmp(how, "refused") == 0 ? SPROUT_READ_REFUSED : strcmp(how, "gone") == 0 ? SPROUT_READ_GONE : SPROUT_READ_ACTED);
      if (strcmp(how, "refused") == 0) {
        CHECK_BYTES(outcome.effects, outcome.effects_length, "[]");
        CHECK(outcome.refused != NULL);
        CHECK_INT(sprout_json_write(&b.json, sprout_json_get(expect, "refused"), &text, &text_length), SPROUT_OK);
        {
          size_t prefix = strlen("refused") + 3;
          CHECK(outcome.refused_length == text_length - prefix &&
                memcmp(outcome.refused, text + prefix, text_length - prefix) == 0);
        }
      } else {
        size_t prefix = strlen("effects") + 3;
        CHECK(outcome.refused == NULL);
        CHECK_INT(sprout_json_write(&b.json, sprout_json_get(expect, "effects"), &text, &text_length), SPROUT_OK);
        CHECK(outcome.effects_length == text_length - prefix && memcmp(outcome.effects, text + prefix, text_length - prefix) == 0);
      }
      check_written(&s, sprout_json_get(expect, "after")->kind == SPROUT_JSON_STRING ? sprout_json_get(expect, "after")->bytes : s.stored);
    }
    if (check_failures != before) fprintf(stderr, "  in the case `%s`\n", exec_text(golden, "name"));
    sprout_reading_outcome_free(&outcome);
    free_reading(&reading, fillings);
    submitted_close(&s);
    run++;
  }
  CHECK_INT(run, cases->count);
  exec_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

/* A reading of `take` the world cannot take, and the sentence that says why. */
static void refused_as_bad_input(const char *verb, const char *actor, const char *role, sprout_fill binds, const char *id,
                                 const char *words) {
  submitted s;
  sprout_filling filling;
  sprout_reading reading;
  sprout_reading_outcome outcome;
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = binds;
  filling.id = id;
  reading.verb = verb;
  reading.actor = actor;
  reading.filling_count = 1;
  reading.fillings = &filling;
  seed_now = 1;
  submitted_open(&s, "fresh");
  CHECK_INT(sprout_reading_run(s.world, s.state, &reading, 0, &outcome), SPROUT_BAD_INPUT);
  CHECK_STR(outcome.fault.text, words);
  CHECK(outcome.held == NULL);
  check_written(&s, s.stored);
  submitted_close(&s);
}

static void a_reading_the_world_cannot_take_is_bad_input_in_words(void) {
  refused_as_bad_input("sprout.juggle", "bench#1", "target", SPROUT_FILL_OBJECT, "bench.shop.book", "no verb is named `sprout.juggle`.");
  refused_as_bad_input("take", "bench#1", "target", SPROUT_FILL_OBJECT, "bench.shop.book", "no verb is named `take`.");
  refused_as_bad_input("sprout.take", "bench#9", "target", SPROUT_FILL_OBJECT, "bench.shop.book", "`bench#9` is not an instance of this world.");
  refused_as_bad_input("sprout.take", "bench#1", "thing", SPROUT_FILL_OBJECT, "bench.shop.book", "`take` has no such role to fill.");
  refused_as_bad_input("sprout.take", "bench#1", "target", SPROUT_FILL_OBJECT, "bench.shop.nothing", "`bench.shop.nothing` is not an instance of this world.");
  refused_as_bad_input("sprout.take", "bench#1", "target", SPROUT_FILL_NUMBER, NULL, "`target` is not filled with what its verb takes there.");
}

static void a_seed_past_the_range_or_a_host_without_one_is_refused(void) {
  submitted s;
  sprout_reading reading;
  sprout_reading_outcome outcome;
  sprout_filling filling;
  memset(&filling, 0, sizeof filling);
  filling.role = "target";
  filling.binds = SPROUT_FILL_OBJECT;
  filling.id = "bench.shop.book";
  reading.verb = "sprout.take";
  reading.actor = "bench#1";
  reading.filling_count = 1;
  reading.fillings = &filling;
  submitted_open(&s, "fresh");
  seed_now = 4294967296ULL;
  CHECK_INT(sprout_reading_run(s.world, s.state, &reading, 0, &outcome), SPROUT_BAD_SEED);
  check_written(&s, s.stored);
  submitted_close(&s);
  /* A world loaded under a host with no seed cannot draw. */
  reading_bench_open(&s.b);
  s.host = s.b.host;
  CHECK_INT(sprout_load(&s.host, s.b.cartridge, s.b.cartridge_length, &s.world), SPROUT_OK);
  s.stored = exec_text(sprout_json_get(s.b.golden, "states"), "fresh");
  {
    sprout_refusal refusal;
    CHECK_INT(sprout_state_read(&s.host, s.stored, strlen(s.stored), &s.state, &refusal), SPROUT_OK);
    CHECK_INT(sprout_state_open(s.state, s.world, NULL, &refusal), SPROUT_OK);
  }
  CHECK_INT(sprout_reading_run(s.world, s.state, &reading, 0, &outcome), SPROUT_BAD_HOST);
  submitted_close(&s);
}

static void a_run_with_nothing_to_run_it_on_is_bad_input(void) {
  sprout_reading_outcome outcome;
  sprout_reading reading;
  memset(&reading, 0, sizeof reading);
  CHECK_INT(sprout_reading_run(NULL, NULL, &reading, 0, &outcome), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_reading_run(NULL, NULL, &reading, 0, NULL), SPROUT_BAD_HOST);
}

static void the_world_a_committed_reading_leaves_is_the_one_the_next_reading_runs_in(void) {
  submitted s;
  sprout_filling take, drop;
  sprout_reading reading;
  sprout_reading_outcome outcome;
  memset(&take, 0, sizeof take);
  take.role = "target";
  take.binds = SPROUT_FILL_OBJECT;
  take.id = "bench.shop.book";
  reading.verb = "sprout.take";
  reading.actor = "bench#1";
  reading.filling_count = 1;
  reading.fillings = &take;
  seed_now = 1;
  submitted_open(&s, "fresh");
  CHECK_INT(sprout_reading_run(s.world, s.state, &reading, 0, &outcome), SPROUT_OK);
  CHECK_INT(outcome.end, SPROUT_READ_ACTED);
  sprout_reading_outcome_free(&outcome);
  /* Held now, it is refused a second time by the actor's own permit. */
  CHECK_INT(sprout_reading_run(s.world, s.state, &reading, 0, &outcome), SPROUT_OK);
  CHECK_INT(outcome.end, SPROUT_READ_REFUSED);
  sprout_reading_outcome_free(&outcome);
  drop = take;
  reading.verb = "sprout.drop";
  reading.fillings = &drop;
  CHECK_INT(sprout_reading_run(s.world, s.state, &reading, 0, &outcome), SPROUT_OK);
  CHECK_INT(outcome.end, SPROUT_READ_ACTED);
  sprout_reading_outcome_free(&outcome);
  CHECK(outcome.held == NULL);
  submitted_close(&s);
}

int main(void) {
  RUN(every_golden_reading_submitted_comes_back_as_the_oracle_ended_it);
  RUN(a_reading_the_world_cannot_take_is_bad_input_in_words);
  RUN(a_seed_past_the_range_or_a_host_without_one_is_refused);
  RUN(a_run_with_nothing_to_run_it_on_is_bad_input);
  RUN(the_world_a_committed_reading_leaves_is_the_one_the_next_reading_runs_in);
  return REPORT();
}
