/*
 * canonical.c: the text an index's signature is made over. The fixture index's text is the one
 * Node signed, byte for byte; the rules hold over generated objects: every object's names in
 * strictly ascending UTF-16 order, no white space outside strings, nothing lost, and the text of
 * the text is itself.
 */
#include <stdlib.h>

#include "canonical.h"
#include "host/pd_host.h"
#include "support.h"

static player_host host;
static sprout_arena arena;

static void open_arena(const char *scenario) {
  begin(scenario);
  player_host_init(&host, &fake->api);
  sprout_arena_init(&arena, &host.record);
}

static void close_arena(void) {
  sprout_arena_reset(&arena);
  end();
}

static sprout_json *read_json(const char *text) {
  sprout_json *root = NULL;
  sprout_json_error error;
  CHECK(sprout_json_read(&arena, text, strlen(text), &root, &error) == SPROUT_OK, "bad JSON %s: %s", text, error.text);
  return root;
}

/* The canonical text of the JSON `text`, or the reason there is none, prefixed with "!". */
static const char *canonical_of(const char *text) {
  static char out[1 << 16];
  sprout_json *root = read_json(text);
  const char *canonical = NULL, *why;
  size_t length = 0;
  if (root == NULL) return "!unreadable";
  why = player_canonical(&arena, root, &canonical, &length);
  if (why != NULL) {
    snprintf(out, sizeof out, "!%s", why);
    return out;
  }
  CHECK(strlen(canonical) == length, "the length is the text's");
  snprintf(out, sizeof out, "%s", canonical);
  return out;
}

static void names_are_sorted_and_strings_escaped_as_json_stringify_does(void) {
  const char *got;
  open_arena("escapes");
  got = canonical_of("{ \"b\": 1, \"a\": [ \"x\", 2 ], \"c\": \"q\\\"b\\\\n\\n\\t\\u0001\xc3\xa9\\u007f\\/\" }");
  CHECK(strcmp(got, "{\"a\":[\"x\",2],\"b\":1,\"c\":\"q\\\"b\\\\n\\n\\t\\u0001\xc3\xa9\x7f/\"}") == 0, "%s", got);
  got = canonical_of("{\"z\": {\"y\": -0, \"x\": -12, \"w\": 9007199254740992}}");
  CHECK(strcmp(got, "{\"z\":{\"w\":9007199254740992,\"x\":-12,\"y\":0}}") == 0, "%s", got);
  got = canonical_of("{\"list\": [], \"object\": {}}");
  CHECK(strcmp(got, "{\"list\":[],\"object\":{}}") == 0, "an empty object is an object, as the signer writes it: %s", got);
  got = canonical_of("\"just text\"");
  CHECK(strcmp(got, "\"just text\"") == 0, "%s", got);
  close_arena();
}

static void names_are_in_utf16_order_as_javascript_sorts_them(void) {
  const char *got;
  open_arena("utf16");
  /* U+FF01 is EF BC 81 in UTF-8 and U+1F600 is F0 9F 98 80, so bytes put U+FF01 first; UTF-16 puts U+1F600 (D83D DE00) first. */
  got = canonical_of("{\"\xef\xbc\x81\": 1, \"\xf0\x9f\x98\x80\": 2, \"B\": 3, \"a\": 4, \"ab\": 5, \"\": 6}");
  CHECK(strcmp(got, "{\"\":6,\"B\":3,\"a\":4,\"ab\":5,\"\xf0\x9f\x98\x80\":2,\"\xef\xbc\x81\":1}") == 0, "%s", got);
  close_arena();
}

static void a_value_with_no_canonical_text_is_refused_with_a_reason(void) {
  open_arena("refused");
  CHECK(strcmp(canonical_of("{\"a\": null}"), "!a null has no canonical text") == 0, "null");
  CHECK(strcmp(canonical_of("[1, true]"), "!a true or false has no canonical text") == 0, "true");
  CHECK(strcmp(canonical_of("{\"a\": 1, \"b\": 2, \"a\": 3}"), "!an object that names a member twice has no canonical text") == 0,
        "a name twice");
  CHECK(strcmp(canonical_of("[{\"x\": [{\"k\": 1, \"k\": 1}]}]"), "!an object that names a member twice has no canonical text") ==
            0,
        "a name twice, deep");
  close_arena();
}

static void the_text_of_the_signed_index_is_the_text_node_signed(void) {
  char *index = fixture_text("index.json"), *signed_text = fixture_text("index.canonical.txt");
  sprout_json *root, *worlds;
  const char *canonical = NULL, *why;
  size_t length = 0;
  open_arena("fixture");
  root = read_json(index);
  worlds = root != NULL ? (sprout_json *)sprout_json_get(root, "worlds") : NULL;
  CHECK(worlds != NULL, "the fixture has worlds");
  if (worlds != NULL) {
    why = player_canonical(&arena, worlds, &canonical, &length);
    CHECK(why == NULL, "%s", why);
    CHECK(why == NULL && strcmp(canonical, signed_text) == 0, "\n  %s\nis not what Node signed\n  %s", canonical, signed_text);
  }
  free(index);
  free(signed_text);
  close_arena();
}

/* ---- generated objects ---- */

static unsigned seed = 7;
static unsigned roll(unsigned n) {
  seed = seed * 1103515245u + 12345u;
  return (seed >> 8) % n;
}

