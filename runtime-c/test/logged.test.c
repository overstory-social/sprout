/*
 * Tests for src/logged.c: a turn's outcome as the JSON a host keeps. The entry is in the log's own shape, with
 * every effect at debug depth and, at play depth, their count and the SHA-256 of them read in code-unit order;
 * a command's also keeps its words, the step a line planned for it and its draw; every write turn's keeps what
 * its bodies did that nobody was told of; and a budget the log keeps left
 * unset is the host's defect (the spec's The runtime > The log, Effects, Faults). The replay compares every entry with core's own.
 */
#include "logged.h"
#include "seeds.h"
#include "turn_fixture.h"

/* The text of `tree`, or of the entry the outcome leaves at `depth`, in `scratch`. */
static const char *text_of(sprout_arena *scratch, const sprout_json *tree) {
  const char *bytes = "";
  size_t length;
  if (tree == NULL || sprout_json_write(scratch, tree, &bytes, &length) != SPROUT_OK) return "";
  return bytes;
}

static const char *entry_text(sprout_arena *scratch, const sprout_host *host, const sprout_outcome *out,
                              sprout_log_depth depth) {
  const char *bytes = "";
  size_t length;
  if (sprout_log_write(host, out, depth, scratch, &bytes, &length) != SPROUT_OK) return "";
  return bytes;
}

static void hex_of(const char *bytes, size_t length, char out[65]) {
  static const char hex[] = "0123456789abcdef";
  unsigned char sum[32];
  size_t i;
  sprout_sha256(bytes, length, sum);
  for (i = 0; i < 32; i++) {
    out[2 * i] = hex[sum[i] >> 4];
    out[2 * i + 1] = hex[sum[i] & 15];
  }
  out[64] = '\0';
}

static void canonical_order_sorts_every_object_all_the_way_down(void) {
  turn_world w;
  sprout_arena scratch;
  sprout_json *tree;
  sprout_json_error error;
  const char *in = "{\"b\":1,\"a\":{\"d\":[{\"z\":1,\"y\":\"two\"}],\"c\":null}}";
  tw_open(&w, "turn-faults");
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  CHECK_INT(sprout_json_read(&scratch, in, strlen(in), &tree, &error), SPROUT_OK);
  CHECK_STR(text_of(&scratch, sprout_logged_canonical(&scratch, tree)), "{\"a\":{\"c\":null,\"d\":[{\"y\":\"two\",\"z\":1}]},\"b\":1}");
  sprout_arena_reset(&scratch);
  tw_close(&w);
}

static void the_play_digest_is_the_sha256_of_the_debug_effects_in_canonical_order(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  const char *canonical, *play;
  char digest[65], expected[128];
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  canonical = text_of(&scratch, sprout_logged_canonical(&scratch, sprout_logged_effects(&scratch, &out, true)));
  CHECK_STR(canonical, "[{\"actor\":\"turn_faults#1\",\"from\":\"turn_faults.porch\",\"kind\":\"described\",\"level\":\"prose\","
                       "\"paragraphs\":[\"A stone porch, and a steep stair going down.\"],\"to\":\"turn_faults#1\",\"visit\":\"v-marta\"}]");
  hex_of(canonical, strlen(canonical), digest);
  snprintf(expected, sizeof expected, "\"digest\":{\"count\":1,\"sha256\":\"%s\"}", digest);
  play = entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY);
  CHECK(strstr(play, expected) != NULL);
  CHECK(strstr(play, "\"effects\":[],") != NULL);
  CHECK(strncmp(play, "{\"kind\":\"arrival\",\"level\":\"info\",\"seed\":0,\"mayHold\":null,\"now\":0,\"budgets\":{\"steps\":50000,", 89) == 0);
  CHECK(strstr(play, "\"visit\":\"v-marta\",\"nickname\":\"Marta\",\"outcome\":\"admitted\",\"fault\":null") != NULL);
  /* At debug depth the effects are kept whole and there is no digest. */
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_DEBUG), "\"effects\":[{\"kind\":\"described\",\"level\":\"prose\"") != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_DEBUG), "digest") == NULL);
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_turn_that_said_nothing_digests_the_empty_list(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  tw_open(&w, "turn-faults");
  CHECK_INT(tw_run(&w, tw_input(SPROUT_TURN_MAINTENANCE, 0), 0, &out), SPROUT_OK);
  sprout_outcome_free(&out);
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "light", "porch.dud", 0, &out);
  sprout_outcome_free(&out);
  {
    sprout_turn_input wake = tw_input(SPROUT_TURN_WAKE, 100);
    wake.object = "turn_faults.porch.dud";
    wake.serial = tw_instance(&w, "turn_faults.porch.dud")->wakes[0].serial;
    CHECK_INT(tw_run(&w, wake, 0, &out), SPROUT_OK);
  }
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  /* A faulted wake says nothing in the world: SHA-256 of `[]`. */
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY),
                "\"digest\":{\"count\":0,\"sha256\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\"}") != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY),
               "\"object\":\"turn_faults.porch.dud\",\"serial\":") != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY),
               "\"fault\":{\"level\":\"error\",\"name\":\"IntegerOverflow\",\"detail\":\"2147483648 is outside the integer range, "
               "-2147483648 to 2147483647.\",\"object\":null,\"engine\":false,\"extension\":null}") != NULL);
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

