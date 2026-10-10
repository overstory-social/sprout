/*
 * Tests for src/stored_check.c: what the stored form's schema holds beyond
 * the shape of each record. A store that is well formed and inconsistent is
 * refused in a sentence that names the record and says what is wrong.
 */
#include "check.h"
#include "state.h"

#define HEAD "{\"world\":\"shop\",\"serial\":3,\"instances\":["
#define TAIL_NONE "],\"visitors\":[],\"tombstones\":[]}"
#define REST ",\"properties\":{},\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}"
#define WORLD_ROW "{\"id\":\"shop\",\"made\":{\"from\":\"world\"},\"container\":null,\"arrival\":null" REST
#define HALL_ROW "{\"id\":\"shop.hall\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null" REST
#define VISITOR_ROW(id) "{\"id\":\"" id "\",\"made\":{\"from\":\"visitor\"},\"container\":\"shop.hall\",\"arrival\":1" REST
#define VISITOR(visit, instance) \
  "{\"visit\":\"" visit "\",\"nickname\":\"N\",\"instance\":\"" instance "\",\"lastPlace\":null,\"referents\":[],\"lastReading\":null}"

static void inconsistent(const char *text, const char *words) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  sprout_refusal why;
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_read_shape(&host, text, strlen(text), &state, &why), SPROUT_OK);
  if (state == NULL) return;
  CHECK_INT(sprout_state_check(state, &why), SPROUT_BAD_INPUT);
  CHECK_STR(why.text, words);
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

static void consistent(const char *text) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  sprout_refusal why;
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_read_shape(&host, text, strlen(text), &state, &why), SPROUT_OK);
  if (state == NULL) return;
  CHECK_INT(sprout_state_check(state, &why), SPROUT_OK);
  sprout_state_free(state);
}

static void a_well_formed_store_passes_and_so_does_an_empty_one(void) {
  consistent(HEAD WORLD_ROW "," HALL_ROW "," VISITOR_ROW("shop#1") "],\"visitors\":[" VISITOR("v", "shop#1")
             "],\"tombstones\":[\"shop.gone\"]}");
  consistent("{\"world\":\"shop\",\"serial\":0,\"instances\":[],\"visitors\":[],\"tombstones\":[]}");
}

static void an_id_must_be_one_of_the_worlds_forms_and_agree_with_how_it_was_made(void) {
  inconsistent(HEAD "{\"id\":\"inn.hall\",\"made\":{\"from\":\"declared\"},\"container\":null,\"arrival\":null" REST TAIL_NONE,
               "The stored state is not readable at instances[0].id: `inn.hall` is not an id in shop.");
  inconsistent(HEAD "{\"id\":\"shop#9\",\"made\":{\"from\":\"spawned\",\"kind\":\"k\"},\"container\":null,\"arrival\":null" REST TAIL_NONE,
               "The stored state is not readable at instances[0].id: `shop#9` was minted past the world's serial, shop#3.");
  inconsistent(HEAD "{\"id\":\"shop#1\",\"made\":{\"from\":\"declared\"},\"container\":null,\"arrival\":null" REST TAIL_NONE,
               "The stored state is not readable at instances[0].made: `shop#1` is a minted id, and made from declared takes a declared one.");
  inconsistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"visitor\"},\"container\":null,\"arrival\":null" REST TAIL_NONE,
               "The stored state is not readable at instances[0].made: `shop.a` is a declared id, and made from visitor takes a minted one.");
  inconsistent(HEAD HALL_ROW "," HALL_ROW TAIL_NONE,
               "The stored state is not readable at instances[1].id: `shop.hall` is stored twice.");
}

static void containers_links_wakes_memory_and_arrivals_are_checked_against_the_world(void) {
  inconsistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"declared\"},\"container\":\"elsewhere\",\"arrival\":null" REST TAIL_NONE,
               "The stored state is not readable at instances[0].container: `elsewhere` is not an id in shop.");
  inconsistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":9,\"properties\":{},"
               "\"links\":{},\"wakes\":[],\"memory\":{},\"lastTick\":null}" TAIL_NONE,
               "The stored state is not readable at instances[0].arrival: serial 9 is past the world's serial, 3.");
  inconsistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null,\"properties\":{},"
               "\"links\":{\"door\":\"shop#8\"},\"wakes\":[],\"memory\":{},\"lastTick\":null}" TAIL_NONE,
               "The stored state is not readable at instances[0].links: `shop#8` was minted past the world's serial, shop#3.");
  inconsistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null,\"properties\":{},"
               "\"links\":{},\"wakes\":[{\"serial\":4,\"askedAt\":0,\"dueAt\":1}],\"memory\":{},\"lastTick\":null}" TAIL_NONE,
               "The stored state is not readable at instances[0].wakes: serial 4 is past the world's serial, 3.");
  inconsistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null,\"properties\":{},"
               "\"links\":{},\"wakes\":[],\"memory\":{\"who\":{}},\"lastTick\":null}" TAIL_NONE,
               "The stored state is not readable at instances[0].memory: `who` is not an id in shop.");
}