/* A name of a few characters, some of them outside ASCII and some outside the BMP. */
static void random_name(char *out) {
  static const char *const PIECES[] = {"a", "b", "B", "_", "0", "\xc3\xa9", "\xef\xbc\x81", "\xee\x80\x80", "\xf0\x9f\x98\x80",
                                       "\xf0\x90\x80\x80", "\\\"", "\\n"};
  unsigned n = 1 + roll(4), i;
  out[0] = '\0';
  for (i = 0; i < n; i++) strcat(out, PIECES[roll(sizeof PIECES / sizeof PIECES[0])]);
}

/* A random value at `depth`, appended to `out`. */
static void random_value(char *out, int depth) {
  unsigned kind = depth > 2 ? roll(2) : roll(4), i, n;
  char name[64];
  if (kind == 0) {
    sprintf(out + strlen(out), "%d", (int)roll(2000) - 1000);
  } else if (kind == 1) {
    random_name(name);
    sprintf(out + strlen(out), " \"%s\" ", name);
  } else if (kind == 2) {
    strcat(out, "[ ");
    for (i = 0, n = roll(4); i < n; i++) {
      if (i > 0) strcat(out, " , ");
      random_value(out, depth + 1);
    }
    strcat(out, " ]");
  } else {
    char used[8][64];
    unsigned count = 0;
    strcat(out, "{ ");
    for (i = 0, n = roll(6); i < n; i++) {
      unsigned u;
      bool repeated = false;
      random_name(name);
      for (u = 0; u < count; u++) repeated = repeated || strcmp(used[u], name) == 0;
      if (repeated) continue;
      strcpy(used[count++], name);
      if (count > 1) strcat(out, ",\n");
      sprintf(out + strlen(out), "\"%s\" : ", name);
      random_value(out, depth + 1);
    }
    strcat(out, " }");
  }
}

/* A name's UTF-16 code units, decoded independently of canonical.c. */
static size_t utf16_of(const char *bytes, size_t length, unsigned *units) {
  size_t i = 0, n = 0;
  while (i < length) {
    unsigned char c = (unsigned char)bytes[i];
    unsigned scalar;
    if (c < 0x80) scalar = c, i += 1;
    else if (c < 0xE0) scalar = ((c & 0x1Fu) << 6) | (bytes[i + 1] & 0x3Fu), i += 2;
    else if (c < 0xF0) scalar = ((c & 0x0Fu) << 12) | ((bytes[i + 1] & 0x3Fu) << 6) | (bytes[i + 2] & 0x3Fu), i += 3;
    else
      scalar = ((c & 0x07u) << 18) | ((bytes[i + 1] & 0x3Fu) << 12) | ((bytes[i + 2] & 0x3Fu) << 6) | (bytes[i + 3] & 0x3Fu),
      i += 4;
    if (scalar >= 0x10000) {
      units[n++] = 0xD800 + ((scalar - 0x10000) >> 10);
      units[n++] = 0xDC00 + ((scalar - 0x10000) & 0x3FF);
    } else {
      units[n++] = scalar;
    }
  }
  return n;
}

static bool before(const sprout_json *a, const sprout_json *b) {
  unsigned x[128], y[128];
  size_t n = utf16_of(a->key, a->key_length, x), m = utf16_of(b->key, b->key_length, y), i;
  for (i = 0; i < n && i < m; i++)
    if (x[i] != y[i]) return x[i] < y[i];
  return n < m;
}

/* Every object under `node` has its names in strictly ascending UTF-16 order. */
static bool in_order(const sprout_json *node) {
  size_t i;
  for (i = 0; i < node->count; i++) {
    if (node->kind == SPROUT_JSON_OBJECT && i > 0 && !before(node->items[i - 1], node->items[i])) return false;
    if (!in_order(node->items[i])) return false;
  }
  return true;
}

/* The count of every value under `node`, itself included. */
static size_t values_in(const sprout_json *node) {
  size_t i, n = 1;
  for (i = 0; i < node->count; i++) n += values_in(node->items[i]);
  return n;
}

static void the_rules_hold_over_generated_objects(void) {
  static char text[1 << 15], first[1 << 15];
  int round;
  open_arena("generated");
  for (round = 0; round < 400; round++) {
    sprout_json *original, *again;
    const char *canonical = NULL;
    size_t length = 0, values;
    bool in_string = false;
    size_t i;
    text[0] = '\0';
    random_value(text, 0);
    original = read_json(text);
    if (original == NULL) break;
    values = values_in(original);
    CHECK(player_canonical(&arena, original, &canonical, &length) == NULL, "round %d: %s", round, text);
    snprintf(first, sizeof first, "%s", canonical);
    for (i = 0; i < length; i++) {
      if (in_string && first[i] == '\\')
        i++;
      else if (first[i] == '"')
        in_string = !in_string;
      else if (!in_string)
        CHECK(first[i] != ' ' && first[i] != '\n', "round %d: white space outside a string in %s", round, first);
    }
    again = read_json(first);
    if (again == NULL) break;
    CHECK(in_order(again), "round %d: names out of order in %s", round, first);
    CHECK(values_in(again) == values, "round %d: %zu values became %zu", round, values, values_in(again));
    CHECK(player_canonical(&arena, again, &canonical, &length) == NULL && strcmp(canonical, first) == 0,
          "round %d: the text of the text is not itself:\n  %s\n  %s", round, first, canonical);
    sprout_arena_reset(&arena);
  }
  close_arena();
}

int main(void) {
  test_program("canonical");
  names_are_sorted_and_strings_escaped_as_json_stringify_does();
  names_are_in_utf16_order_as_javascript_sorts_them();
  a_value_with_no_canonical_text_is_refused_with_a_reason();
  the_text_of_the_signed_index_is_the_text_node_signed();
  the_rules_hold_over_generated_objects();
  return finish();
}
