/* reply.c: the JSON the registered functions hand back, and the lines a call's turns told. */
#include "files.h"
#include "pd_host.h"
#include "reply.h"
#include "support.h"

static void a_reply_is_built_and_written_in_canonical_form(void) {
  player_host host;
  sprout_arena arena;
  jb builder;
  sprout_json *root, *list;
  char *text = NULL;
  begin("build");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  jb_begin(&builder, &arena);
  root = jb_object(&builder, 6);
  list = jb_array(&builder, 2);
  jb_set(&builder, list, NULL, jb_string(&builder, "a"));
  jb_set(&builder, list, NULL, jb_number(&builder, 3));
  jb_set(&builder, root, "list", list);
  jb_set(&builder, root, "yes", jb_bool(&builder, true));
  jb_set(&builder, root, "no", jb_bool(&builder, false));
  jb_set(&builder, root, "nothing", jb_null(&builder));
  jb_set(&builder, root, "words", jb_str(&builder, (sprout_str){"quote \" and \xe2\x80\xa6", 15}));
  CHECK(jb_finish(&builder, &fake->api, root, &text), "finishing");
  CHECK(text != NULL && strcmp(text, "{\"list\":[\"a\",3],\"yes\":true,\"no\":false,\"nothing\":null,"
                                     "\"words\":\"quote \\\" and \xe2\x80\xa6\"}") == 0, "%s", text);
  player_free(&fake->api, text);
  sprout_arena_reset(&arena);
  end();
}

static void a_page_the_host_refuses_fails_the_reply_and_not_the_player(void) {
  jb builder;
  sprout_arena arena;
  player_host host;
  sprout_json *root;
  char *text = NULL;
  begin("refused");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  jb_begin(&builder, &arena);
  jb_set(&builder, NULL, "x", jb_null(&builder));
  CHECK(!builder.ok, "adding to nothing is a failure");
  root = jb_object(&builder, 1);
  CHECK(!jb_finish(&builder, &fake->api, root, &text) && text == NULL, "a failed builder writes nothing");
  sprout_arena_reset(&arena);
  end();
}

static void the_names_of_kinds_are_the_ones_the_typescript_player_writes(void) {
  CHECK(strcmp(line_kind_name(SPROUT_LINE_SAID), "said") == 0 && strcmp(line_kind_name(SPROUT_LINE_TOLD), "told") == 0 &&
            strcmp(line_kind_name(SPROUT_LINE_REFUSED), "refused") == 0 &&
            strcmp(line_kind_name(SPROUT_LINE_DESCRIBED), "described") == 0 &&
            strcmp(line_kind_name(SPROUT_LINE_NOTICE), "notice") == 0 &&
            strcmp(line_kind_name(SPROUT_LINE_EXTENSION), "extension") == 0, "line kinds");
  CHECK(strcmp(turn_kind_name(SPROUT_TURN_COMMAND), "command") == 0 && strcmp(turn_kind_name(SPROUT_TURN_TICK), "tick") == 0 &&
            strcmp(turn_kind_name(SPROUT_TURN_WAKE), "wake") == 0 &&
            strcmp(turn_kind_name(SPROUT_TURN_MAINTENANCE), "maintenance") == 0 &&
            strcmp(turn_kind_name(SPROUT_TURN_POLL), "poll") == 0 &&
            strcmp(turn_kind_name(SPROUT_TURN_ARRIVAL), "arrival") == 0 &&
            strcmp(turn_kind_name(SPROUT_TURN_DEPARTURE), "departure") == 0, "turn kinds");
  CHECK(strcmp(result_name(SPROUT_RESULT_DONE), "done") == 0 && strcmp(result_name(SPROUT_RESULT_FAULTED), "faulted") == 0 &&
            strcmp(result_name(SPROUT_RESULT_REFUSED), "refused") == 0 && strcmp(result_name(SPROUT_RESULT_CLOSED), "closed") == 0 &&
            strcmp(result_name(SPROUT_RESULT_IDLE), "idle") == 0, "results");
}

static void the_lines_of_several_turns_are_kept_after_their_outcomes_are_gone(void) {
  player_host host;
  sprout_arena arena;
  jb builder;
  told_list list;
  sprout_line lines[2];
  sprout_outcome outcome;
  char *text = NULL;
  begin("told");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  jb_begin(&builder, &arena);
  memset(&list, 0, sizeof list);
  memset(&outcome, 0, sizeof outcome);
  memset(lines, 0, sizeof lines);
  lines[0] = (sprout_line){"visit:player", 12, "You see a hall.", 15, SPROUT_LINE_DESCRIBED, 0};
  lines[1] = (sprout_line){"visit:player", 12, "Click.", 6, SPROUT_LINE_SAID, 1};
  outcome.line_count = 2;
  outcome.lines = lines;
  CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "collecting");
  /* Many more than the list starts with, from outcomes that are gone by the time the reply is written. */
  {
    int i;
    for (i = 0; i < 20; i++) CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "more");
  }
  outcome.faulted = true;
  outcome.fault_name = "BudgetExhausted";
  outcome.line_count = 0;
  CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "a fault");
  CHECK(told_add(&arena, &list, "visit:player", "notice", "Said by the player."), "adding");
  CHECK(list.count == 44, "%zu lines", list.count);
  memset(lines, 0, sizeof lines);
  {
    sprout_json *array = jb_told(&builder, &list);
    CHECK(array->count == list.count, "every line is in the array");
    CHECK(jb_finish(&builder, &fake->api, array, &text), "finishing");
    CHECK(HAS(text, "{\"reader\":\"visit:player\",\"kind\":\"described\",\"text\":\"You see a hall.\"}"), "%.200s", text);
    CHECK(HAS(text, "{\"reader\":\"visit:player\",\"kind\":\"record\",\"text\":\"BudgetExhausted\"}"), "the fault is named");
    CHECK(HAS(text, "\"kind\":\"notice\",\"text\":\"Said by the player.\""), "the player's own line");
  }
  player_free(&fake->api, text);
  sprout_arena_reset(&arena);
  end();
}

int main(void) {
  test_program("reply");
  a_reply_is_built_and_written_in_canonical_form();
  a_page_the_host_refuses_fails_the_reply_and_not_the_player();
  the_names_of_kinds_are_the_ones_the_typescript_player_writes();
  the_lines_of_several_turns_are_kept_after_their_outcomes_are_gone();
  return finish();
}
