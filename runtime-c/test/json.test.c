/* Tests for src/json.c: the reader, the writer, and the stored world's canon round-tripped byte for byte. */
#include "json.h"
#include "check.h"

static sprout_json *read_ok(sprout_arena *arena, const char *text) {
  sprout_json *root = NULL;
  sprout_json_error error;
  sprout_status status = sprout_json_read(arena, text, strlen(text), &root, &error);
  if (status != SPROUT_OK) fprintf(stderr, "read failed: %s\n", error.text);
  CHECK_INT(status, SPROUT_OK);
  return root;
}

static void refused(sprout_arena *arena, const char *text, size_t line, size_t column, const char *words) {
  sprout_json *root = NULL;
  sprout_json_error error;
  memset(&error, 0, sizeof error);
  CHECK_INT(sprout_json_read(arena, text, strlen(text), &root, &error), SPROUT_BAD_INPUT);
  CHECK_INT(error.line, line);
  CHECK_INT(error.column, column);
  CHECK_STR(error.text, words);
}

static void the_stored_world_canon_reads_and_writes_back_byte_for_byte(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  size_t length, written;
  char *text = test_golden("stored-canon.json", &length);
  sprout_json *root;
  const char *out;
  sprout_arena_init(&arena, &host);
  while (length > 0 && (text[length - 1] == '\n' || text[length - 1] == ' ')) length--;
  text[length] = '\0';
  root = read_ok(&arena, text);
  CHECK_INT(sprout_json_write(&arena, root, &out, &written), SPROUT_OK);
  CHECK_BYTES(out, written, text);
  CHECK_STR(sprout_json_get(root, "world")->bytes, "printers_shop");
  CHECK_INT(sprout_json_get(root, "serial")->number, 4);
  CHECK_INT(sprout_json_get(root, "instances")->count, 5);
  CHECK_INT(sprout_json_get(root, "tombstones")->count, 1);
  sprout_arena_reset(&arena);
  free(text);
  CHECK_INT(heap.pages, 0);
}

static void scalars_read_as_themselves(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  sprout_arena_init(&arena, &host);
  CHECK_INT(read_ok(&arena, " null ")->kind, SPROUT_JSON_NULL);
  root = read_ok(&arena, "true");
  CHECK(root->kind == SPROUT_JSON_BOOL && root->boolean);
  root = read_ok(&arena, "false");
  CHECK(root->kind == SPROUT_JSON_BOOL && !root->boolean);
  root = read_ok(&arena, "-12");
  CHECK(root->kind == SPROUT_JSON_NUMBER && root->number == -12);
  root = read_ok(&arena, "2147483647");
  CHECK(root->number == 2147483647.0);
  root = read_ok(&arena, "9007199254740992");
  CHECK(root->number == 9007199254740992.0);
  root = read_ok(&arena, "-9007199254740992");
  CHECK(root->number == -9007199254740992.0);
  root = read_ok(&arena, "0");
  CHECK(root->number == 0);
  sprout_arena_reset(&arena);
}

