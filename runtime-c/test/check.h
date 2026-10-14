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
#include "state.h"

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

/*
 * A source over bytes held in memory, as a host reading a file gives them: at
 * most `piece` bytes a read (all it is asked for when 0), and every read past
 * `fail_at` bytes refused when that is not negative.
 */
typedef struct test_source {
  const unsigned char *bytes;
  size_t length, at, piece;
  long fail_at;
  long reads;
} test_source;

static inline bool test_source_read(void *ctx, unsigned char *buffer, size_t bytes, size_t *got) {
  test_source *t = (test_source *)ctx;
  size_t n = t->length - t->at;
  t->reads++;
  if (t->fail_at >= 0 && t->at >= (size_t)t->fail_at) return false;
  if (n > bytes) n = bytes;
  if (t->piece > 0 && n > t->piece) n = t->piece;
  if (t->fail_at >= 0 && t->at + n > (size_t)t->fail_at) n = (size_t)t->fail_at - t->at;
  memcpy(buffer, t->bytes + t->at, n);
  t->at += n;
  *got = n;
  return true;
}

/* The source of `length` bytes at `bytes`, read `piece` at a time, whose state is `t`. */
static inline sprout_source test_source_of(test_source *t, const void *bytes, size_t length, size_t piece) {
  sprout_source source;
  t->bytes = (const unsigned char *)bytes;
  t->length = length;
  t->at = 0;
  t->piece = piece;
  t->fail_at = -1;
  t->reads = 0;
  source.ctx = t;
  source.read = test_source_read;
  return source;
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

/* The state's canonical text, built in `scratch`, which this opens over the state's own host; reset it when done with the text. */
static inline sprout_status test_state_write(const sprout_state *state, sprout_arena *scratch, const char **out,
                                             size_t *length) {
  sprout_status status = sprout_arena_init(scratch, &state->host);
  return status == SPROUT_OK ? sprout_state_write(state, scratch, out, length) : status;
}

#endif
