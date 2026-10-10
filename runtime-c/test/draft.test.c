/*
 * Tests for src/draft.c: a turn's copy-on-write layer over a state. Reads go
 * through to the base; writes, moves, spawns and removals are held until the
 * turn commits, and dropped with the turn arena; contents order, serials,
 * tombstones and the change set follow the spec's State, Spawning and
 * Destroying.
 */
#include "corpus.h"
#include "draft.h"

#define WORLD "printers_shop"
#define ROOM WORLD ".composing_room"
#define YARD WORLD ".press_yard"

typedef struct fixture {
  test_heap heap;
  sprout_host host;
  sprout_world *world;
  sprout_state *state;
  sprout_arena turn;
} fixture;

static sprout_str S(const char *text) {
  sprout_str s;
  s.bytes = text;
  s.length = strlen(text);
  return s;
}

/* The stored-canon world opened against printers_shop, with a dormant spawn added inside the press yard. */
static void begin(fixture *f) {
  size_t length;
  char *golden = test_golden("stored-canon.json", &length);
  char text[8192];
  const char *visitors = strstr(golden, "],\"visitors\"");
  sprout_refusal why;
  sprout_opened report;
  size_t head;
  f->host = corpus_host(&f->heap);
  f->world = corpus_load(WORLD, &f->host);
  while (length > 0 && golden[length - 1] == '\n') golden[--length] = '\0';
  head = (size_t)(visitors - golden);
  snprintf(text, sizeof text,
           "%.*s,{\"id\":\"" WORLD "#5\",\"made\":{\"from\":\"spawned\",\"kind\":\"" WORLD ".Nowhere\"},"
           "\"container\":\"" YARD "\",\"arrival\":5,\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},"
           "\"lastTick\":null}%s",
           (int)head, golden, visitors);
  {
    char *serial = strstr(text, "\"serial\":4");
    serial[9] = '5';
  }
  CHECK_INT(sprout_state_read(&f->host, text, strlen(text), &f->state, &why), SPROUT_OK);
  CHECK_INT(sprout_state_open(f->state, f->world, &report, &why), SPROUT_OK);
  sprout_arena_init(&f->turn, &f->host);
  free(golden);
}

static void finish(fixture *f) {
  sprout_arena_reset(&f->turn);
  sprout_state_free(f->state);
  sprout_world_free(f->world);
  CHECK_INT(f->heap.pages, 0);
}

static void expect_ids(const sprout_str *got, size_t count, const char *const *want, size_t want_count) {
  size_t i;
  CHECK_INT(count, want_count);
  for (i = 0; i < count && i < want_count; i++) CHECK_BYTES(got[i].bytes, got[i].length, want[i]);
}

static void reads_go_through_to_the_state_and_dormant_records_are_not_instances(void) {
  fixture f;
  sprout_draft draft;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK(sprout_draft_instance(&draft, S(ROOM)) != NULL);
  CHECK(sprout_draft_instance(&draft, S(WORLD "#5")) == NULL);
  CHECK(sprout_draft_record(&draft, S(WORLD "#5")) != NULL);
  CHECK(sprout_draft_record(&draft, S(WORLD "#9")) == NULL);
  CHECK(sprout_draft_visitor(&draft, S("v-8f2c")) != NULL);
  CHECK(sprout_draft_visitor(&draft, S("v-none")) == NULL);
  CHECK(sprout_draft_tombstoned(&draft, S(ROOM ".lamp")));
  CHECK(!sprout_draft_tombstoned(&draft, S(ROOM)));
  CHECK_INT(sprout_draft_held(&draft), f.state->instance_count);
  finish(&f);
}

