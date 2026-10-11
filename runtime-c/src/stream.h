/*
 * A cartridge's body as a stream of JSON text: the inflater pulled a buffer
 * at a time, and a walker over the text that steps through an object's
 * members and captures one value's text for the JSON reader, so a body is
 * read a value at a time and is never whole in memory. The loader uses it to
 * read a cartridge's small sections as trees and its table of entries one
 * entry at a time (the spec's The compiler > What compiling produces).
 */
#ifndef SPROUT_STREAM_H
#define SPROUT_STREAM_H

#include "inflate.h"

/* The text the stream holds ahead of its reader. */
#define SPROUT_STREAM_BUFFER 65536u

typedef struct sprout_stream {
  sprout_inflater *inflater;
  unsigned char *buffer;
  size_t capacity, n, at; /* the unread text is buffer[at, n) */
  bool ended;             /* the inflater has given its last byte */
  const char *why;        /* a sentence, once the stream is refused */
} sprout_stream;

/*
 * Begins the stream over the gzip member `bytes` holds, with its inflater and
 * buffer in `scratch`. SPROUT_BAD_INPUT with `stream->why` set for a member
 * that is not gzip's, SPROUT_NO_MEMORY when the host refuses a page.
 */
sprout_status sprout_stream_begin(sprout_stream *stream, sprout_arena *scratch, const unsigned char *bytes,
                                  size_t length);

/* The next byte of text without taking it; -1 at the end, -2 once the stream is refused (`why` says). */
int sprout_stream_peek(sprout_stream *stream);

/* The next byte of text, taken; -1 or -2 as peek gives. */
int sprout_stream_next(sprout_stream *stream);

/* Steps past JSON's whitespace. */
void sprout_stream_skip_space(sprout_stream *stream);

/* Takes `c` when, after whitespace, it is next; false otherwise. */
bool sprout_stream_take(sprout_stream *stream, int c);

/* Whether, after whitespace, the text has ended. */
bool sprout_stream_ended(sprout_stream *stream);

/*
 * A member's name: the text between the quotes of a JSON string, as written,
 * into `out` (NUL-terminated, at most `cap` - 1 bytes). SPROUT_BAD_INPUT with
 * `why` when what is next is not a string or the name is longer than `out`.
 */
sprout_status sprout_stream_key(sprout_stream *stream, char *out, size_t cap);

/*
 * The next value's text as written, whole, NUL-terminated in `arena`: a
 * string, a number, a literal, or an object or array with everything in it.
 * SPROUT_BAD_INPUT with `why` when the text ends inside it or no value is
 * there, SPROUT_NO_MEMORY when the host refuses a page.
 */
sprout_status sprout_stream_capture(sprout_stream *stream, sprout_arena *arena, char **text, size_t *length);

#endif
