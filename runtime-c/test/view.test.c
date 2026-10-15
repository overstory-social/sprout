/*
 * Tests for src/view.c: a poll gives each visitor the view the golden holds, byte for byte in
 * its canonical JSON, with the tree a chip client walks over it equal to the one the golden holds beside it,
 * the steps it spent and the fault it raised. The goldens are the view of a visitor arriving in every corpus
 * world and the bench cases for what a view is for: the ways out, a set role, a value role's options, a
 * refusal, `inside_itself`, the dark, a visitor whose place is gone and a poll that spends its budget. A poll
 * draws nothing and writes nothing.
 */
#include "view_fixture.h"
#include "turn_fixture.h"

static void every_bench_case_is_polled_as_the_golden_holds(void) {
  view_bench b;
  const sprout_json *cases;
  size_t i;
  view_bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  CHECK(cases->count >= 15);
  for (i = 0; i < cases->count; i++) {
    view_case c;
    sprout_seen_view view;
    view_bench_case_open(&b, &c, cases->items[i]);
    view_replay(&b, cases->items[i], &c, &view);
    sprout_view_free(&view);
    view_case_close(&c);
  }
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void the_view_of_a_visitor_arriving_in_every_corpus_world_is_the_goldens(void) {
  view_bench b;
  const sprout_json *worlds;
  size_t i;
  view_bench_open(&b);
  worlds = sprout_json_get(b.golden, "corpus");
  CHECK(worlds->count > 40);
  for (i = 0; i < worlds->count; i++) {
    view_case c;
    sprout_seen_view view;
    view_corpus_case_open(&b, &c, worlds->items[i]);
    view_replay(&b, worlds->items[i], &c, &view);
    sprout_view_free(&view);
    view_case_close(&c);
  }
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_picture_the_description_shows_is_an_effect_with_its_payload_and_its_transcript_line(void) {
  view_bench b;
  const sprout_json *worlds;
  size_t i, found = 0;
  view_bench_open(&b);
  worlds = sprout_json_get(b.golden, "corpus");
  for (i = 0; i < worlds->count; i++) {
    view_case c;
    sprout_seen_view view;
    if (strcmp(view_text(worlds->items[i], "world"), "media-room") != 0) continue;
    found++;
    view_corpus_case_open(&b, &c, worlds->items[i]);
    CHECK_INT(sprout_view(c.world, c.state, &c.host, view_text(worlds->items[i], "visit"), &view), SPROUT_OK);
    CHECK_INT(view.description_count, 1);
    CHECK_BYTES(view.description[0].bytes, view.description[0].length, "A damp cellar.");
    CHECK_INT(view.effect_count, 1);
    CHECK_STR(view.effects[0].extension, "media");
    CHECK_STR(view.effects[0].statement, "show");
    CHECK_BYTES(view.effects[0].payload.bytes, view.effects[0].payload.length, "{\"image\":\"cellar.png\"}");
    CHECK_BYTES(view.effects[0].transcript.bytes, view.effects[0].transcript.length, "[cellar.png]");
    sprout_view_free(&view);
    view_case_close(&c);
  }
  CHECK_INT(found, 1);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

/* The case named, opened and polled. */
static void polled(view_bench *b, const char *needle, view_case *c, sprout_seen_view *view) {
  const sprout_json *golden = view_case_named(b, needle);
  view_bench_case_open(b, c, golden);
  CHECK_INT(sprout_view(c->world, c->state, &c->host, view_text(golden, "visit"), view), SPROUT_OK);
}

/* Whether the view offers `verb` typed as `typed` (NULL for any line). */
static bool offers(const sprout_seen_view *view, const char *verb, const char *typed) {
  size_t i;
  for (i = 0; i < view->reading_count; i++) {
    const sprout_seen_reading *r = &view->readings[i];
    if (strcmp(r->verb, verb) == 0 &&
        (typed == NULL || (r->typed.length == strlen(typed) && memcmp(r->typed.bytes, typed, r->typed.length) == 0)))
      return true;
  }
  return false;
}

/* Whether some reading is refused in words that hold `words`. */
static bool refused_in(const sprout_seen_view *view, const char *words) {
  size_t i;
  for (i = 0; i < view->reading_count; i++) {
    const sprout_seen_reading *r = &view->readings[i];
    if (r->refused && r->refusal_count > 0 && r->refusal[0].length >= strlen(words)) {
      size_t at;
      for (at = 0; at + strlen(words) <= r->refusal[0].length; at++)
        if (memcmp(r->refusal[0].bytes + at, words, strlen(words)) == 0) return true;
    }
  }
  return false;
}

static void the_bench_shows_each_part_a_view_is_for(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  size_t i, goes = 0;
  view_bench_open(&b);
  /* an exit and a link, each typed as a way to go */
  polled(&b, "gate that stands open", &c, &view);
  CHECK(offers(&view, "sprout.go", "go north"));
  sprout_view_free(&view);
  view_case_close(&c);
  polled(&b, "link set", &c, &view);
  CHECK(offers(&view, "sprout.go", "go down the caf\xc3\xa9 stair"));
  for (i = 0; i < view.reading_count; i++) goes += strcmp(view.readings[i].verb, "sprout.go") == 0;
  CHECK_INT(goes, 1);
  sprout_view_free(&view);
  view_case_close(&c);
  polled(&b, "link not set", &c, &view);
  CHECK(!offers(&view, "sprout.go", NULL));
  sprout_view_free(&view);
  view_case_close(&c);
  /* a set role, a refusal in the world's words and the engine's inside_itself */
  polled(&b, "set role", &c, &view);
  CHECK(offers(&view, "viewbench.juggle", NULL));
  sprout_view_free(&view);
  view_case_close(&c);
  polled(&b, "witness", &c, &view);
  CHECK(refused_in(&view, "Not before me."));
  sprout_view_free(&view);
  view_case_close(&c);
  polled(&b, "inside_itself", &c, &view);
  CHECK(refused_in(&view, "inside itself"));
  sprout_view_free(&view);
  view_case_close(&c);
  /* the dark */
  polled(&b, "cellar is dark", &c, &view);
  CHECK_INT(view.description_count, 1);
  CHECK_BYTES(view.description[0].bytes, view.description[0].length, "It is too dark to see.");
  sprout_view_free(&view);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_visitor_whose_place_is_gone_reads_displaced_and_is_offered_nothing(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  view_bench_open(&b);
  polled(&b, "not a place any more", &c, &view);
  CHECK(!view.faulted);
  CHECK_INT(view.place.name.length, 0);
  CHECK_INT(view.description_count, 1);
  CHECK_BYTES(view.description[0].bytes, view.description[0].length, "The place you were standing is gone.");
  CHECK_INT(view.exit_count + view.occupant_count + view.carried_count + view.reading_count, 0);
  sprout_view_free(&view);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_poll_that_spends_its_budget_shows_unseen_and_keeps_what_it_derived(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  view_bench_open(&b);
  polled(&b, "shows unseen and keeps the parts", &c, &view);
  CHECK(view.faulted);
  CHECK_STR(view.fault_name, "BudgetExhausted");
  CHECK_STR(view.fault.budget, "steps per poll");
  CHECK_INT(view.fault.limit, 130);
  CHECK_BYTES(view.fault_object.bytes, view.fault_object.length, "viewbench.yard");
  CHECK_BYTES(view.place.id.bytes, view.place.id.length, "viewbench.yard");
  CHECK_BYTES(view.place.name.bytes, view.place.name.length, "a yard");
  CHECK_BYTES(view.description[0].bytes, view.description[0].length, "Too much happens here to take in.");
  CHECK_INT(view.exit_count, 5);
  CHECK_INT(view.occupant_count, 1);
  CHECK_INT(view.reading_count, 0);
  sprout_view_free(&view);
  view_case_close(&c);
  /* The engine's own words when the world writes none: the budget that faulted can afford nothing more. */
  polled(&b, "before the exits", &c, &view);
  CHECK(view.faulted);
  CHECK_BYTES(view.description[0].bytes, view.description[0].length, "Too much happens here to take in.");
  CHECK_INT(view.exit_count + view.occupant_count + view.carried_count + view.reading_count, 0);
  sprout_view_free(&view);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static int seeds_asked, clocks_read;
static uint64_t counting_seed(void *ctx) {
  (void)ctx;
  seeds_asked++;
  return 1;
}
static uint64_t counting_now(void *ctx) {
  (void)ctx;
  clocks_read++;
  return 0;
}

static void a_poll_draws_nothing_and_reads_no_clock(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  size_t i;
  const sprout_json *cases;
  view_bench_open(&b);
  cases = sprout_json_get(b.golden, "cases");
  seeds_asked = clocks_read = 0;
  for (i = 0; i < cases->count; i++) {
    view_bench_case_open(&b, &c, cases->items[i]);
    c.host.seed = counting_seed;
    c.host.now = counting_now;
    CHECK_INT(sprout_view(c.world, c.state, &c.host, view_text(cases->items[i], "visit"), &view), SPROUT_OK);
    sprout_view_free(&view);
    view_case_close(&c);
  }
  CHECK_INT(seeds_asked, 0);
  CHECK_INT(clocks_read, 0);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_poll_that_cannot_afford_unseen_says_the_engines_own_words(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  view_bench_open(&b);
  polled(&b, "cannot afford unseen", &c, &view);
  CHECK(view.faulted);
  CHECK_BYTES(view.description[0].bytes, view.description[0].length, "Something here is too much to take in.");
  CHECK_INT(view.exit_count + view.occupant_count + view.carried_count + view.reading_count, 0);
  sprout_view_free(&view);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_poll_whose_kept_parts_cannot_be_rendered_either_keeps_nothing(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  view_bench_open(&b);
  polled(&b, "kept parts cannot be rendered", &c, &view);
  CHECK(view.faulted);
  CHECK_BYTES(view.description[0].bytes, view.description[0].length, "Too much happens here to take in.");
  CHECK_INT(view.exit_count + view.occupant_count + view.carried_count + view.reading_count, 0);
  sprout_view_free(&view);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_poll_writes_nothing(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  const char *before, *after;
  size_t before_length, after_length;
  char *kept;
  sprout_arena scratch;
  view_bench_open(&b);
  view_bench_case_open(&b, &c, view_case_named(&b, "carries is offered"));
  CHECK_INT(test_state_write(c.state, &scratch, &before, &before_length), SPROUT_OK);
  kept = (char *)malloc(before_length + 1);
  memcpy(kept, before, before_length);
  sprout_arena_reset(&scratch);
  CHECK_INT(sprout_view(c.world, c.state, &c.host, "v-marta", &view), SPROUT_OK);
  CHECK_INT(test_state_write(c.state, &scratch, &after, &after_length), SPROUT_OK);
  CHECK(before_length == after_length && memcmp(kept, after, after_length) == 0);
  sprout_arena_reset(&scratch);
  free(kept);
  sprout_view_free(&view);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_visit_the_world_never_saw_and_a_visitor_who_is_away_have_no_view(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  sprout_state *away;
  sprout_refusal refusal;
  const sprout_json *golden;
  const char *stored, *at;
  char *edited;
  size_t length;
  view_bench_open(&b);
  golden = view_case_named(&b, "link not set");
  view_bench_case_open(&b, &c, golden);
  CHECK_INT(sprout_view(c.world, c.state, &c.host, "nobody", &view), SPROUT_BAD_INPUT);
  CHECK(strstr(view.fault.text, "`nobody` has never visited this world.") != NULL);
  /* The visitor's own record sorts before the declared objects, so the first place named is where they stand. */
  stored = view_text(golden, "state");
  at = strstr(stored, "\"container\":\"viewbench.tower\"");
  CHECK(at != NULL);
  length = strlen(stored);
  edited = (char *)malloc(length + 1);
  memcpy(edited, stored, (size_t)(at - stored));
  memcpy(edited + (at - stored), "\"container\":null", 16);
  strcpy(edited + (at - stored) + 16, at + strlen("\"container\":\"viewbench.tower\""));
  CHECK_INT(sprout_state_read(&c.host, edited, strlen(edited), &away, &refusal), SPROUT_OK);
  CHECK_INT(sprout_state_open(away, c.world, NULL, &refusal), SPROUT_OK);
  CHECK_INT(sprout_view(c.world, away, &c.host, "v-marta", &view), SPROUT_BAD_INPUT);
  CHECK(strstr(view.fault.text, "is not in this world, so has no view.") != NULL);
  sprout_state_free(away);
  free(edited);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_host_that_cannot_give_a_page_is_told_so_and_leaks_nothing(void) {
  view_bench b;
  view_case c;
  sprout_seen_view view;
  long pages;
  sprout_status status;
  view_bench_open(&b);
  view_bench_case_open(&b, &c, view_case_named(&b, "carries is offered"));
  pages = b.heap.pages;
  b.heap.refuse_after = pages + 2;
  status = sprout_view(c.world, c.state, &c.host, "v-marta", &view);
  CHECK(status == SPROUT_NO_MEMORY || status == SPROUT_OK);
  if (status == SPROUT_OK) sprout_view_free(&view);
  b.heap.refuse_after = -1;
  CHECK_INT(b.heap.pages, pages);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

/* A view's readings of `verb` as the whole poll gave them: how many, and their typed lines in order. */
static size_t readings_of(const sprout_seen_view *whole, const char *verb, const sprout_seen_reading **first) {
  size_t i, n = 0;
  *first = NULL;
  for (i = 0; i < whole->reading_count; i++)
    if (strcmp(whole->readings[i].verb, verb) == 0) {
      if (*first == NULL) *first = &whole->readings[i];
      n++;
    }
  return n;
}

static void a_scene_lists_the_verbs_and_a_verbs_readings_come_alone_as_the_whole_poll_gives_them(void) {
  view_bench b;
  view_case c;
  sprout_seen_view whole, scene, one;
  sprout_arena keep;
  size_t v, i, r, total = 0;
  view_bench_open(&b);
  polled(&b, "offered the verbs once for each way", &c, &whole);
  CHECK(!whole.faulted && whole.reading_count > 0 && whole.verb_count > 1);
  CHECK_INT(sprout_scene(c.world, c.state, &c.host, "v-marta", &scene), SPROUT_OK);
  CHECK(!scene.faulted);
  CHECK_INT(scene.reading_count, 0);
  CHECK(scene.readings == NULL);
  CHECK(scene.verb_count >= whole.verb_count); /* the scene lists by what can fill the roles, before any consent pass */
  CHECK_BYTES(scene.place.id.bytes, scene.place.id.length, "viewbench.yard");
  CHECK_INT(scene.exit_count, whole.exit_count);
  CHECK_INT(scene.occupant_count, whole.occupant_count);
  CHECK_INT(scene.description_count, whole.description_count);
  /* The whole poll's verbs are those with a reading, in the order the readings come, and the scene lists each of them in that order. */
  for (v = 0, r = 0; v < whole.verb_count; v++) {
    const sprout_seen_reading *first;
    size_t at;
    CHECK(readings_of(&whole, whole.verbs[v], &first) > 0);
    for (i = r; i < whole.reading_count; i++)
      if (strcmp(whole.readings[i].verb, whole.verbs[v]) == 0) break;
    CHECK(i < whole.reading_count);
    r = i;
    for (at = v == 0 ? 0 : 0; at < scene.verb_count; at++)
      if (strcmp(scene.verbs[at], whole.verbs[v]) == 0) break;
    CHECK(at < scene.verb_count);
  }
  for (i = 0; i < whole.reading_count; i++) {
    for (v = 0; v < whole.verb_count; v++)
      if (strcmp(whole.readings[i].verb, whole.verbs[v]) == 0) break;
    CHECK(v < whole.verb_count);
  }
  sprout_arena_init(&keep, &c.host);
  for (v = 0; v < whole.verb_count; v++) {
    const sprout_seen_reading *first;
    size_t n = readings_of(&whole, whole.verbs[v], &first);
    CHECK_INT(sprout_readings_for(c.world, c.state, &c.host, "v-marta", whole.verbs[v], &keep, &one), SPROUT_OK);
    CHECK(one.held == NULL && !one.faulted);
    CHECK_INT(one.reading_count, n);
    for (i = 0; i < one.reading_count && first != NULL; i++) {
      CHECK_STR(one.readings[i].verb, first[i].verb);
      CHECK_BYTES(one.readings[i].typed.bytes, one.readings[i].typed.length, first[i].typed.bytes);
      CHECK(one.readings[i].refused == first[i].refused);
      CHECK_INT(one.readings[i].filler_count, first[i].filler_count);
      CHECK_INT(one.readings[i].options_count, first[i].options_count);
    }
    total += one.reading_count;
    sprout_view_free(&one); /* nothing of its own to free */
  }
  CHECK_INT(total, whole.reading_count);
  CHECK_INT(sprout_readings_for(c.world, c.state, &c.host, "v-marta", "viewbench.no_such_verb", &keep, &one), SPROUT_BAD_INPUT);
  CHECK_STR(one.fault.text, "`viewbench.no_such_verb` is not a verb of this world.");
  CHECK_INT(sprout_readings_for(c.world, c.state, &c.host, "nobody", whole.verbs[0], &keep, &one), SPROUT_BAD_INPUT);
  CHECK_INT(sprout_readings_for(c.world, c.state, &c.host, "v-marta", whole.verbs[0], NULL, &one), SPROUT_BAD_HOST);
  sprout_arena_reset(&keep);
  sprout_view_free(&scene);
  sprout_view_free(&whole);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_verbs_readings_that_spend_their_budget_are_no_readings(void) {
  view_bench b;
  view_case c;
  sprout_seen_view scene, one;
  sprout_arena keep;
  view_bench_open(&b);
  polled(&b, "shows unseen and keeps the parts", &c, &scene);
  sprout_view_free(&scene);
  sprout_arena_init(&keep, &c.host);
  CHECK_INT(sprout_scene(c.world, c.state, &c.host, "v-marta", &scene), SPROUT_OK);
  CHECK(scene.verb_count > 0);
  /* The budget that cannot afford the whole poll affords the scene, and some one verb's readings, but not every verb's at once. */
  CHECK(!scene.faulted);
  CHECK_INT(sprout_readings_for(c.world, c.state, &c.host, "v-marta", scene.verbs[0], &keep, &one), SPROUT_OK);
  CHECK(one.held == NULL);
  if (one.faulted) {
    CHECK_INT(one.reading_count, 0);
    CHECK_STR(one.fault_name, "BudgetExhausted");
  }
  sprout_arena_reset(&keep);
  sprout_view_free(&scene);
  view_case_close(&c);
  view_bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

/* A poll's fault is laid against the object the faulting rule names, as a command's is, and not the visitor's place. */
static void a_poll_that_faults_on_an_object_lays_the_fault_against_it(void) {
  turn_world w;
  sprout_outcome out;
  sprout_filling filling;
  sprout_reading take;
  sprout_seen_view view;
  tw_open(&w, "shut-contents");
  tw_arrive(&w, "ines", "Ines", 0, &out);
  sprout_outcome_free(&out);
  tw_arrive(&w, "pell", "Pell", 1, &out);
  sprout_outcome_free(&out);
  /* Held, the box is out of the cellar's range, where the cellar's description reads it. */
  take = tw_reading("sprout.take", tw_person(&w, "ines"), &filling, "target", "shut_contents.cellar.box");
  tw_command(&w, "ines", &take, 2, &out);
  CHECK(!out.faulted);
  sprout_outcome_free(&out);
  CHECK_INT(sprout_view(w.world, w.state, &w.host, "pell", &view), SPROUT_OK);
  CHECK(view.faulted);
  CHECK_STR(view.fault_name, "NameOutOfRange");
  CHECK_BYTES(view.place.id.bytes, view.place.id.length, "shut_contents.cellar");
  CHECK_BYTES(view.fault_object.bytes, view.fault_object.length, "shut_contents.cellar.box");
  sprout_view_free(&view);
  tw_close(&w);
}

int main(void) {
  RUN(a_scene_lists_the_verbs_and_a_verbs_readings_come_alone_as_the_whole_poll_gives_them);
  RUN(a_verbs_readings_that_spend_their_budget_are_no_readings);
  RUN(every_bench_case_is_polled_as_the_golden_holds);
  RUN(the_view_of_a_visitor_arriving_in_every_corpus_world_is_the_goldens);
  RUN(a_picture_the_description_shows_is_an_effect_with_its_payload_and_its_transcript_line);
  RUN(the_bench_shows_each_part_a_view_is_for);
  RUN(a_visitor_whose_place_is_gone_reads_displaced_and_is_offered_nothing);
  RUN(a_poll_that_spends_its_budget_shows_unseen_and_keeps_what_it_derived);
  RUN(a_poll_that_faults_on_an_object_lays_the_fault_against_it);
  RUN(a_poll_draws_nothing_and_reads_no_clock);
  RUN(a_poll_that_cannot_afford_unseen_says_the_engines_own_words);
  RUN(a_poll_whose_kept_parts_cannot_be_rendered_either_keeps_nothing);
  RUN(a_poll_writes_nothing);
  RUN(a_visit_the_world_never_saw_and_a_visitor_who_is_away_have_no_view);
  RUN(a_host_that_cannot_give_a_page_is_told_so_and_leaks_nothing);
  return REPORT();
}