static void contents_come_unmoved_declared_objects_by_rank_then_arrivals_by_serial(void) {
  fixture f;
  sprout_draft draft;
  const sprout_str *kids;
  size_t count, i;
  const sprout_stored_instance *last;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_children(&draft, S(ROOM), &kids, &count), SPROUT_DRAFT_OK);
  CHECK(count >= 3);
  /* The visitor arrived, so it comes after every declared object; the declared ones keep their rank order. */
  CHECK_BYTES(kids[count - 1].bytes, kids[count - 1].length, WORLD "#1");
  for (i = 0; i + 2 < count; i++) {
    const sprout_declared *a = sprout_world_declared(f.world, kids[i].bytes);
    const sprout_declared *b = sprout_world_declared(f.world, kids[i + 1].bytes);
    CHECK(a != NULL && b != NULL);
    if (a != NULL && b != NULL) CHECK(a->rank < b->rank);
  }
  /* A dormant record holds its place in the tree but is not among the decoded contents. */
  CHECK_INT(sprout_draft_children(&draft, S(YARD), &kids, &count), SPROUT_DRAFT_OK);
  for (i = 0; i < count; i++) CHECK(!(kids[i].length == strlen(WORLD "#5") && memcmp(kids[i].bytes, WORLD "#5", kids[i].length) == 0));
  last = sprout_draft_instance(&draft, S(WORLD "#1"));
  CHECK(last != NULL && last->has_arrival && last->arrival == 2);
  finish(&f);
}

static void a_write_is_held_until_commit_and_dropping_the_turn_leaves_the_state_as_it_was(void) {
  fixture f;
  sprout_draft draft;
  const char *before, *after;
  size_t before_length, after_length;
  sprout_stored_instance changed;
  begin(&f);
  CHECK_INT(sprout_state_write(f.state, &before, &before_length), SPROUT_OK);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  changed = *sprout_draft_instance(&draft, S(ROOM));
  changed.has_last_tick = true;
  changed.last_tick = 1790099999;
  CHECK_INT(sprout_draft_write(&draft, &changed), SPROUT_DRAFT_OK);
  CHECK(sprout_draft_instance(&draft, S(ROOM))->last_tick == 1790099999);
  CHECK(sprout_state_find(f.state, S(ROOM))->last_tick == 1790000000);
  sprout_arena_reset(&f.turn);
  CHECK_INT(sprout_state_write(f.state, &after, &after_length), SPROUT_OK);
  CHECK_BYTES(after, after_length, before);
  finish(&f);
}

static void a_record_cannot_be_moved_by_writing_it(void) {
  fixture f;
  sprout_draft draft;
  sprout_stored_instance moved;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  moved = *sprout_draft_instance(&draft, S(ROOM ".cat"));
  moved.container = S(YARD);
  CHECK_INT(sprout_draft_write(&draft, &moved), SPROUT_DRAFT_MOVED);
  moved = *sprout_draft_instance(&draft, S(ROOM ".cat"));
  moved.has_arrival = true;
  moved.arrival = 9;
  CHECK_INT(sprout_draft_write(&draft, &moved), SPROUT_DRAFT_MOVED);
  moved = *sprout_draft_instance(&draft, S(ROOM ".cat"));
  moved.id = S(ROOM ".dog");
  CHECK_INT(sprout_draft_write(&draft, &moved), SPROUT_DRAFT_MISSING);
  finish(&f);
}

static void placing_moves_an_instance_last_under_a_new_arrival_serial(void) {
  fixture f;
  sprout_draft draft;
  sprout_str yard = S(YARD), world = S(WORLD);
  const sprout_str *kids;
  size_t count;
  const sprout_stored_instance *cat;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_place(&draft, S(ROOM ".cat"), &yard), SPROUT_DRAFT_OK);
  cat = sprout_draft_instance(&draft, S(ROOM ".cat"));
  CHECK_BYTES(cat->container.bytes, cat->container.length, YARD);
  CHECK(cat->has_arrival && cat->arrival == 6); /* the state's serial was 5 */
  CHECK_INT(sprout_draft_children(&draft, S(YARD), &kids, &count), SPROUT_DRAFT_OK);
  CHECK_BYTES(kids[count - 1].bytes, kids[count - 1].length, ROOM ".cat");
  CHECK_INT(sprout_draft_children(&draft, S(ROOM), &kids, &count), SPROUT_DRAFT_OK);
  {
    size_t i;
    for (i = 0; i < count; i++) CHECK(!(kids[i].length == strlen(ROOM ".cat") && memcmp(kids[i].bytes, ROOM ".cat", kids[i].length) == 0));
  }
  CHECK_INT(sprout_draft_place(&draft, S(ROOM ".cat"), &world), SPROUT_DRAFT_OK);
  CHECK(sprout_draft_instance(&draft, S(ROOM ".cat"))->arrival == 7);
  finish(&f);
}

