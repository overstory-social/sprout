/*
 * libc.c's functions against what the C standard says of each, built with it for wasm32 (build.sh) and
 * run by engine.test.mjs: `sw_libc_failures` is how many checks failed, 0 when all hold.
 */
#include <string.h>

static int failures;

#define CHECK(holds) \
  do {               \
    if (!(holds)) failures++; \
  } while (0)

static int sign(int n) { return n < 0 ? -1 : n > 0 ? 1 : 0; }

__attribute__((export_name("sw_libc_failures"))) int sw_libc_failures(void) {
  char buffer[16];
  const char *text = "a,b,c";
  failures = 0;

  CHECK(strlen("") == 0);
  CHECK(strlen("abc") == 3);

  CHECK(strcmp("abc", "abc") == 0);
  CHECK(sign(strcmp("abc", "abd")) == -1);
  CHECK(sign(strcmp("abd", "abc")) == 1);
  CHECK(sign(strcmp("ab", "abc")) == -1);
  CHECK(sign(strcmp("\xc3\xa9", "z")) == 1); /* compared as unsigned bytes */

  CHECK(strncmp("abcx", "abcy", 3) == 0);
  CHECK(sign(strncmp("abcx", "abcy", 4)) == -1);
  CHECK(strncmp("ab", "ab", 10) == 0);
  CHECK(strncmp("a", "b", 0) == 0);

  CHECK(strchr(text, ',') == text + 1);
  CHECK(strchr(text, 'z') == NULL);
  CHECK(strchr(text, '\0') == text + 5);
  CHECK(strrchr(text, ',') == text + 3);
  CHECK(strrchr(text, 'z') == NULL);
  CHECK(strrchr(text, '\0') == text + 5);

  CHECK(memcmp("abc", "abc", 3) == 0);
  CHECK(sign(memcmp("abc", "abd", 3)) == -1);
  CHECK(sign(memcmp("\xff", "\x01", 1)) == 1); /* compared as unsigned bytes */
  CHECK(memcmp("a", "b", 0) == 0);

  CHECK(memset(buffer, 'x', 4) == buffer);
  CHECK(memcmp(buffer, "xxxx", 4) == 0);
  CHECK(memcpy(buffer, "hello", 6) == buffer);
  CHECK(strcmp(buffer, "hello") == 0);
  CHECK(memmove(buffer + 1, buffer, 5) == buffer + 1); /* overlapping, forwards */
  CHECK(memcmp(buffer, "hhello", 6) == 0);
  CHECK(memmove(buffer, buffer + 1, 5) == buffer); /* overlapping, backwards */
  CHECK(memcmp(buffer, "hello", 5) == 0);
  return failures;
}
