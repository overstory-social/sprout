/*
 * A cartridge's body as a stream of JSON text; see stream.h. The walker knows
 * only JSON's shape (strings and their escapes, brackets, the delimiters a
 * scalar ends at), never its meaning: the JSON reader reads what it captures.
 */
#include "stream.h"

#include <string.h>

static sprout_status refuse(sprout_stream *stream, const char *why) {
  if (stream->why == NULL) stream->why = why;
  return SPROUT_BAD_INPUT;
}

sprout_status sprout_stream_begin(sprout_stream *stream, sprout_arena *scratch, const unsigned char *bytes,
                                  size_t length) {
  const char *why = NULL;
  sprout_status status;
  memset(stream, 0, sizeof *stream);
  stream->inflater = (sprout_inflater *)sprout_arena_take(scratch, sizeof *stream->inflater);
  if (stream->inflater == NULL) return SPROUT_NO_MEMORY;
  stream->capacity = SPROUT_STREAM_BUFFER;
  stream->buffer = (unsigned char *)sprout_arena_take(scratch, stream->capacity);
  if (stream->buffer == NULL) return SPROUT_NO_MEMORY;
  status = sprout_inflate_begin(stream->inflater, bytes, length, &why);
  if (status != SPROUT_OK) return refuse(stream, why);
  return SPROUT_OK;
}

/* Brings more text into the buffer; false when there is none, or the stream is refused. */
static bool fill(sprout_stream *stream) {
  const char *why = NULL;
  size_t got = 0;
  if (stream->ended || stream->why != NULL) return false;
  if (stream->at > 0) {
    memmove(stream->buffer, stream->buffer + stream->at, stream->n - stream->at);
    stream->n -= stream->at;
    stream->at = 0;
  }
  while (stream->n < stream->capacity) {
    if (sprout_inflate_next(stream->inflater, stream->buffer + stream->n, stream->capacity - stream->n, &got,
                            &why) != SPROUT_OK) {
      refuse(stream, why);
      return false;
    }
    stream->n += got;
    if (sprout_inflate_done(stream->inflater)) {
      stream->ended = true;
      break;
    }
    if (got == 0) break;
  }
  return stream->n > stream->at;
}

int sprout_stream_peek(sprout_stream *stream) {
  if (stream->at >= stream->n && !fill(stream)) return stream->why == NULL ? -1 : -2;
  return stream->buffer[stream->at];
}

int sprout_stream_next(sprout_stream *stream) {
  int c = sprout_stream_peek(stream);
  if (c >= 0) stream->at++;
  return c;
}

static bool is_space(int c) { return c == ' ' || c == '\n' || c == '\r' || c == '\t'; }

void sprout_stream_skip_space(sprout_stream *stream) {
  while (is_space(sprout_stream_peek(stream))) stream->at++;
}

bool sprout_stream_take(sprout_stream *stream, int c) {
  sprout_stream_skip_space(stream);
  if (sprout_stream_peek(stream) != c) return false;
  stream->at++;
  return true;
}

bool sprout_stream_ended(sprout_stream *stream) {
  sprout_stream_skip_space(stream);
  return sprout_stream_peek(stream) == -1;
}

/* The reason a byte could not be read: the end of the text, or the inflater's. */
static sprout_status ended(sprout_stream *stream, int c, const char *inside) {
  if (c == -2) return SPROUT_BAD_INPUT;
  return refuse(stream, inside);
}

sprout_status sprout_stream_key(sprout_stream *stream, char *out, size_t cap) {
  size_t n = 0;
  int c;
  if (!sprout_stream_take(stream, '"')) {
    c = sprout_stream_peek(stream);
    if (c == -2) return SPROUT_BAD_INPUT;
    return refuse(stream, "an object's member starts with its name in quotes");
  }
  for (;;) {
    c = sprout_stream_next(stream);
    if (c < 0) return ended(stream, c, "the text ends inside a name");
    if (c == '"') break;
    if (n + 1 >= cap) return refuse(stream, "a member's name is longer than a cartridge's are");
    out[n++] = (char)c;
    if (c == '\\') {
      c = sprout_stream_next(stream);
      if (c < 0) return ended(stream, c, "the text ends inside a name");
      if (n + 1 >= cap) return refuse(stream, "a member's name is longer than a cartridge's are");
      out[n++] = (char)c;
    }
  }
  out[n] = '\0';
  return SPROUT_OK;
}

/* The text being captured: grown by doubling in the arena, since a value's length is not known until its end. */
typedef struct capture {
  sprout_arena *arena;
  char *text;
  size_t length, capacity;
} capture;

static sprout_status push(capture *cap, int c) {
  if (cap->length + 2 > cap->capacity) {
    size_t bigger = cap->capacity == 0 ? 256 : cap->capacity * 2;
    char *room = (char *)sprout_arena_take(cap->arena, bigger);
    if (room == NULL) return SPROUT_NO_MEMORY;
    if (cap->length > 0) memcpy(room, cap->text, cap->length);
    cap->text = room;
    cap->capacity = bigger;
  }
  cap->text[cap->length++] = (char)c;
  return SPROUT_OK;
}

#define PUSH(c)                                 \
  do {                                          \
    sprout_status push_ = push(&cap, (c));      \
    if (push_ != SPROUT_OK) return push_;       \
  } while (0)

/* Takes a string's bytes from after its opening quote through its closing one. */
static sprout_status capture_string(sprout_stream *stream, capture *out) {
  capture cap = *out;
  int c;
  for (;;) {
    c = sprout_stream_next(stream);
    if (c < 0) return ended(stream, c, "the text ends inside a string");
    PUSH(c);
    if (c == '"') break;
    if (c == '\\') {
      c = sprout_stream_next(stream);
      if (c < 0) return ended(stream, c, "the text ends inside a string");
      PUSH(c);
    }
  }
  *out = cap;
  return SPROUT_OK;
}

sprout_status sprout_stream_capture(sprout_stream *stream, sprout_arena *arena, char **text, size_t *length) {
  capture cap;
  int c;
  sprout_status status;
  memset(&cap, 0, sizeof cap);
  cap.arena = arena;
  *text = NULL;
  *length = 0;
  sprout_stream_skip_space(stream);
  c = sprout_stream_peek(stream);
  if (c < 0) return ended(stream, c, "the text ends where a value was expected");
  if (c == '"') {
    stream->at++;
    PUSH('"');
    status = capture_string(stream, &cap);
    if (status != SPROUT_OK) return status;
  } else if (c == '{' || c == '[') {
    size_t depth = 0;
    for (;;) {
      c = sprout_stream_next(stream);
      if (c < 0) return ended(stream, c, "the text ends inside an object or array");
      PUSH(c);
      if (c == '"') {
        status = capture_string(stream, &cap);
        if (status != SPROUT_OK) return status;
      } else if (c == '{' || c == '[') {
        depth++;
      } else if (c == '}' || c == ']') {
        depth--;
        if (depth == 0) break;
      }
    }
  } else {
    while (c >= 0 && !is_space(c) && c != ',' && c != ']' && c != '}') {
      stream->at++;
      PUSH(c);
      c = sprout_stream_peek(stream);
    }
    if (c == -2) return SPROUT_BAD_INPUT;
    if (cap.length == 0) return refuse(stream, "a value was expected here");
  }
  PUSH('\0');
  *text = cap.text;
  *length = cap.length - 1;
  return SPROUT_OK;
}