static void nothing_goes_inside_itself_or_what_it_holds_and_the_world_stays_put(void) {
  fixture f;
  sprout_draft draft;
  sprout_str cabinet = S(ROOM ".cabinet"), shop_key = S(ROOM ".cabinet.shop_key"), room = S(ROOM);
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_place(&draft, cabinet, &cabinet), SPROUT_DRAFT_CYCLE);
  CHECK_INT(sprout_draft_place(&draft, cabinet, &shop_key), SPROUT_DRAFT_CYCLE);
  CHECK_INT(sprout_draft_place(&draft, S(WORLD), &room), SPROUT_DRAFT_THE_WORLD);
  CHECK_INT(sprout_draft_place(&draft, S(ROOM ".nobody"), &room), SPROUT_DRAFT_MISSING);
  CHECK_INT(sprout_draft_place(&draft, cabinet, &(sprout_str){WORLD ".nowhere", 16}), SPROUT_DRAFT_MISSING);
  CHECK_INT(sprout_draft_place(&draft, cabinet, NULL), SPROUT_DRAFT_NOT_A_VISITOR);
  CHECK_INT(sprout_draft_held(&draft), f.state->instance_count);
  finish(&f);
}

static void a_visitor_going_away_keeps_the_serial_it_last_arrived_under(void) {
  fixture f;
  sprout_draft draft;
  const sprout_stored_instance *visitor;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_place(&draft, S(WORLD "#1"), NULL), SPROUT_DRAFT_OK);
  visitor = sprout_draft_instance(&draft, S(WORLD "#1"));
  CHECK(!visitor->has_container);
  CHECK(visitor->has_arrival && visitor->arrival == 2);
  CHECK_INT(draft.serial, 5);
  finish(&f);
}

static void a_spawn_takes_an_id_nothing_has_had_and_arrives_where_it_is_put(void) {
  fixture f;
  sprout_draft draft;
  sprout_stored_instance spawn;
  sprout_str id;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_mint(&draft, &id), SPROUT_DRAFT_OK);
  CHECK_BYTES(id.bytes, id.length, WORLD "#6");
  memset(&spawn, 0, sizeof spawn);
  spawn.id = id;
  spawn.made = SPROUT_MADE_SPAWNED;
  spawn.made_kind = S(WORLD ".Cat");
  spawn.has_container = true;
  spawn.container = S(YARD);
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_NO_ARRIVAL);
  spawn.has_arrival = true;
  spawn.arrival = 6;
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_held(&draft), f.state->instance_count + 1);
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_TAKEN);
  spawn.id = S(WORLD "#5");
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_TAKEN);
  spawn.id = S(ROOM ".lamp");
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_TAKEN);
  spawn.id = S(WORLD);
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_TAKEN);
  finish(&f);
}

static void two_drafts_on_one_state_mint_the_same_ids(void) {
  fixture f;
  sprout_draft one, two;
  sprout_arena other;
  sprout_str a, b, c;
  begin(&f);
  sprout_arena_init(&other, &f.host);
  sprout_draft_open(&one, &f.turn, f.world, f.state);
  sprout_draft_open(&two, &other, f.world, f.state);
  CHECK_INT(sprout_draft_mint(&one, &a), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_mint(&two, &b), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_mint(&one, &c), SPROUT_DRAFT_OK);
  CHECK_BYTES(a.bytes, a.length, WORLD "#6");
  CHECK_BYTES(b.bytes, b.length, WORLD "#6");
  CHECK_BYTES(c.bytes, c.length, WORLD "#7");
  sprout_arena_reset(&other);
  finish(&f);
}

