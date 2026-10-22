/*
 * Tests for src/catalogue_kinds.c: the kinds a cartridge declares, with their
 * properties' types and defaults, passages and plays, match the dump the
 * language's cartridge reader gives for every corpus world, and plays two kinds
 * hold alike are one array; a wildcard's `except` is read by each verb's full
 * identity; the contents a kind's body gives are found by path.
 */
#include "corpus.h"

/* A default as the dump writes it: {"number":8}, {"option":"cool"}, {"list":[...]} and so on. */
static size_t default_text(const sprout_literal *literal, char *out) {
  size_t at = 0, i;
  switch (literal->kind) {
    case SPROUT_LITERAL_BOOLEAN:
      return (size_t)sprintf(out, "{\"boolean\":%s}", literal->boolean ? "true" : "false");
    case SPROUT_LITERAL_NUMBER:
      return (size_t)sprintf(out, "{\"number\":%.0f}", literal->number);
    case SPROUT_LITERAL_STRING:
      return (size_t)sprintf(out, "{\"string\":\"%s\"}", literal->text);
    case SPROUT_LITERAL_OPTION:
      return (size_t)sprintf(out, "{\"option\":\"%s\"}", literal->text);
    case SPROUT_LITERAL_LIST:
      at += (size_t)sprintf(out + at, "{\"list\":[");
      for (i = 0; i < literal->count; i++) {
        if (i > 0) out[at++] = ',';
        at += default_text(&literal->items[i], out + at);
      }
      at += (size_t)sprintf(out + at, "]}");
      return at;
  }
  return 0;
}

static void expect_default(sprout_arena *arena, const sprout_literal *literal, const sprout_json *expected) {
  const char *want;
  size_t want_length;
  char got[2048];
  size_t got_length = default_text(literal, got);
  corpus_value_text(arena, expected, &want, &want_length);
  CHECK_BYTES(got, got_length, want);
}

static void check_kind(sprout_arena *arena, const sprout_kind_def *kind, const sprout_json *row) {
  size_t i;
  const sprout_json *properties = corpus_get(row, "properties");
  const sprout_json *order = corpus_get(row, "order");
  const sprout_json *passages = corpus_get(row, "passages");
  const sprout_json *plays = corpus_get(row, "plays");
  const sprout_json *capacity;
  CHECK_STR(kind->qualified, corpus_get(row, "name")->bytes);
  CHECK(kind->spawnable == corpus_get(row, "spawnable")->boolean);
  CHECK(kind->contains == corpus_get(row, "contains")->boolean);
  CHECK(kind->contains_actors == corpus_get(row, "containsActors")->boolean);
  CHECK(kind->roams == corpus_get(row, "roams")->boolean);
  capacity = corpus_get(row, "capacity");
  CHECK(kind->has_capacity == (capacity->kind != SPROUT_JSON_NULL));
  if (kind->has_capacity && capacity->kind != SPROUT_JSON_NULL) {
    CHECK(kind->capacity_limit == corpus_get(capacity, "limit")->number);
    CHECK_STR(kind->capacity_by, corpus_get(capacity, "by")->bytes);
  }
  CHECK_INT(kind->order_count, order->count);
  for (i = 0; i < kind->order_count && i < order->count; i++)
    CHECK_STR(kind->order[i], order->items[i]->bytes);
  CHECK_INT(kind->property_count, properties->count);
  for (i = 0; i < kind->property_count && i < properties->count; i++) {
    const sprout_json *p = properties->items[i];
    CHECK_STR(kind->properties[i]->name, corpus_get(p, "name")->bytes);
    CHECK_STR(kind->properties[i]->type->key, corpus_get(p, "type")->bytes);
    CHECK(kind->properties[i]->remembered == corpus_get(p, "remembered")->boolean);
    CHECK_STR(kind->properties[i]->origin, corpus_get(p, "origin")->bytes);
    expect_default(arena, &kind->properties[i]->default_value, corpus_get(p, "default"));
  }
  CHECK_INT(kind->passage_count, passages->count);
  for (i = 0; i < kind->passage_count && i < passages->count; i++)
    CHECK_STR(kind->passages[i].name, passages->items[i]->bytes);
  CHECK_INT(kind->play_group_count, plays->count);
  for (i = 0; i < kind->play_group_count && i < plays->count; i++) {
    const sprout_play_group *group = kind->plays[i];
    char key[256];
    size_t j, found = 0;
    CHECK_STR(group->key, plays->items[i]->items[0]->bytes);
    CHECK_INT(group->count, plays->items[i]->items[1]->number);
    /* The key's parts put back together are the key. */
    if (group->library == NULL) snprintf(key, sizeof key, "as %s for %s", group->role, group->verb);
    else snprintf(key, sizeof key, "as %s for %s.%s", group->role, group->library, group->verb);
    CHECK_STR(key, group->key);
    for (j = 0; j < kind->play_group_count; j++) found += kind->plays_by_verb[j] == group;
    CHECK_INT(found, 1);
  }
  /* By verb, then role, then a group for `any` before any library's. */
  for (i = 1; i < kind->play_group_count; i++) {
    const sprout_play_group *a = kind->plays_by_verb[i - 1], *b = kind->plays_by_verb[i];
    int order = strcmp(a->verb, b->verb);
    if (order == 0) order = strcmp(a->role, b->role);
    if (order == 0) order = a->library == NULL ? -1 : b->library == NULL ? 1 : strcmp(a->library, b->library);
    CHECK(order < 0);
  }
}

