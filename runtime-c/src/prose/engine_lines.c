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
  sprout_builder builder;
  sprout_eval_fault *fault;
  const char *at, *end;
  bool failed;
} reader;

static const sprout_node *string_of(reader *r, const char *bytes, size_t length) {
  return sprout_build_string(&r->builder, bytes, length);
}

/* An object node of the given kind, then its fields, in order; NULL and failed when any field is. */
static const sprout_node *object_of(reader *r, const char *kind, const char *const *keys,
                                    const sprout_node *const *values, size_t count) {
  const char *all_keys[8];
  const sprout_node *all_values[8];
  size_t i;
  if (count + 1 > 8) {
    r->failed = true;
    return NULL;
  }
  all_keys[0] = "kind";
  all_values[0] = string_of(r, kind, strlen(kind));
  for (i = 0; i < count; i++) {
    all_keys[i + 1] = keys[i];
    all_values[i + 1] = values[i];
  }
  return sprout_build_object(&r->builder, all_keys, all_values, count + 1);
}

static const sprout_node *one_field(reader *r, const char *kind, const char *key, const sprout_node *value) {
  return object_of(r, kind, &key, &value, 1);
}

static const sprout_node *binding_of(reader *r, const char *text, size_t length) {
  return one_field(r, "binding", "name", string_of(r, text, length));
}

/* The expression the words between braces, or after `if` or `in`, read as. */
static const sprout_node *expression(reader *r, const char *text, size_t length) {
  const char *equals = NULL;
  size_t i;
  while (length > 0 && text[0] == ' ') text++, length--;
  while (length > 0 && text[length - 1] == ' ') length--;
  for (i = 0; i + 4 <= length; i++)
    if (memcmp(text + i, " == ", 4) == 0) equals = text + i;
  if (equals != NULL) {
    static const char *const keys[] = {"operator", "left", "right"};
    const sprout_node *values[3];
    values[0] = string_of(r, "==", 2);
    values[1] = expression(r, text, (size_t)(equals - text));
    values[2] = one_field(r, "integer", "value", sprout_build_number(&r->builder, (double)(equals[4] - '0')));
    return object_of(r, "binary", keys, values, 3);
  }
  if (length > 6 && memcmp(text, "bound ", 6) == 0) return one_field(r, "bound", "name", string_of(r, text + 6, length - 6));
  for (i = 0; i < length; i++)
    if (text[i] == '.') {
      static const char *const keys[] = {"receiver", "member"};
      const sprout_node *values[2];
      values[0] = expression(r, text, i);
      values[1] = string_of(r, text + i + 1, length - i - 1);
      return object_of(r, "member", keys, values, 2);
    }
  return binding_of(r, text, length);
}

static bool starts(const reader *r, const char *tag) {
  size_t n = strlen(tag);
  return (size_t)(r->end - r->at) >= n && memcmp(r->at, tag, n) == 0;
}

static const sprout_node *block(reader *r);

/* The tag at `at`, which begins with `{`: the words inside, and where it ends. */
static const char *tag_end(const reader *r) {
  const char *close = r->at;
  while (close < r->end && *close != '}') close++;
  return close < r->end ? close : NULL;
}

/* `{if c}…{else}…{/if}`, the reader at its `{if`. */
static const sprout_node *conditional(reader *r) {
  static const char *const keys[] = {"condition", "then", "otherwise"};
  const sprout_node *values[3];
  const char *close = tag_end(r);
  if (close == NULL) {
    r->failed = true;
    return NULL;
  }
  values[0] = expression(r, r->at + 4, (size_t)(close - r->at - 4));
  r->at = close + 1;
  values[1] = block(r);
  if (starts(r, "{else}")) {
    r->at += 6;
    values[2] = block(r);
  } else {
    values[2] = sprout_build_null(&r->builder);
  }
  if (!starts(r, "{/if}")) r->failed = true;
  else r->at += 5;
  return object_of(r, "prose-if", keys, values, 3);
}

/* `{for x in c}…{/for}` or `{for x of l}…{/for}`, the reader at its `{for`. */
static const sprout_node *loop(reader *r) {
  static const char *const keys[] = {"variable", "filter", "walks", "over", "body"};
  const sprout_node *values[5];
  const char *close = tag_end(r), *word, *over;
  bool of;
  if (close == NULL) {
    r->failed = true;
    return NULL;
  }
  word = r->at + 5;
  over = word;
  while (over < close && *over != ' ') over++;
  values[0] = string_of(r, word, (size_t)(over - word));
  of = (size_t)(close - over) > 4 && memcmp(over, " of ", 4) == 0;
  values[1] = sprout_build_null(&r->builder);
  values[2] = string_of(r, of ? "of" : "in", 2);
  values[3] = expression(r, over + 4, (size_t)(close - over - 4));
  r->at = close + 1;
  values[4] = block(r);
  if (!starts(r, "{/for}")) r->failed = true;
  else r->at += 6;
  return object_of(r, "prose-for", keys, values, 5);
}

/* Words and tags up to the tag that closes the block the reader is in. */
static const sprout_node *block(reader *r) {
  const sprout_node *pieces[64];
  size_t count = 0;
  while (r->at < r->end && !r->failed && count < 64) {
    const sprout_node *piece;
    if (starts(r, "{/") || starts(r, "{else}")) break;
    if (*r->at != '{') {
      const char *start = r->at;
      while (r->at < r->end && *r->at != '{') r->at++;
      piece = one_field(r, "prose-words", "text", string_of(r, start, (size_t)(r->at - start)));
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
      piece = one_field(r, "prose-slot", "expr", expression(r, r->at + 1, (size_t)(close - r->at - 1)));
      r->at = close + 1;
    }
    if (piece == NULL) {
      r->failed = true;
      break;
    }
    pieces[count++] = piece;
  }
  return one_field(r, "prose", "pieces", sprout_build_array(&r->builder, pieces, count));
}

sprout_eval_status prose_engine_prose(sprout_arena *turn, sprout_eval_fault *fault, const char *name,
                                      const sprout_node **prose, const sprout_graph **graph, bool *known) {
  const char *words = prose_stock_words(name);
  reader *r;
  *known = words != NULL;
  *prose = NULL;
  *graph = NULL;
  if (words == NULL) return SPROUT_EVAL_OK;
  /* The reader, and the builder's graph with it, live in the turn arena beside the nodes, as the prose refers to them. */
  r = (reader *)sprout_arena_take(turn, sizeof *r);
  if (r == NULL) return SPROUT_EVAL_NO_MEMORY;
  {
    sprout_build_room room = SPROUT_BUILD_LINE_ROOM;
    sprout_build_begin(&r->builder, turn, room);
  }
  r->fault = fault;
  r->at = words;
  r->end = words + strlen(words);
  *prose = block(r);
  if (sprout_build_failed(&r->builder)) return SPROUT_EVAL_NO_MEMORY;
  if (r->at != r->end || r->failed || *prose == NULL) {
    const char *said = "an engine line did not read, which is the engine's defect.";
    size_t i;
    for (i = 0; said[i] != '\0'; i++) fault->text[i] = said[i];
    fault->text[i] = '\0';
    fault->name = "Error";
    return SPROUT_EVAL_ENGINE;
  }
  *graph = sprout_build_graph(&r->builder);
  return SPROUT_EVAL_OK;
}