static void removing_takes_everything_inside_tombstones_declared_objects_and_never_the_world(void) {
  fixture f;
  sprout_draft draft;
  const sprout_str *removed;
  size_t count;
  const char *want[] = {YARD, YARD ".wooden_rib", YARD ".bone_rib", YARD ".press", WORLD "#5"};
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_remove(&draft, S(WORLD), &removed, &count), SPROUT_DRAFT_THE_WORLD);
  CHECK_INT(sprout_draft_remove(&draft, S(WORLD "#5"), &removed, &count), SPROUT_DRAFT_MISSING);
  CHECK_INT(sprout_draft_remove(&draft, S(YARD), &removed, &count), SPROUT_DRAFT_OK);
  /* The yard's declared contents in their rank order, then the dormant spawn inside it. */
  expect_ids(removed, count, want, 5);
  CHECK(sprout_draft_instance(&draft, S(YARD ".press")) == NULL);
  CHECK(sprout_draft_record(&draft, S(WORLD "#5")) == NULL);
  CHECK(sprout_draft_tombstoned(&draft, S(YARD)));
  CHECK(sprout_draft_tombstoned(&draft, S(YARD ".press")));
  CHECK(!sprout_draft_tombstoned(&draft, S(WORLD "#5"))); /* minted ids are never tombstoned: they are never reused */
  CHECK_INT(sprout_draft_held(&draft), f.state->instance_count - 5);
  {
    sprout_stored_instance again;
    memset(&again, 0, sizeof again);
    again.id = S(YARD ".press");
    again.made = SPROUT_MADE_DECLARED;
    CHECK_INT(sprout_draft_add(&draft, &again), SPROUT_DRAFT_TAKEN);
    again.id = S(WORLD "#5");
    CHECK_INT(sprout_draft_add(&draft, &again), SPROUT_DRAFT_TAKEN);
  }
  finish(&f);
}

static void a_subtree_is_what_a_removal_would_take_and_takes_nothing(void) {
  fixture f;
  sprout_draft draft;
  sprout_str *found;
  size_t count;
  const char *want[] = {YARD, YARD ".wooden_rib", YARD ".bone_rib", YARD ".press", WORLD "#5"};
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK_INT(sprout_draft_subtree(&draft, S(YARD), &found, &count), SPROUT_DRAFT_OK);
  expect_ids(found, count, want, 5);
  CHECK(sprout_draft_instance(&draft, S(YARD ".press")) != NULL);
  CHECK(!sprout_draft_tombstoned(&draft, S(YARD)));
  finish(&f);
}

static void what_a_removal_took_stays_readable_for_the_rest_of_the_turn_and_is_not_an_instance(void) {
  fixture f;
  sprout_draft draft;
  const sprout_str *removed;
  size_t count;
  const sprout_stored_instance *kept;
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  CHECK(sprout_draft_destroyed(&draft, S(YARD ".press")) == NULL);
  CHECK_INT(sprout_draft_remove(&draft, S(YARD), &removed, &count), SPROUT_DRAFT_OK);
  kept = sprout_draft_destroyed(&draft, S(YARD ".press"));
  CHECK(kept != NULL);
  CHECK(kept != NULL && kept->kind != NULL && kept->has_container);
  CHECK(sprout_draft_instance(&draft, S(YARD ".press")) == NULL);
  /* A dormant record is no instance, so none is kept to read. */
  CHECK(sprout_draft_destroyed(&draft, S(WORLD "#5")) == NULL);
  finish(&f);
}

