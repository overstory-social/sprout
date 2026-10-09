/* Tests for src/values.c. */
#include <math.h>

#include "values.h"
#include "json.h"
#include "check.h"

static void number_text_matches_the_golden_cases(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_json *root;
  sprout_json_error error;
  size_t length;
  char *text = test_golden("numbers.json", &length);
  sprout_arena_init(&arena, &host);
  CHECK_INT(sprout_json_read(&arena, text, length, &root, &error), SPROUT_OK);
  CHECK(root->count >= 10);
  for (size_t i = 0; i < root->count; i++) {
    const sprout_json *one = root->items[i];
    const sprout_json *value = sprout_json_get(one, "value");
    const sprout_json *words = sprout_json_get(one, "text");
    char out[32];
    size_t count = 0;
    CHECK(sprout_number_text(value->number, out, sizeof out, &count));
    CHECK_BYTES(out, count, words->bytes);
  }
  sprout_arena_reset(&arena);
  free(text);
}

static void number_text_has_no_sign_on_zero_and_refuses_what_it_cannot_write_plainly(void) {
  char out[32];
  size_t count;
  CHECK(sprout_number_text(-0.0, out, sizeof out, &count));
  CHECK_BYTES(out, count, "0");
  CHECK(!sprout_number_text(1.5, out, sizeof out, &count));
  CHECK(!sprout_number_text(HUGE_VAL, out, sizeof out, &count));
  CHECK(!sprout_number_text(-HUGE_VAL, out, sizeof out, &count));
  CHECK(!sprout_number_text((double)NAN, out, sizeof out, &count));
  CHECK(!sprout_number_text(1e30, out, sizeof out, &count));
  CHECK(sprout_number_text(9007199254740992.0, out, sizeof out, &count));
  CHECK_BYTES(out, count, "9007199254740992");
}

static void number_text_refuses_a_buffer_it_would_overrun(void) {
  char out[4];
  size_t count;
  CHECK(sprout_number_text(999, out, sizeof out, &count));
  CHECK_BYTES(out, count, "999");
  CHECK(!sprout_number_text(1000, out, sizeof out, &count));
  CHECK(!sprout_number_text(-99, out, 3, &count));
  CHECK(sprout_number_text(-9, out, 3, &count));
}

static sprout_value str(sprout_arena *arena, const char *bytes) {
  sprout_value value;
  CHECK(sprout_string(arena, bytes, strlen(bytes), &value));
  return value;
}

static void a_string_keeps_its_length_in_utf16_code_units(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_value plain, accented, astral, mixed;
  sprout_arena_init(&arena, &host);
  plain = str(&arena, "lamp");
  accented = str(&arena, "caf\xC3\xA9");
  astral = str(&arena, "\xF0\x9F\x95\xAF");
  mixed = str(&arena, "a\xF0\x9F\x95\xAF\xE2\x82\xAC");
  CHECK_INT(plain.as.string.units, 4);
  CHECK_INT(accented.as.string.units, 4);
  CHECK_INT(accented.as.string.length, 5);
  CHECK_INT(astral.as.string.units, 2);
  CHECK_INT(astral.as.string.length, 4);
  CHECK_INT(mixed.as.string.units, 4);
  sprout_arena_reset(&arena);
}

static void bytes_that_are_not_utf8_are_not_a_string(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_value value;
  const char *bad[] = {"\x80", "\xC0\xAF", "\xE0\x80\x80", "\xED\xA0\x80", "\xF4\x90\x80\x80",
                       "\xC3", "\xE2\x82", "\xFF", "a\xF0\x9F\x95"};
  sprout_arena_init(&arena, &host);
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++)
    CHECK(!sprout_string(&arena, bad[i], strlen(bad[i]), &value));
  CHECK_INT(sprout_utf16_units("\xC3", 1), -1);
  CHECK_INT(sprout_utf16_units("", 0), 0);
  sprout_arena_reset(&arena);
}

static void strings_order_by_utf16_code_unit_not_by_byte(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_value a, b, astral, bmp;
  sprout_arena_init(&arena, &host);
  a = str(&arena, "apple");
  b = str(&arena, "banana");
  CHECK(sprout_string_compare(&a, &b) < 0);
  CHECK(sprout_string_compare(&b, &a) > 0);
  CHECK_INT(sprout_string_compare(&a, &a), 0);
  b = str(&arena, "app");
  CHECK(sprout_string_compare(&b, &a) < 0);
  CHECK(sprout_string_compare(&a, &b) > 0);
  /* U+1F56F is a surrogate pair starting at D83D; U+FF5E is the single unit FF5E.
     By UTF-16 the pair is lower; by UTF-8 bytes it is higher. */
  astral = str(&arena, "\xF0\x9F\x95\xAF");
  bmp = str(&arena, "\xEF\xBD\x9E");
  CHECK(sprout_string_compare(&astral, &bmp) < 0);
  CHECK(memcmp(astral.as.string.bytes, bmp.as.string.bytes, 3) > 0);
  sprout_arena_reset(&arena);
}

static void scalars_are_the_same_by_content_and_never_across_kinds(void) {
  test_heap heap;
  sprout_host host = test_host(&heap);
  sprout_arena arena;
  sprout_value a, b;
  sprout_arena_init(&arena, &host);
  a = sprout_number(3);
  b = sprout_number(3);
  CHECK(sprout_value_same(&a, &b));
  b = sprout_number(4);
  CHECK(!sprout_value_same(&a, &b));
  a = sprout_bool(true);
  b = sprout_bool(true);
  CHECK(sprout_value_same(&a, &b));
  b = sprout_bool(false);
  CHECK(!sprout_value_same(&a, &b));
  a = str(&arena, "oak");
  b = str(&arena, "oak");
  CHECK(sprout_value_same(&a, &b));
  b = str(&arena, "ash");
  CHECK(!sprout_value_same(&a, &b));
  b = sprout_number(1);
  CHECK(!sprout_value_same(&a, &b));
  a = sprout_bool(true);
  CHECK(!sprout_value_same(&a, &b));
  sprout_arena_reset(&arena);
}

static void types_are_the_same_when_their_kinds_and_elements_are(void) {
  sprout_type number = {SPROUT_NUMBER, NULL}, text = {SPROUT_STRING, NULL};
  sprout_type numbers = {SPROUT_LIST, &number}, texts = {SPROUT_LIST, &text};
  sprout_type numbers_again = {SPROUT_LIST, &number}, nested = {SPROUT_LIST, &numbers};
  CHECK(sprout_type_same(&number, &number));
  CHECK(!sprout_type_same(&number, &text));
  CHECK(sprout_type_same(&numbers, &numbers_again));
  CHECK(!sprout_type_same(&numbers, &texts));
  CHECK(!sprout_type_same(&numbers, &nested));
  CHECK(!sprout_type_same(&numbers, NULL));
}

int main(void) {
  RUN(number_text_matches_the_golden_cases);
  RUN(number_text_has_no_sign_on_zero_and_refuses_what_it_cannot_write_plainly);
  RUN(number_text_refuses_a_buffer_it_would_overrun);
  RUN(a_string_keeps_its_length_in_utf16_code_units);
  RUN(bytes_that_are_not_utf8_are_not_a_string);
  RUN(strings_order_by_utf16_code_unit_not_by_byte);
  RUN(scalars_are_the_same_by_content_and_never_across_kinds);
  RUN(types_are_the_same_when_their_kinds_and_elements_are);
  return REPORT();
}
