/*
 * The test runner: one header, no framework. A test file defines functions
 * of no arguments, runs them with RUN, and returns REPORT() from main, which
 * ctest reads as pass or fail. Test code may use libc; the library may not.
 */
#ifndef SPROUT_CHECK_H
#define SPROUT_CHECK_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sprout.h"

static int check_failures = 0;
static int check_count = 0;

#define CHECK(cond)                                                              \
  do {                                                                           \
    check_count++;                                                               \
    if (!(cond)) {                                                               \
      check_failures++;                                                          \
      fprintf(stderr, "%s:%d: failed: %s\n", __FILE__, __LINE__, #cond);         \
    }                                                                            \
  } while (0)

#define CHECK_INT(actual, expected)                                              \
  do {                                                                           \
    long long a_ = (long long)(actual), e_ = (long long)(expected);              \
    check_count++;                                                               \
    if (a_ != e_) {                                                              \
      check_failures++;                                                          \
      fprintf(stderr, "%s:%d: %s was %lld, expected %lld\n", __FILE__, __LINE__, \
              #actual, a_, e_);                                                  \
    }                                                                            \
  } while (0)

/* Compares a (pointer, length) pair with a C string. */
#define CHECK_BYTES(bytes, length, expected)                                     \
  do {                                                                           \
    const char *b_ = (bytes);                                                    \
    size_t n_ = (size_t)(length), x_ = strlen(expected);                         \
    check_count++;                                                               \
    if (n_ != x_ || memcmp(b_, (expected), x_) != 0) {                           \
      check_failures++;                                                          \
      fprintf(stderr, "%s:%d: %s was \"%.*s\", expected \"%s\"\n", __FILE__,     \
              __LINE__, #bytes, (int)n_, b_, (expected));                        \
    }                                                                            \
  } while (0)

#define CHECK_STR(actual, expected) CHECK_BYTES((actual), strlen(actual), (expected))

#define RUN(test)                                                                \
  do {                                                                           \
    int before_ = check_failures;                                                \
    test();                                                                      \
    fprintf(stderr, "%s %s\n", check_failures == before_ ? "ok  " : "FAIL", #test); \
  } while (0)

#define REPORT()                                                                 \
  (fprintf(stderr, "%d checks, %d failed\n", check_count, check_failures),      \
   check_failures == 0 ? 0 : 1)

/* A host over malloc that counts what it holds, so a test can see nothing leaks. */
typedef struct test_heap {
  long pages;
  long bytes;
  long refuse_after; /* alloc fails once this many pages are out; negative: never */
} test_heap;

static inline void *test_alloc(void *ctx, size_t bytes) {
  test_heap *heap = (test_heap *)ctx;
  void *block;
  if (heap->refuse_after >= 0 && heap->pages >= heap->refuse_after) return NULL;
  block = malloc(bytes);
  if (block != NULL) {
    heap->pages++;
    heap->bytes += (long)bytes;
  }
  return block;
}

static inline void test_release(void *ctx, void *block, size_t bytes) {
  test_heap *heap = (test_heap *)ctx;
  heap->pages--;
  heap->bytes -= (long)bytes;
  memset(block, 0xDD, bytes); /* a read of released memory sees garbage, with or without a sanitizer */
  free(block);
}

/* A host with small pages, so a test crosses page boundaries. */
static inline sprout_host test_host(test_heap *heap) {
  sprout_host host;
  memset(&host, 0, sizeof host);
  heap->pages = 0;
  heap->bytes = 0;
  heap->refuse_after = -1;
  host.ctx = heap;
  host.page_bytes = 128;
  host.alloc = test_alloc;
  host.release = test_release;
  return host;
}

/* A golden file from corpus/goldens, malloc'd and NUL-terminated; the test aborts if it is missing. */
static inline char *test_golden(const char *name, size_t *length) {
  char path[1024];
  FILE *file;
  char *bytes;
  long size;
  snprintf(path, sizeof path, "%s/%s", SPROUT_GOLDENS, name);
  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "cannot open golden %s\n", path);
    exit(2);
  }
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (char *)malloc((size_t)size + 1);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size) exit(2);
  bytes[size] = '\0';
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

#endif
