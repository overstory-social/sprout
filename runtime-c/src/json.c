/*
 * JSON reader and writer (the spec's The host contract: a cartridge and a
 * stored world arrive as JSON). The reader keeps its own stack in the arena
 * rather than the C stack, so nesting is bounded by memory alone. Numbers are
 * whole and no larger than 2^53 in magnitude, since the language has no fractions
 * and a double holds those exactly; any other number is a refusal.
 */
#include "json.h"

#include <string.h>

#include "values.h"

/* The largest whole number a double holds exactly: 2^53. */
#define EXACT_MAX ((uint64_t)1 << 53)

typedef struct frame {
  sprout_json *node;
  sprout_json *head, *tail;
  size_t count;
  struct frame *up;
} frame;

typedef struct reader {
  sprout_arena *arena;
  const unsigned char *b;
  size_t n, at;
  sprout_json_error *error;
  frame *top;
} reader;

static sprout_status fail(reader *r, const char *words) {
  size_t line = 1, column = 1, at = r->at > r->n ? r->n : r->at;
  size_t used = 0;
  for (size_t i = 0; i < at; i++) {
    if (r->b[i] == '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  if (r->error != NULL) {
    r->error->line = line;
    r->error->column = column;
    while (words[used] != '\0' && used + 1 < sizeof r->error->text) {
      r->error->text[used] = words[used];
      used++;
    }
    r->error->text[used] = '\0';
  }
  return SPROUT_BAD_INPUT;
}

static void skip_space(reader *r) {
  while (r->at < r->n &&
         (r->b[r->at] == ' ' || r->b[r->at] == '\n' || r->b[r->at] == '\t' || r->b[r->at] == '\r'))
    r->at++;
}

static int hex(unsigned char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool four_hex(reader *r, size_t at, uint32_t *unit) {
  uint32_t value = 0;
  if (at + 4 > r->n) return false;
  for (size_t i = 0; i < 4; i++) {
    int digit = hex(r->b[at + i]);
    if (digit < 0) return false;
    value = (value << 4) | (uint32_t)digit;
  }
  *unit = value;
  return true;
}

static size_t encode(uint32_t scalar, char *out) {
  if (scalar < 0x80) {
    out[0] = (char)scalar;
    return 1;
  }
  if (scalar < 0x800) {
    out[0] = (char)(0xC0 | (scalar >> 6));
    out[1] = (char)(0x80 | (scalar & 0x3F));
    return 2;
  }
  if (scalar < 0x10000) {
    out[0] = (char)(0xE0 | (scalar >> 12));
    out[1] = (char)(0x80 | ((scalar >> 6) & 0x3F));
    out[2] = (char)(0x80 | (scalar & 0x3F));
    return 3;
  }
  out[0] = (char)(0xF0 | (scalar >> 18));
  out[1] = (char)(0x80 | ((scalar >> 12) & 0x3F));
  out[2] = (char)(0x80 | ((scalar >> 6) & 0x3F));
  out[3] = (char)(0x80 | (scalar & 0x3F));
  return 4;
}

/* Reads a quoted string at r->at into the arena, unescaped. */
static sprout_status read_string(reader *r, const char **bytes, size_t *length) {
  size_t start = r->at + 1, end = start, size = 0;
  char *out;
  while (end < r->n && r->b[end] != '"') {
    if (r->b[end] < 0x20) {
      r->at = end;
      return fail(r, "a string holds a raw control character; write it with a backslash escape");
    }
    end += r->b[end] == '\\' ? 2 : 1;
  }
  if (end >= r->n) {
    r->at = r->n;
    return fail(r, "a string is never closed");
  }
  out = (char *)sprout_arena_take(r->arena, end - start + 1);
  if (out == NULL) return SPROUT_NO_MEMORY;
  for (size_t i = start; i < end;) {
    unsigned char c = r->b[i];
    if (c != '\\') {
      out[size++] = (char)c;
      i++;
      continue;
    }
    switch (r->b[i + 1]) {
      case '"': out[size++] = '"'; i += 2; break;
      case '\\': out[size++] = '\\'; i += 2; break;
      case '/': out[size++] = '/'; i += 2; break;
      case 'b': out[size++] = '\b'; i += 2; break;
      case 'f': out[size++] = '\f'; i += 2; break;
      case 'n': out[size++] = '\n'; i += 2; break;
      case 'r': out[size++] = '\r'; i += 2; break;
      case 't': out[size++] = '\t'; i += 2; break;
      case 'u': {
        uint32_t unit, low;
        if (!four_hex(r, i + 2, &unit)) {
          r->at = i;
          return fail(r, "a \\u escape needs four hex digits");
        }
        i += 6;
        if (unit >= 0xDC00 && unit <= 0xDFFF) {
          r->at = i - 6;
          return fail(r, "a \\u escape is half of a pair with no first half");
        }
        if (unit >= 0xD800 && unit <= 0xDBFF) {
          if (i + 1 >= r->n || r->b[i] != '\\' || r->b[i + 1] != 'u' ||
              !four_hex(r, i + 2, &low) || low < 0xDC00 || low > 0xDFFF) {
            r->at = i - 6;
            return fail(r, "a \\u escape is half of a pair with no second half");
          }
          unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
          i += 6;
        }
        size += encode(unit, out + size);
        break;
      }
      default:
        r->at = i;
        return fail(r, "a backslash in a string must be followed by one of \" \\ / b f n r t u");
    }
  }
  if (sprout_utf16_units(out, size) < 0) {
    r->at = start;
    return fail(r, "a string is not valid UTF-8");
  }
  out[size] = '\0';
  *bytes = out;
  *length = size;
  r->at = end + 1;
  return SPROUT_OK;
}

static sprout_status read_number(reader *r, double *number) {
  size_t i = r->at;
  bool negative = false;
  uint64_t magnitude = 0;
  if (r->b[i] == '-') {
    negative = true;
    i++;
  }
  if (i >= r->n || r->b[i] < '0' || r->b[i] > '9') return fail(r, "a number needs a digit here");
  if (r->b[i] == '0' && i + 1 < r->n && r->b[i + 1] >= '0' && r->b[i + 1] <= '9')
    return fail(r, "a number does not start with a zero before more digits");
  while (i < r->n && r->b[i] >= '0' && r->b[i] <= '9') {
    magnitude = magnitude * 10 + (uint64_t)(r->b[i] - '0');
    if (magnitude > EXACT_MAX) return fail(r, "a number is too large to hold exactly; write one no larger than 9007199254740992");
    i++;
  }
  if (i < r->n && (r->b[i] == '.' || r->b[i] == 'e' || r->b[i] == 'E'))
    return fail(r, "a number must be whole; write 3, not 3.5 or 3e0");
  *number = negative ? -(double)magnitude : (double)magnitude;
  r->at = i;
  return SPROUT_OK;
}

static bool literal(reader *r, const char *word) {
  size_t length = strlen(word);
  if (r->at + length > r->n || memcmp(r->b + r->at, word, length) != 0) return false;
  r->at += length;
  return true;
}

static sprout_json *make(reader *r, sprout_json_kind kind) {
  sprout_json *node = (sprout_json *)sprout_arena_take(r->arena, sizeof *node);
  if (node != NULL) node->kind = kind;
  return node;
}

/* Links a new node under the open container, naming it if the container is an object. */
static void attach(reader *r, sprout_json *node, const char *key, size_t key_length) {
  frame *top = r->top;
  if (top == NULL) return;
  if (top->node->kind == SPROUT_JSON_OBJECT) {
    node->key = key;
    node->key_length = key_length;
  }
  if (top->tail == NULL)
    top->head = node;
  else
    top->tail->next = node;
  top->tail = node;
  top->count++;
}

static sprout_status close_top(reader *r) {
  frame *top = r->top;
  sprout_json *child = top->head;
  top->node->count = top->count;
  if (top->count > 0) {
    top->node->items = (sprout_json **)sprout_arena_take(r->arena, top->count * sizeof(sprout_json *));
    if (top->node->items == NULL) return SPROUT_NO_MEMORY;
  }
  for (size_t i = 0; child != NULL; i++, child = child->next) {
    top->node->items[i] = child;
    child->parent = top->node;
    child->index = i;
  }
  r->top = top->up;
  return SPROUT_OK;
}

/* Reads `"name":` for the next member of an object. */
static sprout_status read_member_name(reader *r, const char **key, size_t *key_length) {
  sprout_status status;
  skip_space(r);
  if (r->at >= r->n || r->b[r->at] != '"') return fail(r, "an object's member starts with its name in quotes");
  status = read_string(r, key, key_length);
  if (status != SPROUT_OK) return status;
  skip_space(r);
  if (r->at >= r->n || r->b[r->at] != ':') return fail(r, "a member's name is followed by a colon");
  r->at++;
  return SPROUT_OK;
}

sprout_status sprout_json_read(sprout_arena *arena, const char *bytes, size_t length,
                               sprout_json **root, sprout_json_error *error) {
  reader r;
  const char *key = NULL;
  size_t key_length = 0;
  sprout_status status;
  r.arena = arena;
  r.b = (const unsigned char *)bytes;
  r.n = length;
  r.at = 0;
  r.error = error;
  r.top = NULL;
  *root = NULL;
  for (;;) {
    sprout_json *node = NULL;
    skip_space(&r);
    if (r.at >= r.n) return fail(&r, "the text ends where a value was expected");
    {
      unsigned char c = r.b[r.at];
      if (c == '{' || c == '[') {
        frame *opened = (frame *)sprout_arena_take(arena, sizeof *opened);
        node = make(&r, c == '{' ? SPROUT_JSON_OBJECT : SPROUT_JSON_ARRAY);
        if (node == NULL || opened == NULL) return SPROUT_NO_MEMORY;
        r.at++;
        attach(&r, node, key, key_length);
        if (r.top == NULL) *root = node;
        opened->node = node;
        opened->up = r.top;
        r.top = opened;
        skip_space(&r);
        if (r.at < r.n && r.b[r.at] == (c == '{' ? '}' : ']')) {
          r.at++;
          status = close_top(&r);
          if (status != SPROUT_OK) return status;
        } else {
          if (c == '{') {
            status = read_member_name(&r, &key, &key_length);
            if (status != SPROUT_OK) return status;
          }
          continue;
        }
      } else {
        if (c == '"') {
          node = make(&r, SPROUT_JSON_STRING);
          if (node == NULL) return SPROUT_NO_MEMORY;
          status = read_string(&r, &node->bytes, &node->length);
          if (status != SPROUT_OK) return status;
        } else if (c == 't' || c == 'f') {
          node = make(&r, SPROUT_JSON_BOOL);
          if (node == NULL) return SPROUT_NO_MEMORY;
          node->boolean = c == 't';
          if (!literal(&r, c == 't' ? "true" : "false")) return fail(&r, "this is not a value");
        } else if (c == 'n') {
          node = make(&r, SPROUT_JSON_NULL);
          if (node == NULL) return SPROUT_NO_MEMORY;
          if (!literal(&r, "null")) return fail(&r, "this is not a value");
        } else if (c == '-' || (c >= '0' && c <= '9')) {
          node = make(&r, SPROUT_JSON_NUMBER);
          if (node == NULL) return SPROUT_NO_MEMORY;
          status = read_number(&r, &node->number);
          if (status != SPROUT_OK) return status;
        } else {
          return fail(&r, "this is not a value");
        }
        attach(&r, node, key, key_length);
        if (r.top == NULL) *root = node;
      }
    }
    /* A value is complete: close what it finishes, or move to the next member. */
    for (;;) {
      unsigned char c;
      if (r.top == NULL) {
        skip_space(&r);
        if (r.at < r.n) return fail(&r, "there is text after the value");
        return SPROUT_OK;
      }
      skip_space(&r);
      if (r.at >= r.n) return fail(&r, "the text ends inside an open array or object");
      c = r.b[r.at];
      if (c == ',') {
        r.at++;
        if (r.top->node->kind == SPROUT_JSON_OBJECT) {
          status = read_member_name(&r, &key, &key_length);
          if (status != SPROUT_OK) return status;
        }
        break;
      }
      if (c == (r.top->node->kind == SPROUT_JSON_OBJECT ? '}' : ']')) {
        r.at++;
        status = close_top(&r);
        if (status != SPROUT_OK) return status;
        continue;
      }
      return fail(&r, r.top->node->kind == SPROUT_JSON_OBJECT
                          ? "after a member comes a comma or a closing brace"
                          : "after an element comes a comma or a closing bracket");
    }
  }
}

const sprout_json *sprout_json_get(const sprout_json *object, const char *key) {
  size_t length = strlen(key);
  if (object == NULL || object->kind != SPROUT_JSON_OBJECT) return NULL;
  for (size_t i = object->count; i > 0; i--) {
    const sprout_json *member = object->items[i - 1];
    if (member->key_length == length && memcmp(member->key, key, length) == 0) return member;
  }
  return NULL;
}

/* A growing byte buffer in the arena. */
typedef struct buffer {
  sprout_arena *arena;
  char *data;
  size_t length, capacity;
  bool failed;
} buffer;

static void put_bytes(buffer *out, const char *bytes, size_t count) {
  if (out->failed) return;
  if (out->length + count + 1 > out->capacity) {
    size_t capacity = out->capacity == 0 ? 64 : out->capacity * 2;
    char *grown;
    while (capacity < out->length + count + 1) capacity *= 2;
    grown = (char *)sprout_arena_take(out->arena, capacity);
    if (grown == NULL) {
      out->failed = true;
      return;
    }
    if (out->length > 0) memcpy(grown, out->data, out->length);
    out->data = grown;
    out->capacity = capacity;
  }
  if (count > 0) memcpy(out->data + out->length, bytes, count);
  out->length += count;
  out->data[out->length] = '\0';
}

static void put_char(buffer *out, char c) { put_bytes(out, &c, 1); }

static void put_string(buffer *out, const char *bytes, size_t length) {
  static const char digits[] = "0123456789abcdef";
  put_char(out, '"');
  for (size_t i = 0; i < length; i++) {
    unsigned char c = (unsigned char)bytes[i];
    switch (c) {
      case '"': put_bytes(out, "\\\"", 2); break;
      case '\\': put_bytes(out, "\\\\", 2); break;
      case '\b': put_bytes(out, "\\b", 2); break;
      case '\f': put_bytes(out, "\\f", 2); break;
      case '\n': put_bytes(out, "\\n", 2); break;
      case '\r': put_bytes(out, "\\r", 2); break;
      case '\t': put_bytes(out, "\\t", 2); break;
      default:
        if (c < 0x20) {
          char escape[6] = {'\\', 'u', '0', '0', digits[c >> 4], digits[c & 15]};
          put_bytes(out, escape, 6);
        } else {
          put_char(out, (char)c);
        }
    }
  }
  put_char(out, '"');
}

sprout_status sprout_json_write(sprout_arena *arena, const sprout_json *root, const char **bytes,
                                size_t *length) {
  buffer out = {arena, NULL, 0, 0, false};
  const sprout_json *node = root;
  put_bytes(&out, "", 0);
  for (;;) {
    /* Descend: print the node, and go into its first member if it has one. */
    if (node->parent != NULL && node->parent->kind == SPROUT_JSON_OBJECT) {
      put_string(&out, node->key, node->key_length);
      put_char(&out, ':');
    }
    switch (node->kind) {
      case SPROUT_JSON_NULL: put_bytes(&out, "null", 4); break;
      case SPROUT_JSON_BOOL:
        if (node->boolean)
          put_bytes(&out, "true", 4);
        else
          put_bytes(&out, "false", 5);
        break;
      case SPROUT_JSON_NUMBER: {
        char digits[32];
        size_t count;
        if (!sprout_number_text(node->number, digits, sizeof digits, &count)) return SPROUT_BAD_INPUT;
        put_bytes(&out, digits, count);
        break;
      }
      case SPROUT_JSON_STRING: put_string(&out, node->bytes, node->length); break;
      case SPROUT_JSON_ARRAY:
      case SPROUT_JSON_OBJECT:
        put_char(&out, node->kind == SPROUT_JSON_ARRAY ? '[' : '{');
        if (node->count > 0) {
          node = node->items[0];
          continue;
        }
        put_char(&out, node->kind == SPROUT_JSON_ARRAY ? ']' : '}');
        break;
    }
    /* Ascend: move to the next sibling, closing each container finished. */
    for (;;) {
      const sprout_json *parent;
      if (node == root) goto done;
      parent = node->parent;
      if (node->index + 1 < parent->count) {
        put_char(&out, ',');
        node = parent->items[node->index + 1];
        break;
      }
      put_char(&out, parent->kind == SPROUT_JSON_ARRAY ? ']' : '}');
      node = parent;
    }
  }
done:
  if (out.failed) return SPROUT_NO_MEMORY;
  *bytes = out.data;
  *length = out.length;
  return SPROUT_OK;
}
