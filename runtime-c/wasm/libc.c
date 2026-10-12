/*
 * The libc the runtime calls, for its freestanding WebAssembly build: the memory functions as the
 * bulk-memory instructions, and the string functions as plain loops. Nothing else is needed.
 */
#include <string.h>

void *memcpy(void *to, const void *from, size_t n) {
  __builtin_memcpy(to, from, n);
  return to;
}

void *memmove(void *to, const void *from, size_t n) {
  __builtin_memmove(to, from, n);
  return to;
}

void *memset(void *to, int byte, size_t n) {
  __builtin_memset(to, byte, n);
  return to;
}

int memcmp(const void *a, const void *b, size_t n) {
  const unsigned char *x = a, *y = b;
  for (; n > 0; n--, x++, y++)
    if (*x != *y) return *x - *y;
  return 0;
}

size_t strlen(const char *s) {
  const char *at = s;
  while (*at != '\0') at++;
  return (size_t)(at - s);
}

int strcmp(const char *a, const char *b) {
  for (; *a != '\0' && *a == *b; a++, b++) {
  }
  return (unsigned char)*a - (unsigned char)*b;
}

int strncmp(const char *a, const char *b, size_t n) {
  for (; n > 0; n--, a++, b++) {
    if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
    if (*a == '\0') return 0;
  }
  return 0;
}

char *strchr(const char *s, int c) {
  for (;; s++) {
    if (*s == (char)c) return (char *)s;
    if (*s == '\0') return NULL;
  }
}

char *strrchr(const char *s, int c) {
  const char *found = NULL;
  for (;; s++) {
    if (*s == (char)c) found = s;
    if (*s == '\0') return (char *)found;
  }
}