/* A command's entry keeps the words, the step a line planned for it, the item it re-read and its draw, each null where it has none. */
static void a_command_s_entry_keeps_its_words_and_the_step_a_line_planned(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  sprout_turn_input typed = tw_input(SPROUT_TURN_COMMAND, 0), planned = tw_input(SPROUT_TURN_COMMAND, 0);
  sprout_filling filling;
  sprout_reading crack;
  char want[512];
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  typed.visit = "v-marta";
  typed.text = "xyzzy";
  typed.text_length = 5;
  CHECK_INT(tw_run(&w, typed, 7, &out), SPROUT_OK);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY),
               "{\"kind\":\"command\",\"level\":\"info\",\"seed\":7,") != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY),
               "\"visit\":\"v-marta\",\"text\":\"xyzzy\",\"planned\":null,\"reread\":null,\"drawn\":null,\"fault\":null,"
               "\"effects\":[],\"cutShort\":[],\"warnings\":[],\"digest\":{\"count\":1,") != NULL);
  sprout_outcome_free(&out);
  crack = tw_reading("turn_faults.crack", tw_person(&w, "v-marta"), &filling, "target", "turn_faults.porch.dud");
  planned.visit = "v-marta";
  planned.text = "crack dud";
  planned.text_length = 9;
  planned.planned = &crack;
  CHECK_INT(tw_run(&w, planned, 8, &out), SPROUT_OK);
  snprintf(want, sizeof want,
           "\"text\":\"crack dud\",\"planned\":{\"verb\":{\"library\":\"turn_faults\",\"name\":\"crack\"},\"actor\":\"%s\","
           "\"bindings\":[[\"target\",{\"object\":\"turn_faults.porch.dud\"}]]},\"reread\":null,\"drawn\":null,",
           tw_person(&w, "v-marta"));
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY), want) != NULL);
  sprout_outcome_free(&out);
  /* A line too costly to read faults its turn, which keeps the world's `fault` told to the one who typed, and cuts nobody short. */
  w.host.budgets.steps = (sprout_limit){true, 3};
  typed.text = "crack dud";
  typed.text_length = 9;
  CHECK_INT(tw_run(&w, typed, 9, &out), SPROUT_OK);
  CHECK(out.faulted);
  CHECK_STR(out.fault_name, "BudgetExhausted");
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_DEBUG),
               "\"drawn\":null,\"fault\":{\"level\":\"error\",\"name\":\"BudgetExhausted\",") != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_DEBUG), "\"effects\":[{\"kind\":\"notice\",") != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_DEBUG), "\"cutShort\":[],\"warnings\":[]}") != NULL);
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void a_budget_the_log_keeps_as_a_figure_left_unset_is_the_hosts_defect(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  sprout_host unset;
  const char *bytes;
  size_t length;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  /* The wall clock is a backstop a host may leave off, which the log keeps as null. */
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY), "\"wallClockMs\":null}") != NULL);
  unset = w.host;
  unset.budgets.steps.set = false;
  CHECK_INT(sprout_log_write(&unset, &out, SPROUT_LOG_PLAY, &scratch, &bytes, &length), SPROUT_BAD_HOST);
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

