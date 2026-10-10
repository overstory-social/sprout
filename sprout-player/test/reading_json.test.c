/* reading_json.c: a reading as the sentence builder hands it over. */
#include "pd_host.h"
#include "reading_json.h"
#include "support.h"

static const char *parse_into(sprout_arena *arena, const char *json, sprout_reading *read, const char **text) {
  return reading_parse(arena, json, strlen(json), "chip_tree.visitor", read, text);
}

int main(void) {
  player_host host;
  sprout_arena arena;
  sprout_reading read;
  const char *text;
  test_program("reading_json");
  begin("reading");
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);

  CHECK(parse_into(&arena,
                   "{\"verb\":\"sprout.ask\",\"text\":\"ask guard about weather\",\"fillers\":["
                   "{\"role\":\"target\",\"binds\":\"object\",\"id\":\"w.guard\",\"name\":\"a guard\"},"
                   "{\"role\":\"topic\",\"binds\":\"value\",\"value\":\"weather\"}]}",
                   &read, &text) == NULL, "an ask");
  CHECK(strcmp(read.verb, "sprout.ask") == 0 && strcmp(read.actor, "chip_tree.visitor") == 0, "verb and actor");
  CHECK(read.filling_count == 2 && read.fillings[0].binds == SPROUT_FILL_OBJECT &&
            strcmp(read.fillings[0].id, "w.guard") == 0, "the object");
  CHECK(read.fillings[1].binds == SPROUT_FILL_TEXT && strcmp(read.fillings[1].text, "weather") == 0, "the word");
  CHECK(text != NULL && strcmp(text, "ask guard about weather") == 0, "the line");

  CHECK(parse_into(&arena,
                   "{\"verb\":\"w.turn\",\"fillers\":[{\"role\":\"notch\",\"binds\":\"value\",\"value\":7},"
                   "{\"role\":\"things\",\"binds\":\"set\",\"ids\":[\"a\",\"b\"]},"
                   "{\"role\":\"way\",\"binds\":\"exit\",\"direction\":\"north\",\"label\":\"to the yard\",\"to\":\"w.yard\"},"
                   "{\"role\":\"tool\",\"binds\":\"unbound\"}]}",
                   &read, &text) == NULL, "number, set, exit and unbound");
  CHECK(text == NULL, "no line");
  CHECK(read.fillings[0].binds == SPROUT_FILL_NUMBER && read.fillings[0].number == 7.0, "the number");
  CHECK(read.fillings[1].binds == SPROUT_FILL_SET && read.fillings[1].id_count == 2 &&
            strcmp(read.fillings[1].ids[1], "b") == 0, "the set");
  CHECK(read.fillings[2].binds == SPROUT_FILL_EXIT && strcmp(read.fillings[2].direction, "north") == 0 &&
            strcmp(read.fillings[2].id, "w.yard") == 0 && strcmp(read.fillings[2].label, "to the yard") == 0, "the exit");
  CHECK(read.fillings[3].binds == SPROUT_FILL_UNBOUND, "left out");

  CHECK(parse_into(&arena, "{\"verb\":\"w.link\",\"fillers\":[{\"role\":\"way\",\"binds\":\"exit\",\"direction\":null,"
                           "\"label\":\"the door\",\"to\":\"w.hall\"}]}", &read, &text) == NULL, "a link");
  CHECK(read.fillings[0].direction == NULL, "a link has no direction");

  CHECK(parse_into(&arena, "not json", &read, &text) != NULL, "not JSON");
  CHECK(parse_into(&arena, "[]", &read, &text) != NULL, "not an object");
  CHECK(parse_into(&arena, "{\"fillers\":[]}", &read, &text) != NULL, "no verb");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\"}", &read, &text) != NULL, "no fillers");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\"}]}", &read, &text) != NULL, "no binds");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"object\"}]}", &read, &text) != NULL, "an object with no id");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"set\",\"ids\":[1]}]}", &read, &text) != NULL, "a set of numbers");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"value\"}]}", &read, &text) != NULL, "a value with none");
  CHECK(parse_into(&arena, "{\"verb\":\"w.x\",\"fillers\":[{\"role\":\"a\",\"binds\":\"teleport\"}]}", &read, &text) != NULL, "an unknown way to bind");
  sprout_arena_reset(&arena);
  end();
  return finish();
}
