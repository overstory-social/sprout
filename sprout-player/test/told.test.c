/* told.c: the lines a call's turns told, kept after their outcomes are gone, and the words for kinds. */
#include "host/pd_host.h"
#include "support.h"
#include "told.h"

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
  told_list list;
  sprout_line lines[2];
  sprout_outcome outcome;
  int i;
  begin("collect");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  memset(&list, 0, sizeof list);
  memset(&outcome, 0, sizeof outcome);
  {
    char hall[] = "You see a hall.", click[] = "Click.", reader[] = "visit:player";
    lines[0] = (sprout_line){reader, 12, hall, 15, SPROUT_LINE_DESCRIBED, 0};
    lines[1] = (sprout_line){reader, 12, click, 6, SPROUT_LINE_SAID, 1};
    outcome.line_count = 2;
    outcome.lines = lines;
    CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "collecting");
    /* Many more than the list starts with. */
    for (i = 0; i < 20; i++) CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "more");
    /* The outcome's words are gone; the list's copies are not. */
    memset(hall, 'x', sizeof hall - 1);
    memset(reader, 'x', sizeof reader - 1);
  }
  outcome.faulted = true;
  outcome.fault_name = "BudgetExhausted";
  outcome.line_count = 0;
  CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "a fault");
  CHECK(told_add(&arena, &list, "visit:player", "notice", "Said by the player."), "adding");
  CHECK(list.count == 44, "%zu lines", list.count);
  CHECK(strcmp(list.items[0].reader, "visit:player") == 0 && list.items[0].reader_length == 12 &&
            strcmp(list.items[0].kind, "described") == 0 && strcmp(list.items[0].text, "You see a hall.") == 0 &&
            list.items[0].text_length == 15 && list.items[0].extension == NULL,
        "the first line, copied: %s", list.items[0].text);
  CHECK(strcmp(list.items[41].text, "Click.") == 0 && strcmp(list.items[41].kind, "said") == 0, "the last turn's last line");
  CHECK(strcmp(list.items[42].kind, "record") == 0 && strcmp(list.items[42].text, "BudgetExhausted") == 0, "the fault is named");
  CHECK(strcmp(list.items[43].kind, "notice") == 0 && strcmp(list.items[43].text, "Said by the player.") == 0, "the player's own line");
  sprout_arena_reset(&arena);
  end();
}

static void an_extensions_effect_carries_what_recorded_it_and_its_payload(void) {
  player_host host;
  sprout_arena arena;
  told_list list;
  sprout_line lines[2];
  sprout_told_effect effects[2];
  sprout_outcome outcome;
  begin("extension");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
  memset(&list, 0, sizeof list);
  memset(&outcome, 0, sizeof outcome);
  memset(effects, 0, sizeof effects);
  lines[0] = (sprout_line){"visit:player", 12, "A damp cellar.", 14, SPROUT_LINE_DESCRIBED, 0};
  lines[1] = (sprout_line){"visit:player", 12, "[cellar.png]", 12, SPROUT_LINE_EXTENSION, 1};
  effects[1].extension = "media";
  effects[1].statement = "show";
  effects[1].payload = (sprout_str){"{\"image\":\"cellar.png\"}", 22};
  outcome.line_count = 2;
  outcome.lines = lines;
  outcome.effect_count = 2;
  outcome.effects = effects;
  CHECK(told_collect(&arena, &list, &outcome, "visit:player"), "collecting");
  CHECK(list.count == 2 && list.items[0].extension == NULL && list.items[0].payload == NULL, "a line of words has no extension");
  CHECK(strcmp(list.items[1].kind, "extension") == 0 && strcmp(list.items[1].extension, "media") == 0 &&
            strcmp(list.items[1].statement, "show") == 0 && list.items[1].payload_length == 22 &&
            memcmp(list.items[1].payload, "{\"image\":\"cellar.png\"}", 22) == 0,
        "the effect, with its payload as JSON text");
  CHECK(list.items[1].payload != effects[1].payload.bytes, "copied, not pointed at");
  sprout_arena_reset(&arena);
  end();
}

int main(void) {
  test_program("told");
  the_names_of_kinds_are_the_ones_the_typescript_player_writes();
  the_lines_of_several_turns_are_kept_after_their_outcomes_are_gone();
  an_extensions_effect_carries_what_recorded_it_and_its_payload();
  return finish();
}