static void a_commit_applies_the_turn_sorted_says_what_changed_and_closes_the_draft(void) {
  fixture f;
  sprout_draft draft;
  sprout_changes changes;
  sprout_stored_instance changed;
  sprout_stored_visitor visitor;
  sprout_str yard = S(YARD), id;
  sprout_stored_instance spawn;
  const sprout_str *removed;
  size_t count;
  const char *wrote[] = {WORLD "#7", ROOM, ROOM ".cat"};
  const char *gone[] = {WORLD "#5", YARD, YARD ".bone_rib", YARD ".press", YARD ".wooden_rib"};
  const char *buried[] = {YARD, YARD ".bone_rib", YARD ".press", YARD ".wooden_rib"};
  begin(&f);
  sprout_draft_open(&draft, &f.turn, f.world, f.state);
  changed = *sprout_draft_instance(&draft, S(ROOM));
  changed.last_tick = 1790099999;
  CHECK_INT(sprout_draft_write(&draft, &changed), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_place(&draft, S(ROOM ".cat"), &yard), SPROUT_DRAFT_OK); /* serial 6 */
  CHECK_INT(sprout_draft_mint(&draft, &id), SPROUT_DRAFT_OK);                     /* serial 7 */
  memset(&spawn, 0, sizeof spawn);
  spawn.id = id;
  spawn.made = SPROUT_MADE_SPAWNED;
  spawn.made_kind = S(WORLD ".Cat");
  spawn.has_container = true;
  spawn.container = S(ROOM);
  spawn.has_arrival = true;
  spawn.arrival = 7;
  CHECK_INT(sprout_draft_add(&draft, &spawn), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_place(&draft, S(ROOM ".cat"), &(sprout_str){WORLD, strlen(WORLD)}), SPROUT_DRAFT_OK); /* serial 8 */
  CHECK_INT(sprout_draft_remove(&draft, S(YARD), &removed, &count), SPROUT_DRAFT_OK);
  visitor = *sprout_draft_visitor(&draft, S("v-8f2c"));
  visitor.nickname = S("Marta Ann");
  CHECK_INT(sprout_draft_put_visitor(&draft, &visitor), SPROUT_DRAFT_OK);
  CHECK_INT(sprout_draft_commit(&draft, &changes), SPROUT_DRAFT_OK);
  CHECK_INT(changes.serial, 8);
  expect_ids(changes.removed, changes.removed_count, gone, 5);
  expect_ids(changes.tombstoned, changes.tombstoned_count, buried, 4);
  CHECK_INT(changes.visitor_count, 1);
  expect_ids(changes.written, changes.written_count, wrote, 3);
  CHECK(sprout_state_find(f.state, S(YARD)) == NULL);
  CHECK(sprout_state_find(f.state, S(WORLD "#7")) != NULL);
  CHECK(sprout_state_find(f.state, S(ROOM))->last_tick == 1790099999);
  CHECK(sprout_state_tombstoned(f.state, S(YARD ".press")));
  CHECK_INT(f.state->serial, 8);
  CHECK_BYTES(f.state->visitors[0].nickname.bytes, f.state->visitors[0].nickname.length, "Marta Ann");
  CHECK(f.state->instances_sorted);
  {
    size_t i;
    for (i = 1; i < f.state->instance_count; i++)
      CHECK(sprout_str_compare(f.state->instances[i - 1].id, f.state->instances[i].id) < 0);
    for (i = 1; i < f.state->tombstone_count; i++)
      CHECK(sprout_str_compare(f.state->tombstones[i - 1], f.state->tombstones[i]) < 0);
  }
  CHECK_INT(sprout_draft_write(&draft, &changed), SPROUT_DRAFT_CLOSED);
  CHECK_INT(sprout_draft_mint(&draft, &id), SPROUT_DRAFT_CLOSED);
  CHECK_INT(sprout_draft_commit(&draft, &changes), SPROUT_DRAFT_CLOSED);
  {
    const char *bytes;
    size_t length;
    sprout_refusal read_why;
    sprout_state *again = NULL;
    CHECK_INT(sprout_state_write(f.state, &bytes, &length), SPROUT_OK);
    CHECK_INT(sprout_state_read(&f.host, bytes, length, &again, &read_why), SPROUT_OK);
    if (again != NULL) {
      const char *second;
      size_t second_length;
      CHECK_INT(sprout_state_write(again, &second, &second_length), SPROUT_OK);
      CHECK_BYTES(second, second_length, bytes);
      sprout_state_free(again);
    } else {
      fprintf(stderr, "committed state does not read back: %s\n", read_why.text);
      CHECK(false);
    }
  }
  finish(&f);
}

static void every_result_has_words(void) {
  int r;
  for (r = SPROUT_DRAFT_OK; r <= SPROUT_DRAFT_MOVED; r++) {
    const char *text = sprout_draft_text((sprout_draft_result)r);
    CHECK(text != NULL && strlen(text) > 10);
  }
  CHECK(strstr(sprout_draft_text(SPROUT_DRAFT_TAKEN), "never reused") != NULL);
}