static void strings_unescape_and_print_the_way_json_stringify_does(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  const char *out;
  size_t length;
  sprout_arena_init(&arena, &host);
  root = read_ok(&arena, "\"a\\\"b\\\\c\\/d\\n\\t\\u0001\\u00e9\\ud83d\\udd6f\"");
  CHECK_BYTES(root->bytes, root->length, "a\"b\\c/d\n\t\x01\xC3\xA9\xF0\x9F\x95\xAF");
  CHECK_INT(sprout_json_write(&arena, root, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "\"a\\\"b\\\\c/d\\n\\t\\u0001\xC3\xA9\xF0\x9F\x95\xAF\"");
  root = read_ok(&arena, "\"\\u0000x\"");
  CHECK_INT(root->length, 2);
  CHECK_INT(sprout_json_write(&arena, root, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "\"\\u0000x\"");
  sprout_arena_reset(&arena);
}

static void a_member_is_written_alone_as_its_value_and_a_root_as_itself(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  const char *out;
  size_t length;
  sprout_arena_init(&arena, &host);
  root = read_ok(&arena, "{\"a\":{\"b\":[1,{\"c\":2}]},\"d\":\"x\"}");
  CHECK_INT(sprout_json_write_value(&arena, sprout_json_get(root, "a"), &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"b\":[1,{\"c\":2}]}");
  CHECK_INT(sprout_json_write_value(&arena, sprout_json_get(root, "d"), &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "\"x\"");
  CHECK_INT(sprout_json_write_value(&arena, root, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"a\":{\"b\":[1,{\"c\":2}]},\"d\":\"x\"}");
  sprout_arena_reset(&arena);
}

static void containers_keep_order_parents_and_empties(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  const sprout_json *b;
  const char *out;
  size_t length;
  sprout_arena_init(&arena, &host);
  root = read_ok(&arena, "{\"z\":[1,[],{}],\"a\":{\"k\":null},\"e\":[ ],\"o\":{ }}");
  CHECK_INT(root->count, 4);
  CHECK_BYTES(root->items[0]->key, root->items[0]->key_length, "z");
  CHECK_BYTES(root->items[1]->key, root->items[1]->key_length, "a");
  b = sprout_json_get(root, "z");
  CHECK_INT(b->count, 3);
  CHECK(b->items[1]->kind == SPROUT_JSON_ARRAY && b->items[1]->count == 0);
  CHECK(b->items[2]->kind == SPROUT_JSON_OBJECT && b->items[2]->count == 0);
  CHECK(b->items[2]->parent == b && b->items[2]->index == 2);
  CHECK(sprout_json_get(root, "missing") == NULL);
  CHECK(sprout_json_get(b, "z") == NULL);
  CHECK_INT(sprout_json_write(&arena, root, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, "{\"z\":[1,[],{}],\"a\":{\"k\":null},\"e\":[],\"o\":{}}");
  root = read_ok(&arena, "{\"k\":1,\"k\":2}");
  CHECK_INT(sprout_json_get(root, "k")->number, 2);
  sprout_arena_reset(&arena);
}

static void nesting_is_bounded_by_memory_not_by_the_stack(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  enum { DEPTH = 200000 };
  char *text = (char *)malloc(2 * DEPTH + 2);
  const char *out;
  size_t length;
  sprout_json *root;
  sprout_json_error error;
  sprout_arena_init(&arena, &host);
  for (int i = 0; i < DEPTH; i++) {
    text[i] = '[';
    text[DEPTH + 1 + i] = ']';
  }
  text[DEPTH] = '0';
  text[2 * DEPTH + 1] = '\0';
  CHECK_INT(sprout_json_read(&arena, text, 2 * DEPTH + 1, &root, &error), SPROUT_OK);
  CHECK_INT(sprout_json_write(&arena, root, &out, &length), SPROUT_OK);
  CHECK_BYTES(out, length, text);
  sprout_arena_reset(&arena);
  free(text);
}

static void a_refusal_names_the_line_and_column_and_says_what_to_write(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_arena_init(&arena, &host);
  refused(&arena, "", 1, 1, "the text ends where a value was expected");
  refused(&arena, "{\"a\":1,}", 1, 8, "an object's member starts with its name in quotes");
  refused(&arena, "{\"a\" 1}", 1, 6, "a member's name is followed by a colon");
  refused(&arena, "[1 2]", 1, 4, "after an element comes a comma or a closing bracket");
  refused(&arena, "{\"a\":1 \"b\":2}", 1, 8, "after a member comes a comma or a closing brace");
  refused(&arena, "[1,\n  2,\n  ]", 3, 3, "this is not a value");
  refused(&arena, "[1", 1, 3, "the text ends inside an open array or object");
  refused(&arena, "1 2", 1, 3, "there is text after the value");
  refused(&arena, "\"abc", 1, 5, "a string is never closed");
  refused(&arena, "\"a\nb\"", 1, 3, "a string holds a raw control character; write it with a backslash escape");
  refused(&arena, "\"\\q\"", 1, 2, "a backslash in a string must be followed by one of \" \\ / b f n r t u");
  refused(&arena, "\"\\u12\"", 1, 2, "a \\u escape needs four hex digits");
  refused(&arena, "\"\\ud83d\"", 1, 2, "a \\u escape is half of a pair with no second half");
  refused(&arena, "\"\\udd6f\"", 1, 2, "a \\u escape is half of a pair with no first half");
  refused(&arena, "\"\xC3\"", 1, 2, "a string is not valid UTF-8");
  refused(&arena, "01", 1, 1, "a number does not start with a zero before more digits");
  refused(&arena, "-", 1, 1, "a number needs a digit here");
  refused(&arena, "1.5", 1, 1, "a number must be whole; write 3, not 3.5 or 3e0");
  refused(&arena, "[1,\n 2.0]", 2, 2, "a number must be whole; write 3, not 3.5 or 3e0");
  refused(&arena, "1e-3", 1, 1, "a number must be whole; write 3, not 3.5 or 3e0");
  refused(&arena, "1E3", 1, 1, "a number must be whole; write 3, not 3.5 or 3e0");
  refused(&arena, "1e300", 1, 1, "a number must be whole; write 3, not 3.5 or 3e0");
  refused(&arena, "-0.5", 1, 1, "a number must be whole; write 3, not 3.5 or 3e0");
  refused(&arena, "9007199254740993", 1, 1,
          "a number is too large to hold exactly; write one no larger than 9007199254740992");
  refused(&arena, "123456789012345678901234567890", 1, 1,
          "a number is too large to hold exactly; write one no larger than 9007199254740992");
  refused(&arena, "tru", 1, 1, "this is not a value");
  refused(&arena, "nul", 1, 1, "this is not a value");
  sprout_arena_reset(&arena);
}

static void the_writer_refuses_a_number_that_is_not_whole(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  const char *out;
  size_t length;
  sprout_json node;
  sprout_arena_init(&arena, &host);
  memset(&node, 0, sizeof node);
  node.kind = SPROUT_JSON_NUMBER;
  node.number = 0.5;
  CHECK_INT(sprout_json_write(&arena, &node, &out, &length), SPROUT_BAD_INPUT);
  sprout_arena_reset(&arena);
}

static void a_host_that_runs_out_of_memory_is_told_so_and_leaks_nothing(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  sprout_json_error error;
  const char *text = "{\"a\":[1,2,3,4,5,6,7,8,9],\"b\":\"a string long enough to need a second page of memory\"}";
  sprout_arena_init(&arena, &host);
  heap.refuse_after = 1;
  CHECK_INT(sprout_json_read(&arena, text, strlen(text), &root, &error), SPROUT_NO_MEMORY);
  sprout_arena_reset(&arena);
  CHECK_INT(heap.pages, 0);
}

int main(void) {
  RUN(the_stored_world_canon_reads_and_writes_back_byte_for_byte);
  RUN(scalars_read_as_themselves);
  RUN(strings_unescape_and_print_the_way_json_stringify_does);
  RUN(a_member_is_written_alone_as_its_value_and_a_root_as_itself);
  RUN(containers_keep_order_parents_and_empties);
  RUN(nesting_is_bounded_by_memory_not_by_the_stack);
  RUN(a_refusal_names_the_line_and_column_and_says_what_to_write);
  RUN(the_writer_refuses_a_number_that_is_not_whole);
  RUN(a_host_that_runs_out_of_memory_is_told_so_and_leaks_nothing);
  return REPORT();
}
