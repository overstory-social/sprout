/*
 * Tests for src/logged.c: a turn's outcome as the JSON a host keeps. The entry is in the log's own shape, with
 * every effect at debug depth and, at play depth, their count and the SHA-256 of them read in code-unit order;
 * a command has none until the runtime parses, and a budget the log keeps left unset is the host's defect (the
 * spec's The runtime > The log, Effects, Faults). The replay compares every entry with core's own.
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

static void a_command_has_no_entry_until_the_runtime_parses(void) {
  turn_world w;
  sprout_outcome out;
  sprout_arena scratch;
  const char *bytes;
  size_t length;
  tw_open(&w, "turn-faults");
  tw_arrive(&w, "v-marta", "Marta", 0, &out);
  sprout_outcome_free(&out);
  tw_do(&w, "v-marta", "crack", "porch.dud", 0, &out);
  CHECK(out.has_log);
  CHECK_INT(sprout_arena_init(&scratch, &w.host), SPROUT_OK);
  CHECK_INT(sprout_log_write(&w.host, &out, SPROUT_LOG_PLAY, &scratch, &bytes, &length), SPROUT_BAD_INPUT);
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

int main(void) {
  RUN(canonical_order_sorts_every_object_all_the_way_down);
  RUN(the_play_digest_is_the_sha256_of_the_debug_effects_in_canonical_order);
  RUN(a_turn_that_said_nothing_digests_the_empty_list);
  RUN(a_command_has_no_entry_until_the_runtime_parses);
  RUN(a_budget_the_log_keeps_as_a_figure_left_unset_is_the_hosts_defect);
  RUN(effects_in_the_languages_shape_carry_the_actor_and_where_their_words_were_written);
  return REPORT();
}
