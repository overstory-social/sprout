/*
 * Tests for src/line.c (the spec's Parsing > Sequences, again and all; Intents): a line's commands are split at
 * each `.` and each word `then`, and each command's turn is
 * followed by the turns it planned, a command `and` joined run with the turns it plans in turn, and a turn that
 * does not let the line go on ends all of it. The outcomes handed back are made up here, so the order alone is
 * under test; turn_command.test.c runs real lines.
 */
#include "check.h"
#include "line.h"

/* Checks that `text`'s commands are `expected`, `|` between them. */
static void parts_are(sprout_arena *arena, const char *text, const char *expected) {
  sprout_str *parts;
  size_t count, i, used = 0;
  char joined[256];
  CHECK_INT(sprout_line_parts(arena, (sprout_str){text, strlen(text)}, &parts, &count), SPROUT_OK);
  joined[0] = '\0';
  for (i = 0; i < count; i++) {
    CHECK_INT(parts[i].bytes[parts[i].length], '\0');
    used += (size_t)snprintf(joined + used, sizeof joined - used, "%s%.*s", i == 0 ? "" : "|", (int)parts[i].length,
                             parts[i].bytes);
  }
  CHECK_STR(joined, expected);
}

static void a_line_is_split_at_each_full_stop_and_each_word_then_blanks_dropped(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  parts_are(&arena, "take key then open cabinet", "take key|open cabinet");
  parts_are(&arena, "take key. open cabinet.", "take key|open cabinet");
  parts_are(&arena, "take key.. then Then drop key", "take key|drop key");
  parts_are(&arena, "thence north", "thence north");
  parts_are(&arena, "go north THEN_ south", "go north THEN_ south");
  parts_are(&arena, "a\xc2\xa0then\xc2\xa0" "b", "a|b");
  parts_are(&arena, "\xc2\xa0 look \xe3\x80\x80", "look");
  sprout_arena_reset(&arena);
}

static void a_line_with_no_command_is_read_whole(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  parts_are(&arena, ".", ".");
  parts_are(&arena, "", "");
  parts_are(&arena, " then ", " then ");
  sprout_arena_reset(&arena);
}

/* ---- the turns, with outcomes made up ---- */

static const sprout_reading P1 = {"sprout.take", "w.marta", 0, NULL};
static const sprout_reading P2 = {"sprout.drop", "w.marta", 0, NULL};
static const sprout_reading P3 = {"sprout.look", "w.marta", 0, NULL};

/* What each turn comes to, by what it was handed: the words or the planned verb. */
typedef struct scripted {
  const char *handed;
  bool goes_on;
  size_t next_count;
  sprout_following next[3];
} scripted;

/*
 * Runs `text` through the line, answering each turn from `script` (a turn not in it goes on and plans nothing), and
 * writes what each turn was handed, `|` between them, a planned turn as `text+verb`.
 */
static void runs_as(const char *text, const scripted *script, size_t count, const char *expected) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_commands line;
  sprout_turn_input input;
  sprout_outcome last;
  char seen[512];
  size_t used = 0, turns = 0;
  bool more = true;
  sprout_arena_init(&arena, &host);
  seen[0] = '\0';
  CHECK_INT(sprout_line_begin(&line, &arena, "visit:Marta", text, strlen(text)), SPROUT_OK);
  CHECK_INT(sprout_line_next(&line, NULL, &input, &more), SPROUT_OK);
  while (more && turns++ < 20) {
    char handed[128];
    size_t i;
    CHECK_INT(input.kind, SPROUT_TURN_COMMAND);
    CHECK_STR(input.visit, "visit:Marta");
    snprintf(handed, sizeof handed, "%.*s%s%s", (int)input.text_length, input.text, input.planned == NULL ? "" : "+",
             input.planned == NULL ? "" : input.planned->verb);
    used += (size_t)snprintf(seen + used, sizeof seen - used, "%s%s", used == 0 ? "" : "|", handed);
    memset(&last, 0, sizeof last);
    last.committed = true;
    last.goes_on = true;
    for (i = 0; i < count; i++)
      if (strcmp(script[i].handed, handed) == 0) {
        last.goes_on = script[i].goes_on;
        last.next_count = script[i].next_count;
        last.next = script[i].next;
      }
    CHECK_INT(sprout_line_next(&line, &last, &input, &more), SPROUT_OK);
  }
  CHECK_STR(seen, expected);
  sprout_arena_reset(&arena);
}

static void each_command_is_a_turn_in_order(void) {
  runs_as("take pin then drop pin", NULL, 0, "take pin|drop pin");
  runs_as("look", NULL, 0, "look");
}