static void every_kind_of_every_corpus_world_matches_the_dump(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, i;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *kinds = corpus_get(dump->items[w], "kinds");
    sprout_world *world = corpus_load(dump->items[w]->key, &host);
    CHECK_INT(world->kind_count, kinds->count);
    for (i = 0; i < world->kind_count && i < kinds->count; i++)
      check_kind(&arena, world->kinds[i], kinds->items[i]);
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

/* Whether two groups run the same plays, by the nodes the cartridge holds them as. */
static bool same_plays(const sprout_play_group *a, const sprout_play_group *b) {
  size_t i;
  if (strcmp(a->key, b->key) != 0 || a->count != b->count) return false;
  for (i = 0; i < a->count; i++)
    if (a->plays[i].node != b->plays[i].node) return false;
  return true;
}

static void plays_two_kinds_hold_alike_are_one_record(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("standard-library", &host);
  size_t i, j, g, h, shared = 0;
  for (i = 0; i < world->kind_count; i++)
    for (j = i + 1; j < world->kind_count; j++)
      for (g = 0; g < world->kinds[i]->play_group_count; g++)
        for (h = 0; h < world->kinds[j]->play_group_count; h++) {
          const sprout_play_group *a = world->kinds[i]->plays[g], *b = world->kinds[j]->plays[h];
          if (!same_plays(a, b)) continue;
          CHECK(a == b);
          shared++;
        }
  /* A kind that composes another and adds no play of a role holds what it composed. */
  CHECK(shared > 0);
  sprout_world_free(world);
}

/* The kind of `world` with this qualified name; the test aborts if there is none. */
static const sprout_kind_def *kind_named(const sprout_world *world, const char *qualified) {
  size_t i;
  for (i = 0; i < world->kind_count; i++)
    if (strcmp(world->kinds[i]->qualified, qualified) == 0) return world->kinds[i];
  fprintf(stderr, "the world declares no kind `%s`\n", qualified);
  exit(2);
}

/* The one play `kind` writes under `key`; the test aborts if it writes none there. */
static const sprout_play *play_under(const sprout_kind_def *kind, const char *key) {
  size_t g;
  for (g = 0; g < kind->play_group_count; g++)
    if (strcmp(kind->plays[g]->key, key) == 0) return &kind->plays[g]->plays[kind->plays[g]->count - 1];
  fprintf(stderr, "`%s` writes nothing under `%s`\n", kind->qualified, key);
  exit(2);
}

static void a_wildcards_except_is_read_by_each_verbs_library_and_name(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("wildcard-except", &host);
  const sprout_play *illusion = play_under(kind_named(world, "wildcard_except.Illusion"), "as target for any");
  const sprout_play *frozen = play_under(kind_named(world, "wildcard_except.Freezable"), "as actor for any");
  const sprout_play *look = play_under(kind_named(world, "wildcard_except.Illusion"), "as target for sprout.examine");
  CHECK(illusion->any);
  CHECK_INT(illusion->except_count, 1);
  CHECK_STR(illusion->except[0].library, "sprout");
  CHECK_STR(illusion->except[0].name, "examine");
  CHECK_INT(frozen->except_count, 2);
  CHECK_STR(frozen->except[0].library, "sprout");
  CHECK_STR(frozen->except[0].name, "wait");
  CHECK_STR(frozen->except[1].library, "wildcard_except");
  CHECK_STR(frozen->except[1].name, "thaw");
  /* A play for one verb, and a wildcard that leaves nothing out, carry none. */
  CHECK_INT(look->except_count, 0);
  CHECK(look->except == NULL);
  sprout_world_free(world);
}

static void a_property_two_kinds_list_is_one_record(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("standard-library", &host);
  size_t i, j, p, q, shared = 0;
  for (i = 0; i < world->kind_count; i++)
    for (j = i + 1; j < world->kind_count; j++)
      for (p = 0; p < world->kinds[i]->property_count; p++)
        for (q = 0; q < world->kinds[j]->property_count; q++) {
          const sprout_property *a = world->kinds[i]->properties[p], *b = world->kinds[j]->properties[q];
          if (strcmp(a->name, b->name) != 0 || strcmp(a->origin, b->origin) != 0) continue;
          CHECK(a == b);
          shared++;
        }
  /* Every kind that composes sprout.Thing lists Thing's properties. */
  CHECK(shared > 0);
  sprout_world_free(world);
}

static void a_property_is_found_by_name_with_its_type_range_and_options(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  const sprout_kind_def *actor = sprout_world_kind(world, "sprout.Actor");
  const sprout_property *capacity = sprout_kind_property(actor, "capacity");
  CHECK(capacity != NULL);
  if (capacity != NULL) {
    CHECK_INT(capacity->type->kind, SPROUT_DECL_INTEGER);
    CHECK(capacity->type->min == -2147483648.0);
    CHECK(capacity->type->max == 2147483647.0);
    CHECK_INT(capacity->default_value.kind, SPROUT_LITERAL_NUMBER);
    CHECK(capacity->default_value.number == 8);
  }
  {
    size_t k, p;
    bool seen_symbol = false, seen_list = false;
    for (k = 0; k < world->kind_count; k++)
      for (p = 0; p < world->kinds[k]->property_count; p++) {
        const sprout_decl_type *type = world->kinds[k]->properties[p]->type;
        if (type->kind == SPROUT_DECL_SYMBOL) {
          seen_symbol = true;
          CHECK(type->option_count > 0);
        }
        if (type->kind == SPROUT_DECL_LIST) {
          seen_list = true;
          CHECK(type->element != NULL);
        }
      }
    CHECK(seen_symbol);
    CHECK(seen_list);
  }
  sprout_world_free(world);
}

static void the_world_and_visitor_kinds_are_never_spawnable(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("printers_shop", &host);
  size_t i;
  CHECK(world->world_kind != NULL && world->world_kind->composes_world);
  CHECK(world->visitor_kind != NULL && world->visitor_kind->composes_visitor);
  for (i = 0; i < world->kind_count; i++) {
    const sprout_kind_def *kind = world->kinds[i];
    CHECK(kind->spawnable == (!kind->composes_world && !kind->composes_visitor));
  }
  sprout_world_free(world);
}

static void the_contents_a_kind_gives_are_found_by_the_path_in_its_body(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("kind-contents", &host);
  const char *wick[] = {"wick"};
  const char *flame[] = {"wick", "flame"};
  const char *none[] = {"wax"};
  const sprout_content *found = sprout_world_content_at(world, "kind_contents.Lantern", wick, 1);
  const sprout_content *inner = sprout_world_content_at(world, "kind_contents.Lantern", flame, 2);
  CHECK(found != NULL);
  if (found != NULL) {
    CHECK_STR(found->giver, "kind_contents.Lantern");
    CHECK(found->kind != NULL);
    CHECK_INT(found->held_count, 1);
    CHECK(found->held_count == 1 && inner == &found->held[0]);
  }
  CHECK(inner != NULL);
  if (inner != NULL) CHECK_INT(inner->path_count, 2);
  CHECK(sprout_world_content_at(world, "kind_contents.Lantern", none, 1) == NULL);
  CHECK(sprout_world_content_at(world, "kind_contents.Nothing", wick, 1) == NULL);
  sprout_world_free(world);
}

int main(void) {
  RUN(every_kind_of_every_corpus_world_matches_the_dump);
  RUN(plays_two_kinds_hold_alike_are_one_record);
  RUN(a_wildcards_except_is_read_by_each_verbs_library_and_name);
  RUN(a_property_two_kinds_list_is_one_record);
  RUN(a_property_is_found_by_name_with_its_type_range_and_options);
  RUN(the_world_and_visitor_kinds_are_never_spawnable);
  RUN(the_contents_a_kind_gives_are_found_by_the_path_in_its_body);
  return REPORT();
}