static void effects_in_the_languages_shape_carry_the_actor_and_where_their_words_were_written(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  const char *bytes;
  size_t length;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  CHECK_INT(sprout_effects_write(&out, &scratch, &bytes, &length), SPROUT_OK);
  CHECK_STR(bytes, "[{\"kind\":\"described\",\"from\":\"turn_faults.porch\",\"actor\":\"turn_faults#1\",\"to\":\"turn_faults#1\","
                   "\"visit\":\"v-marta\",\"paragraphs\":[\"A stone porch, and a steep stair going down.\"],"
                   "\"written\":[{\"line\":\"turn_faults.sprout:21:22\"}]}]");
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

/*
 * What a body did that nobody was told of is kept as a warning: a handler's refused `move`, with the guard and its
 * words as written, and a `send` to a name that reached nothing, with the name as written; neither is an effect.
 */
static void what_nobody_was_told_of_is_kept_as_a_warning(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  char want[512];
  tw_open(&w, "lost-work");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  CHECK_INT((int)out.warning_count, 0);
  sprout_outcome_free(&out);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  tw_do(&w, "v-marta", "touch", "glade.pedestal", 0, &out);
  CHECK(out.committed);
  CHECK_INT((int)out.effect_count, 1);
  CHECK_INT((int)out.warning_count, 1);
  CHECK_INT(out.warnings[0].kind, SPROUT_WARNING_UNREAD_REFUSAL);
  CHECK_STR(out.warnings[0].guard, "release");
  snprintf(want, sizeof want,
           "\"warnings\":[{\"level\":\"warning\",\"what\":\"unread-refusal\",\"by\":\"%s\","
           "\"item\":\"lost_work.glade.pedestal.gem\",\"to\":\"%s\",\"refuser\":\"lost_work.glade.pedestal\","
           "\"guard\":\"release\",\"words\":\"\\\"The pedestal keeps its gem.\\\"\"}]",
           tw_person(&w, "v-marta"), tw_person(&w, "v-marta"));
  /* Kept at either depth, since a replay does not give it back. */
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY), want) != NULL);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_DEBUG), want) != NULL);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "blow", "glade.horn", 0, &out);
  CHECK_INT((int)out.warning_count, 0);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "shoo", "glade.stag", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "blow", "glade.horn", 0, &out);
  CHECK(out.committed);
  CHECK(strstr(entry_text(&scratch, &w.host, &out, SPROUT_LOG_PLAY),
               "\"warnings\":[{\"level\":\"warning\",\"what\":\"lost-send\",\"by\":\"lost_work.glade.horn\","
               "\"target\":\"glade.stag\",\"message\":\"lost_work.called\"}]") != NULL);
  sprout_arena_reset(&scratch);
  sprout_outcome_free(&out);
  tw_close(&w);
}

int main(void) {
  RUN(canonical_order_sorts_every_object_all_the_way_down);
  RUN(the_play_digest_is_the_sha256_of_the_debug_effects_in_canonical_order);
  RUN(a_turn_that_said_nothing_digests_the_empty_list);
  RUN(a_command_s_entry_keeps_its_words_and_the_step_a_line_planned);
  RUN(a_budget_the_log_keeps_as_a_figure_left_unset_is_the_hosts_defect);
  RUN(effects_in_the_languages_shape_carry_the_actor_and_where_their_words_were_written);
  RUN(what_nobody_was_told_of_is_kept_as_a_warning);
  return REPORT();
}
