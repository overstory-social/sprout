/* text.c: text built into a fixed buffer, never overrunning it. */
#include "support.h"
#include "text.h"

int main(void) {
  char bytes[12];
  text_buffer out;
  test_program("text");
  text_begin(&out, bytes, sizeof bytes);
  text_add(&out, "abc");
  text_add_number(&out, 0);
  text_add_number(&out, 4096);
  CHECK(strcmp(bytes, "abc04096") == 0, "%s", bytes);
  text_add(&out, "too long to fit");
  CHECK(strlen(bytes) == sizeof bytes - 1 && bytes[sizeof bytes - 1] == '\0', "%s", bytes);
  text_begin(&out, bytes, sizeof bytes);
  text_add_number(&out, 18446744073709551615ULL);
  CHECK(strcmp(bytes, "18446744073") == 0, "truncated: %s", bytes);
  text_begin(&out, bytes, 0);
  text_add(&out, "nothing fits");
  text_add_number(&out, 7);
  return finish();
}