static void a_command_s_planned_turns_follow_it_before_the_line_s_next_command(void) {
  const scripted script[] = {
      {"take pin and key", true, 2, {{&P1, NULL, NULL}, {&P2, NULL, NULL}}},
  };
  runs_as("take pin and key then look", script, 1,
          "take pin and key|take pin and key+sprout.take|take pin and key+sprout.drop|look");
}

static void a_joined_command_runs_with_the_turns_it_plans_in_turn(void) {
  const scripted script[] = {
      {"a", true, 3, {{&P1, NULL, NULL}, {NULL, NULL, "b"}, {&P2, NULL, NULL}}},
      {"b", true, 1, {{&P3, NULL, NULL}}},
  };
  runs_as("a. c", script, 2, "a|a+sprout.take|b|b+sprout.look|a+sprout.drop|c");
}

static void a_turn_that_does_not_let_the_line_go_on_ends_all_of_it(void) {
  const scripted refused[] = {
      {"a", true, 2, {{&P1, NULL, NULL}, {&P2, NULL, NULL}}},
      {"a+sprout.take", false, 0, {{NULL, NULL, NULL}}},
  };
  const scripted joined[] = {
      {"a", true, 2, {{NULL, NULL, "b"}, {&P2, NULL, NULL}}},
      {"b", false, 0, {{NULL, NULL, NULL}}},
  };
  const scripted first[] = {
      {"a", false, 1, {{&P1, NULL, NULL}}},
  };
  runs_as("a then c", refused, 2, "a|a+sprout.take");
  runs_as("a then c", joined, 2, "a|b");
  runs_as("a then c", first, 1, "a");
}

/* Whether the line goes on is asked of the command's own last turn: a joined command's that let it go on leaves it so. */
static void a_joined_command_that_went_on_leaves_the_line_as_its_command_left_it(void) {
  const scripted script[] = {
      {"a", true, 2, {{NULL, NULL, "b"}, {&P2, NULL, NULL}}},
  };
  runs_as("a", script, 1, "a|b|a+sprout.drop");
}

static void what_a_turn_planned_outlives_its_outcome(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_commands line;
  sprout_turn_input input;
  sprout_outcome last;
  sprout_following next[1];
  sprout_filling filling;
  sprout_reading planned;
  char role[8] = "target", id[16] = "w.pin";
  sprout_reread reread;
  char words[8] = "pin";
  bool more;
  sprout_arena_init(&arena, &host);
  memset(&filling, 0, sizeof filling);
  filling.role = role;
  filling.binds = SPROUT_FILL_OBJECT;
  filling.id = id;
  planned = P1;
  planned.filling_count = 1;
  planned.fillings = &filling;
  memset(&reread, 0, sizeof reread);
  reread.role = role;
  reread.words = words;
  memset(next, 0, sizeof next);
  next[0].planned = &planned;
  next[0].reread = &reread;
  memset(&last, 0, sizeof last);
  last.committed = last.goes_on = true;
  last.next = next;
  last.next_count = 1;
  CHECK_INT(sprout_line_begin(&line, &arena, "visit:Marta", "take pin", 8), SPROUT_OK);
  CHECK_INT(sprout_line_next(&line, NULL, &input, &more), SPROUT_OK);
  CHECK_INT(sprout_line_next(&line, &last, &input, &more), SPROUT_OK);
  memset(role, 0, sizeof role);
  memset(id, 0, sizeof id);
  memset(words, 0, sizeof words);
  CHECK(more);
  CHECK(input.planned != NULL && input.planned != &planned);
  CHECK_STR(input.planned->fillings[0].role, "target");
  CHECK_STR(input.planned->fillings[0].id, "w.pin");
  CHECK(input.reread != NULL);
  CHECK_STR(input.reread->words, "pin");
  CHECK_INT(sprout_line_next(&line, NULL, &input, &more), SPROUT_BAD_INPUT);
  sprout_arena_reset(&arena);
}

int main(void) {
  RUN(a_line_is_split_at_each_full_stop_and_each_word_then_blanks_dropped);
  RUN(a_line_with_no_command_is_read_whole);
  RUN(each_command_is_a_turn_in_order);
  RUN(a_command_s_planned_turns_follow_it_before_the_line_s_next_command);
  RUN(a_joined_command_runs_with_the_turns_it_plans_in_turn);
  RUN(a_turn_that_does_not_let_the_line_go_on_ends_all_of_it);
  RUN(a_joined_command_that_went_on_leaves_the_line_as_its_command_left_it);
  RUN(what_a_turn_planned_outlives_its_outcome);
  return REPORT();
}
