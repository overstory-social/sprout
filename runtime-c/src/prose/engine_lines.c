/*
 * The engine's own words (the spec's Prose > Engine lines): each line it speaks for itself is a
 * named passage, and where nothing along the way writes it, as where the library file that
 * writes it is absent, the engine says the standard library's words itself, so no line of its
 * is ever silent. Those words are read here as a one-line passage into the same nodes a
 * cartridge holds, and rendered through the same path as any passage. The lines are a fixed
 * set, written in a fixed shape: words, `{name}` slots, `{if}` with `{else}`, and `{for}`; a
 * line that does not read is the engine's defect.
 */
#include "prose/prose.h"

/* Each line, and the words the standard library gives it; `not_a_place` is the engine's refusal of a move into what holds no actors. */
static const struct {
  const char *name, *words;
} STOCK[] = {
    {"unknown", "That is not something you can do here."},
    {"not_here", "You see nothing like that here."},
    {"no_way", "You can't go that way."},
    {"cannot", "You can't {reading}."},
    {"not_carrying", "You aren't carrying {thing}."},
    {"meant", "({thing})"},
    {"pronoun_correction", "{thing} is a {pronoun}."},
    {"nothing_happens", "Nothing much comes of that."},
    {"unremarkable", "There is nothing special about {thing}."},
    {"unseen", "Something here is too much to take in."},
    {"dark", "It is too dark to see."},
    {"fault", "Something in this world has gone wrong, and nothing has changed."},
    {"missing", "This world uses something this host does not provide, and will be missing some of itself."},
    {"displaced", "The place you were standing is gone."},
    {"inside_itself", "{item} cannot go inside itself."},
    {"crowded", "There is no room in {to} for {item}."},
    {"waited", "Time passes."},
    {"help", "You can type: {for reading of readings}{reading}{if $last}.{else}, {/if}{/for}"},
    {"acted", "{actor} tries to {reading}."},
    {"gone_away", "You leave, and take what you carry with you."},
    {"npc_says", "{actor} says \"{words}\""},
    {"arrives", "{item} arrives{if bound from} from {from}{/if}."},
    {"leaves", "{item} leaves{if bound to} for {to}{/if}."},
    {"inventory",
     "{if self.count == 0}You are carrying nothing.{else} You are carrying {for thing in self}{thing}{if $last}.{else}, "
     "{/if}{/for}{/if}"},
    {"not_a_place", "{item} cannot stand in {to}."},
};

const char *prose_stock_words(const char *name) {
  size_t i;
  for (i = 0; i < sizeof STOCK / sizeof STOCK[0]; i++)
    if (strcmp(STOCK[i].name, name) == 0) return STOCK[i].words;
  return NULL;
}

/* ---- reading a line into nodes ---- */

typedef struct reader {
  sprout_arena *arena;
  sprout_eval_fault *fault;
  const char *at, *end;
  bool failed;
} reader;

static sprout_node *node_of(reader *r, sprout_node_kind kind) {
  sprout_node *node = (sprout_node *)sprout_arena_take(r->arena, sizeof *node);
  if (node == NULL) {
    r->failed = true;
    return NULL;
  }
  node->kind = kind;
  node->index = SPROUT_NOT_AN_ENTRY;
  return node;
}

static sprout_node *string_of(reader *r, const char *bytes, size_t length) {
  sprout_node *node = node_of(r, SPROUT_NODE_STRING);
  if (node == NULL) return NULL;
  node->text = sprout_arena_copy(r->arena, bytes, length);
  node->length = length;
  if (node->text == NULL) r->failed = true;
  return node;
}

#define FIELDS 8

/* An object node of the given kind, with room for its fields. */
static sprout_node *object_of(reader *r, const char *kind) {
  sprout_node *node = node_of(r, SPROUT_NODE_OBJECT);
  if (node == NULL) return NULL;
  node->keys = (const char **)sprout_arena_take(r->arena, FIELDS * sizeof *node->keys);
  node->items = (const sprout_node **)sprout_arena_take(r->arena, FIELDS * sizeof *node->items);
  if (node->keys == NULL || node->items == NULL) {
    r->failed = true;
    return NULL;
  }
  node->keys[0] = "kind";
  node->items[0] = string_of(r, kind, strlen(kind));
  node->count = 1;
  return node;
}

static void put_field(reader *r, sprout_node *object, const char *key, const sprout_node *value) {
  if (object == NULL || value == NULL || object->count >= FIELDS) {
    r->failed = true;
    return;
  }
  object->keys[object->count] = key;
  object->items[object->count++] = value;
}

static sprout_node *ident_of(reader *r, const char *text, size_t length) {
  sprout_node *ident = object_of(r, "ident");
  put_field(r, ident, "text", string_of(r, text, length));
  return ident;
}

static sprout_node *binding_of(reader *r, const char *text, size_t length) {
  sprout_node *binding = object_of(r, "binding");
  put_field(r, binding, "name", ident_of(r, text, length));
  return binding;
}