static void a_turn_that_runs_out_of_memory_says_so_and_leaves_the_state_alone(void) {
  long pages;
  for (pages = 0; pages < 6; pages++) {
    fixture f;
    sprout_draft draft;
    sprout_str yard = S(YARD);
    const char *before, *after;
    size_t before_length, after_length;
    begin(&f);
    CHECK_INT(sprout_state_write(f.state, &before, &before_length), SPROUT_OK);
    f.host.page_bytes = 256;
    f.turn.host = &f.host;
    f.heap.refuse_after = f.heap.pages + pages;
    sprout_draft_open(&draft, &f.turn, f.world, f.state);
    {
      sprout_draft_result r = sprout_draft_place(&draft, S(ROOM ".cat"), &yard);
      CHECK(r == SPROUT_DRAFT_OK || r == SPROUT_DRAFT_NO_MEMORY);
    }
    sprout_arena_reset(&f.turn);
    f.heap.refuse_after = -1;
    CHECK_INT(sprout_state_write(f.state, &after, &after_length), SPROUT_OK);
    CHECK_BYTES(after, after_length, before);
    finish(&f);
  }
}

static void a_state_after_hundreds_of_committed_turns_is_no_bigger_than_after_a_few(void) {
  fixture f;
  size_t turn, held_early = 0;
  long pages_early = 0;
  begin(&f);
  for (turn = 1; turn <= 300; turn++) {
    sprout_draft draft;
    sprout_changes changes;
    sprout_stored_instance changed;
    sprout_stored_visitor visitor;
    sprout_str id;
    sprout_draft_open(&draft, &f.turn, f.world, f.state);
    changed = *sprout_draft_instance(&draft, S(ROOM));
    changed.has_last_tick = true;
    changed.last_tick = 1790000000 + turn;
    CHECK_INT(sprout_draft_write(&draft, &changed), SPROUT_DRAFT_OK);
    visitor = *sprout_draft_visitor(&draft, S("v-8f2c"));
    CHECK_INT(sprout_draft_put_visitor(&draft, &visitor), SPROUT_DRAFT_OK);
    /* A spawn made and destroyed in the same turn leaves nothing behind but its serial. */
    CHECK_INT(sprout_draft_mint(&draft, &id), SPROUT_DRAFT_OK);
    CHECK_INT(sprout_draft_commit(&draft, &changes), SPROUT_DRAFT_OK);
    sprout_arena_reset(&f.turn);
    if (turn == 20) {
      held_early = f.state->arena.held;
      pages_early = f.heap.pages;
    }
  }
  CHECK(held_early > 0);
  CHECK(f.state->arena.held <= held_early + 4096);
  CHECK(f.heap.pages <= pages_early);
  CHECK(sprout_state_find(f.state, S(ROOM))->last_tick == 1790000300);
  CHECK_INT(f.state->serial, 5 + 300);
  finish(&f);
}

int main(void) {
  RUN(reads_go_through_to_the_state_and_dormant_records_are_not_instances);
  RUN(contents_come_unmoved_declared_objects_by_rank_then_arrivals_by_serial);
  RUN(a_write_is_held_until_commit_and_dropping_the_turn_leaves_the_state_as_it_was);
  RUN(a_record_cannot_be_moved_by_writing_it);
  RUN(placing_moves_an_instance_last_under_a_new_arrival_serial);
  RUN(nothing_goes_inside_itself_or_what_it_holds_and_the_world_stays_put);
  RUN(a_visitor_going_away_keeps_the_serial_it_last_arrived_under);
  RUN(a_spawn_takes_an_id_nothing_has_had_and_arrives_where_it_is_put);
  RUN(two_drafts_on_one_state_mint_the_same_ids);
  RUN(removing_takes_everything_inside_tombstones_declared_objects_and_never_the_world);
  RUN(a_subtree_is_what_a_removal_would_take_and_takes_nothing);
  RUN(what_a_removal_took_stays_readable_for_the_rest_of_the_turn_and_is_not_an_instance);
  RUN(a_commit_applies_the_turn_sorted_says_what_changed_and_closes_the_draft);
  RUN(a_state_after_hundreds_of_committed_turns_is_no_bigger_than_after_a_few);
  RUN(every_result_has_words);
  RUN(a_turn_that_runs_out_of_memory_says_so_and_leaves_the_state_alone);
  return REPORT();
}