static void a_visitor_and_its_instance_pair_one_to_one(void) {
  inconsistent(HEAD HALL_ROW "],\"visitors\":[" VISITOR("v", "shop#1") "],\"tombstones\":[]}",
               "The stored state is not readable at visitors[0].instance: `shop#1` is not a stored instance.");
  inconsistent(HEAD HALL_ROW "],\"visitors\":[" VISITOR("v", "shop.hall") "],\"tombstones\":[]}",
               "The stored state is not readable at visitors[0].instance: `shop.hall` is made from declared, and a visitor's instance is made from visitor.");
  inconsistent(HEAD VISITOR_ROW("shop#1") "],\"visitors\":[" VISITOR("v", "shop#1") "," VISITOR("v", "shop#2") "],\"tombstones\":[]}",
               "The stored state is not readable at visitors[1].visit: visit `v` is stored twice.");
  inconsistent(HEAD VISITOR_ROW("shop#1") "],\"visitors\":[" VISITOR("v", "shop#1") "," VISITOR("w", "shop#1") "],\"tombstones\":[]}",
               "The stored state is not readable at visitors[1].instance: `shop#1` is named by two visitors.");
  inconsistent(HEAD VISITOR_ROW("shop#1") "," VISITOR_ROW("shop#2") "],\"visitors\":[" VISITOR("v", "shop#1") "],\"tombstones\":[]}",
               "The stored state is not readable at instances[1].made: `shop#2` is made from visitor, and no visitor is stored for it.");
  inconsistent(HEAD VISITOR_ROW("shop#1") "],\"visitors\":[{\"visit\":\"v\",\"nickname\":\"N\",\"instance\":\"shop#1\",\"lastPlace\":\"nowhere\","
               "\"referents\":[],\"lastReading\":null}],\"tombstones\":[]}",
               "The stored state is not readable at visitors[0].lastPlace: `nowhere` is not an id in shop.");
  inconsistent(HEAD VISITOR_ROW("shop#1") "],\"visitors\":[{\"visit\":\"v\",\"nickname\":\"N\",\"instance\":\"shop#1\",\"lastPlace\":null,"
               "\"referents\":[\"shop#7\"],\"lastReading\":null}],\"tombstones\":[]}",
               "The stored state is not readable at visitors[0].referents: `shop#7` was minted past the world's serial, shop#3.");
  inconsistent(HEAD VISITOR_ROW("shop#1") "],\"visitors\":[{\"visit\":\"v\",\"nickname\":\"N\",\"instance\":\"shop#1\",\"lastPlace\":null,"
               "\"referents\":[],\"lastReading\":{\"verb\":{\"library\":\"sprout\",\"name\":\"go\"},\"bindings\":["
               "[\"way\",{\"exit\":{\"direction\":null,\"label\":\"\",\"to\":\"mars\"}}]]}}],\"tombstones\":[]}",
               "The stored state is not readable at visitors[0].lastReading.bindings: `mars` is not an id in shop.");
}

static void a_tombstone_is_a_declared_id_once_with_nothing_stored_under_or_inside_it(void) {
  inconsistent("{\"world\":\"shop\",\"serial\":3,\"instances\":[],\"visitors\":[],\"tombstones\":[\"shop#1\"]}",
               "The stored state is not readable at tombstones[0]: `shop#1` is not a declared object's id in shop.");
  inconsistent("{\"world\":\"shop\",\"serial\":3,\"instances\":[],\"visitors\":[],\"tombstones\":[\"shop.a\",\"shop.a\"]}",
               "The stored state is not readable at tombstones[1]: `shop.a` is a tombstone twice.");
  inconsistent(HEAD HALL_ROW "],\"visitors\":[],\"tombstones\":[\"shop.hall\"]}",
               "The stored state is not readable at instances[0].id: `shop.hall` was destroyed, and is stored again.");
  inconsistent(HEAD "{\"id\":\"shop.hall.cup\",\"made\":{\"from\":\"declared\"},\"container\":\"shop.hall\",\"arrival\":null" REST
               "],\"visitors\":[],\"tombstones\":[\"shop.hall\"]}",
               "The stored state is not readable at instances[0].container: `shop.hall.cup` is inside `shop.hall`, which was destroyed.");
  /* A link may still name what was destroyed: the absent rules read it. */
  consistent(HEAD "{\"id\":\"shop.a\",\"made\":{\"from\":\"declared\"},\"container\":\"shop\",\"arrival\":null,\"properties\":{},"
             "\"links\":{\"door\":\"shop.hall\"},\"wakes\":[],\"memory\":{},\"lastTick\":null}],\"visitors\":[],\"tombstones\":[\"shop.hall\"]}");
}

static void a_host_that_runs_out_of_memory_while_checking_is_told_so(void) {
  const char *text = HEAD WORLD_ROW "," HALL_ROW TAIL_NONE;
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_state *state = NULL;
  sprout_refusal why;
  host.page_bytes = 4096;
  CHECK_INT(sprout_state_read_shape(&host, text, strlen(text), &state, &why), SPROUT_OK);
  heap.refuse_after = heap.pages;
  CHECK_INT(sprout_state_check(state, &why), SPROUT_NO_MEMORY);
  heap.refuse_after = -1;
  sprout_state_free(state);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(a_well_formed_store_passes_and_so_does_an_empty_one);
  RUN(an_id_must_be_one_of_the_worlds_forms_and_agree_with_how_it_was_made);
  RUN(containers_links_wakes_memory_and_arrivals_are_checked_against_the_world);
  RUN(a_visitor_and_its_instance_pair_one_to_one);
  RUN(a_tombstone_is_a_declared_id_once_with_nothing_stored_under_or_inside_it);
  RUN(a_host_that_runs_out_of_memory_while_checking_is_told_so);
  return REPORT();
}