/* The expression the words between braces, or after `if` or `in`, read as. */
static sprout_node *expression(reader *r, const char *text, size_t length) {
  const char *equals = NULL;
  size_t i;
  while (length > 0 && text[0] == ' ') text++, length--;
  while (length > 0 && text[length - 1] == ' ') length--;
  for (i = 0; i + 4 <= length; i++)
    if (memcmp(text + i, " == ", 4) == 0) equals = text + i;
  if (equals != NULL) {
    sprout_node *binary = object_of(r, "binary"), *right = object_of(r, "integer"), *value = node_of(r, SPROUT_NODE_NUMBER);
    if (value != NULL) value->number = (double)(equals[4] - '0');
    put_field(r, right, "value", value);
    put_field(r, binary, "operator", string_of(r, "==", 2));
    put_field(r, binary, "left", expression(r, text, (size_t)(equals - text)));
    put_field(r, binary, "right", right);
    return binary;
  }
  if (length > 6 && memcmp(text, "bound ", 6) == 0) {
    sprout_node *bound = object_of(r, "bound");
    put_field(r, bound, "name", ident_of(r, text + 6, length - 6));
    return bound;
  }
  for (i = 0; i < length; i++)
    if (text[i] == '.') {
      sprout_node *member = object_of(r, "member");
      put_field(r, member, "receiver", expression(r, text, i));
      put_field(r, member, "member", ident_of(r, text + i + 1, length - i - 1));
      return member;
    }
  return binding_of(r, text, length);
}

static bool starts(const reader *r, const char *tag) {
  size_t n = strlen(tag);
  return (size_t)(r->end - r->at) >= n && memcmp(r->at, tag, n) == 0;
}

static sprout_node *block(reader *r);

/* The tag at `at`, which begins with `{`: the words inside, and where it ends. */
static const char *tag_end(const reader *r) {
  const char *close = r->at;
  while (close < r->end && *close != '}') close++;
  return close < r->end ? close : NULL;
}

static sprout_node *array_of(reader *r, const sprout_node **items, size_t count) {
  sprout_node *array = node_of(r, SPROUT_NODE_ARRAY);
  if (array == NULL) return NULL;
  array->items = (const sprout_node **)sprout_arena_take(r->arena, (count + 1) * sizeof *items);
  if (array->items == NULL) {
    r->failed = true;
    return NULL;
  }
  if (count > 0) memcpy(array->items, items, count * sizeof *items);
  array->count = count;
  return array;
}

/* `{if c}…{else}…{/if}`, the reader at its `{if`. */
static sprout_node *conditional(reader *r) {
  const char *close = tag_end(r);
  sprout_node *piece = object_of(r, "prose-if");
  if (close == NULL) {
    r->failed = true;
    return NULL;
  }
  put_field(r, piece, "condition", expression(r, r->at + 4, (size_t)(close - r->at - 4)));
  r->at = close + 1;
  put_field(r, piece, "then", block(r));
  if (starts(r, "{else}")) {
    r->at += 6;
    put_field(r, piece, "otherwise", block(r));
  } else {
    put_field(r, piece, "otherwise", node_of(r, SPROUT_NODE_NULL));
  }
  if (!starts(r, "{/if}")) r->failed = true;
  else r->at += 5;
  return piece;
}

/* `{for x in c}…{/for}` or `{for x of l}…{/for}`, the reader at its `{for`. */
static sprout_node *loop(reader *r) {
  const char *close = tag_end(r), *word, *over;
  sprout_node *piece = object_of(r, "prose-for");
  bool of;
  if (close == NULL) {
    r->failed = true;
    return NULL;
  }
  word = r->at + 5;
  over = word;
  while (over < close && *over != ' ') over++;
  put_field(r, piece, "variable", ident_of(r, word, (size_t)(over - word)));
  of = (size_t)(close - over) > 4 && memcmp(over, " of ", 4) == 0;
  put_field(r, piece, "filter", node_of(r, SPROUT_NODE_NULL));
  put_field(r, piece, "walks", string_of(r, of ? "of" : "in", 2));
  put_field(r, piece, "over", expression(r, over + 4, (size_t)(close - over - 4)));
  r->at = close + 1;
  put_field(r, piece, "body", block(r));
  if (!starts(r, "{/for}")) r->failed = true;
  else r->at += 6;
  return piece;
}

/* Words and tags up to the tag that closes the block the reader is in. */
static sprout_node *block(reader *r) {
  const sprout_node *pieces[64];
  size_t count = 0;
  sprout_node *prose = object_of(r, "prose");
  while (r->at < r->end && !r->failed && count < 64) {
    sprout_node *piece;
    if (starts(r, "{/") || starts(r, "{else}")) break;
    if (*r->at != '{') {
      const char *start = r->at;
      while (r->at < r->end && *r->at != '{') r->at++;
      piece = object_of(r, "prose-words");
      put_field(r, piece, "text", string_of(r, start, (size_t)(r->at - start)));
    } else if (starts(r, "{if ")) {
      piece = conditional(r);
    } else if (starts(r, "{for ")) {
      piece = loop(r);
    } else {
      const char *close = tag_end(r);
      if (close == NULL) {
        r->failed = true;
        break;
      }
      piece = object_of(r, "prose-slot");
      put_field(r, piece, "expr", expression(r, r->at + 1, (size_t)(close - r->at - 1)));
      r->at = close + 1;
    }
    pieces[count++] = piece;
  }
  put_field(r, prose, "pieces", array_of(r, pieces, count));
  return prose;
}

sprout_eval_status prose_engine_prose(sprout_arena *turn, sprout_eval_fault *fault, const char *name,
                                      const sprout_node **prose, bool *known) {
  const char *words = prose_stock_words(name);
  reader r;
  *known = words != NULL;
  if (words == NULL) return SPROUT_EVAL_OK;
  memset(&r, 0, sizeof r);
  r.arena = turn;
  r.fault = fault;
  r.at = words;
  r.end = words + strlen(words);
  *prose = block(&r);
  if (r.at != r.end || r.failed) {
    const char *said = "an engine line did not read, which is the engine's defect.";
    size_t i;
    for (i = 0; said[i] != '\0'; i++) fault->text[i] = said[i];
    fault->text[i] = '\0';
    fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  return SPROUT_EVAL_OK;
}
