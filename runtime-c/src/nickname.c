/*
 * Whether a nickname may be admitted (see nickname.h), word for word as the TypeScript host says it. A
 * nickname is lower-cased as JavaScript lower-cases a string, final sigma included, and split on the white
 * space JavaScript's `\s` is, each comma a word of its own, so two nicknames are one where they are typed
 * alike. Every refusal carries words the host can show the person, asking for another nickname, and names
 * what it collided on; a host may replace them with its own.
 */
#include "nickname.h"

#include <string.h>

#include "prose/prose.h"
#include "prose/unicode.h"

/* The language's reserved words (the spec's The compiler > Lexical rules), which no nickname's word may be. */
static const char *const RESERVED[] = {
    "boolean", "integer", "string", "object", "symbol", "true", "false", "accept", "act", "actors", "adjectives",
    "allow", "any", "are", "arrive", "article", "as", "at", "bound", "broadcast", "carried", "changed", "connect",
    "contains", "default", "depart", "describe", "destroy", "do", "each", "else", "enum", "exit", "finally", "for",
    "from", "grammar", "hours", "if", "import", "in", "intent", "kind", "let", "link", "lit", "many", "max",
    "message", "min", "minutes", "move", "name", "nouns", "of", "on", "optional", "pass", "passage", "permit",
    "pronouns", "prose", "refuse", "release", "remembers", "role", "say", "seconds", "send", "spawn", "tell", "text",
    "then", "to", "verb", "visitors", "wake", "when", "with", "without", "world"};

static bool is_reserved(sprout_str word) {
  size_t i;
  for (i = 0; i < sizeof RESERVED / sizeof *RESERVED; i++)
    if (strlen(RESERVED[i]) == word.length && memcmp(RESERVED[i], word.bytes, word.length) == 0) return true;
  return false;
}

/* ---- bytes under construction ---- */

typedef struct bytes {
  sprout_arena *arena;
  char *items;
  size_t length, capacity;
  bool failed;
} bytes;

static void put(bytes *out, const char *from, size_t length) {
  if (out->failed) return;
  if (out->length + length + 1 > out->capacity) {
    size_t wanted = out->capacity == 0 ? 64 : out->capacity;
    char *bigger;
    while (wanted < out->length + length + 1) wanted *= 2;
    bigger = (char *)sprout_arena_take(out->arena, wanted);
    if (bigger == NULL) {
      out->failed = true;
      return;
    }
    if (out->length > 0) memcpy(bigger, out->items, out->length);
    out->items = bigger;
    out->capacity = wanted;
  }
  memcpy(out->items + out->length, from, length);
  out->length += length;
  out->items[out->length] = '\0';
}

static void put_text(bytes *out, const char *text) { put(out, text, strlen(text)); }

static void put_number(bytes *out, uint64_t number) {
  char digits[24];
  size_t count = sizeof digits;
  do {
    digits[--count] = (char)('0' + (int)(number % 10));
    number /= 10;
  } while (number > 0);
  put(out, digits + count, sizeof digits - count);
}

static void put_code_point(bytes *out, unsigned long cp) {
  char encoded[4];
  size_t n;
  if (cp < 0x80) {
    encoded[0] = (char)cp;
    n = 1;
  } else if (cp < 0x800) {
    encoded[0] = (char)(0xC0 | (cp >> 6));
    encoded[1] = (char)(0x80 | (cp & 0x3F));
    n = 2;
  } else if (cp < 0x10000) {
    encoded[0] = (char)(0xE0 | (cp >> 12));
    encoded[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    encoded[2] = (char)(0x80 | (cp & 0x3F));
    n = 3;
  } else {
    encoded[0] = (char)(0xF0 | (cp >> 18));
    encoded[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    encoded[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    encoded[3] = (char)(0x80 | (cp & 0x3F));
    n = 4;
  }
  put(out, encoded, n);
}

static sprout_str result_of(const bytes *out) {
  sprout_str str;
  str.bytes = out->items == NULL ? "" : out->items;
  str.length = out->length;
  return str;
}

/* ---- keeping and folding ---- */

bool nickname_kept(sprout_arena *arena, sprout_str nickname, sprout_str *kept) {
  bytes out;
  size_t at = 0, width;
  bool pending = false;
  memset(&out, 0, sizeof out);
  out.arena = arena;
  while (at < nickname.length) {
    unsigned long cp = prose_decode(nickname.bytes, nickname.length, at, &width);
    if (prose_is_space(cp)) {
      pending = true;
    } else {
      if (pending && out.length > 0) put(&out, " ", 1);
      pending = false;
      put(&out, nickname.bytes + at, width);
    }
    at += width;
  }
  put(&out, "", 0);
  if (out.failed) return false;
  *kept = result_of(&out);
  return true;
}

/* Whether a cased letter follows `at` (or precedes it, walking backwards), past any case-ignorable code points. */
static bool cased_beside(const unsigned long *cps, size_t count, size_t at, bool forward) {
  size_t i = at;
  for (;;) {
    if (forward) {
      if (++i >= count) return false;
    } else {
      if (i == 0) return false;
      i--;
    }
    if (prose_unicode_case_ignorable(cps[i])) continue;
    return prose_unicode_cased(cps[i]);
  }
}

sprout_status nickname_typed_words(sprout_arena *arena, sprout_str text, sprout_str **words, size_t *count) {
  unsigned long *cps = (unsigned long *)sprout_arena_take(arena, (text.length + 1) * sizeof *cps);
  size_t n = 0, at = 0, width, i, made = 0;
  sprout_str *found = (sprout_str *)sprout_arena_take(arena, (text.length + 1) * sizeof *found);
  bytes word;
  if (cps == NULL || found == NULL) return SPROUT_NO_MEMORY;
  while (at < text.length) {
    cps[n++] = prose_decode(text.bytes, text.length, at, &width);
    at += width;
  }
  memset(&word, 0, sizeof word);
  word.arena = arena;
  for (i = 0; i <= n; i++) {
    unsigned long folded[2];
    size_t k, parts;
    bool boundary = i == n || prose_is_space(cps[i]) || cps[i] == ',';
    if (boundary && word.length > 0) {
      found[made++] = result_of(&word);
      memset(&word, 0, sizeof word);
      word.arena = arena;
    }
    if (i == n || prose_is_space(cps[i])) continue;
    if (cps[i] == ',') {
      put(&word, ",", 1);
      found[made++] = result_of(&word);
      memset(&word, 0, sizeof word);
      word.arena = arena;
      continue;
    }
    if (cps[i] == 0x3A3) {
      /* A capital sigma ends a word as a final sigma where a cased letter comes before it and none after. */
      folded[0] = cased_beside(cps, n, i, false) && !cased_beside(cps, n, i, true) ? 0x3C2 : 0x3C3;
      parts = 1;
    } else {
      parts = prose_unicode_lower(cps[i], folded);
    }
    for (k = 0; k < parts; k++) put_code_point(&word, folded[k]);
  }
  if (word.failed) return SPROUT_NO_MEMORY;
  *words = found;
  *count = made;
  return SPROUT_OK;
}

/* A nickname's words joined by single spaces: how it is typed, and so what two alike nicknames share. */
static sprout_status typed_as(sprout_arena *arena, sprout_str text, sprout_str *typed) {
  sprout_str *words;
  size_t count, i;
  bytes out;
  sprout_status status = nickname_typed_words(arena, text, &words, &count);
  if (status != SPROUT_OK) return status;
  memset(&out, 0, sizeof out);
  out.arena = arena;
  for (i = 0; i < count; i++) {
    if (i > 0) put(&out, " ", 1);
    put(&out, words[i].bytes, words[i].length);
  }
  put(&out, "", 0);
  if (out.failed) return SPROUT_NO_MEMORY;
  *typed = result_of(&out);
  return SPROUT_OK;
}

/* ---- the refusals' words ---- */

static bool same_text(sprout_str a, sprout_str b) { return a.length == b.length && memcmp(a.bytes, b.bytes, a.length) == 0; }

/* `words` each once, in the order first written. */
static size_t distinct(sprout_str *words, size_t count) {
  size_t kept = 0, i, j;
  for (i = 0; i < count; i++) {
    bool seen = false;
    for (j = 0; j < kept && !seen; j++) seen = same_text(words[j], words[i]);
    if (!seen) words[kept++] = words[i];
  }
  return kept;
}

/* Words written out as a person reads a list of them: `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
static void put_quoted(bytes *out, const sprout_str *words, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    if (i > 0) put_text(out, i + 1 == count ? " and " : ", ");
    put_text(out, "\"");
    put(out, words[i].bytes, words[i].length);
    put_text(out, "\"");
  }
}

static sprout_status refused(sprout_arena *arena, nickname_check *out, sprout_nickname_reason reason, sprout_str kept,
                             sprout_str *collides, size_t collide_count, const bytes *words) {
  if (words->failed) return SPROUT_NO_MEMORY;
  (void)arena;
  out->reason = reason;
  out->kept = kept;
  out->words = result_of(words);
  out->collide_count = collide_count;
  out->collides = collides;
  return SPROUT_OK;
}

static bool is_connector(sprout_str word) {
  return (word.length == 3 && memcmp(word.bytes, "and", 3) == 0) || (word.length == 1 && word.bytes[0] == ',');
}

static bool in_word_set(const sprout_world *world, sprout_str word) {
  size_t i;
  for (i = 0; i < world->word_count; i++)
    if (strlen(world->words[i]) == word.length && memcmp(world->words[i], word.bytes, word.length) == 0) return true;
  return false;
}

/* The words of `kept` split on single spaces, as written. */
static sprout_status split_spaces(sprout_arena *arena, sprout_str kept, sprout_str **words, size_t *count) {
  sprout_str *found = (sprout_str *)sprout_arena_take(arena, (kept.length + 1) * sizeof *found);
  size_t n = 0, start = 0, i;
  if (found == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i <= kept.length; i++) {
    if (i < kept.length && kept.bytes[i] != ' ') continue;
    found[n].bytes = kept.bytes + start;
    found[n].length = i - start;
    n++;
    start = i + 1;
  }
  *words = found;
  *count = n;
  return SPROUT_OK;
}

/* Whether a word has a period inside it: one with a code point before and a code point after. */
static bool period_inside(sprout_str word) {
  size_t at = 0, width, seen = 0;
  while (at < word.length) {
    unsigned long cp = prose_decode(word.bytes, word.length, at, &width);
    if (cp == '.' && seen >= 1 && at + width < word.length) return true;
    seen++;
    at += width;
  }
  return false;
}

static bool held_by_other(const sprout_state *state, sprout_arena *arena, sprout_str visit, sprout_str wanted,
                          bool *held) {
  size_t i;
  *held = false;
  for (i = 0; i < state->visitor_count && !*held; i++) {
    const sprout_stored_visitor *other = &state->visitors[i];
    const sprout_stored_instance *instance;
    sprout_str theirs;
    if (sprout_str_same(other->visit, visit)) continue;
    if (typed_as(arena, other->nickname, &theirs) != SPROUT_OK) return false;
    if (!same_text(theirs, wanted)) continue;
    instance = sprout_state_find(state, other->instance);
    *held = instance != NULL && instance->has_container;
  }
  return true;
}

sprout_status nickname_check_for(sprout_arena *arena, const sprout_world *world, const sprout_state *state,
                                 const sprout_budgets *budgets, sprout_str visit, sprout_str nickname,
                                 nickname_check *out) {
  sprout_str kept, *words, *spaced, *shaped, typed_kept, mine;
  size_t word_count, spaced_count, shaped_count = 0, characters, at, width, i, collides = 0;
  bytes text;
  bool bad_character = false, held;
  const sprout_stored_visitor *record;
  sprout_status status;
  memset(out, 0, sizeof *out);
  memset(&text, 0, sizeof text);
  text.arena = arena;
  if (!nickname_kept(arena, nickname, &kept)) return SPROUT_NO_MEMORY;
  out->kept = kept;
  if (kept.length == 0) {
    put_text(&text, "Choose a nickname to be known by here.");
    return refused(arena, out, SPROUT_NICKNAME_EMPTY, kept, NULL, 0, &text);
  }
  for (at = 0; at < kept.length && !bad_character; at += width)
    bad_character = prose_unicode_control_or_format(prose_decode(kept.bytes, kept.length, at, &width));
  if (bad_character) {
    put_text(&text, "A nickname is words and nothing else: choose one without hidden or control characters.");
    return refused(arena, out, SPROUT_NICKNAME_NOT_WORDS, kept, NULL, 0, &text);
  }
  characters = prose_characters(kept);
  if (budgets->nickname_characters.set && characters > budgets->nickname_characters.value) {
    put_text(&text, "\"");
    put(&text, kept.bytes, kept.length);
    put_text(&text, "\" is ");
    put_number(&text, characters);
    put_text(&text, " characters, and a nickname here may have at most ");
    put_number(&text, budgets->nickname_characters.value);
    put_text(&text, ": choose a shorter one.");
    return refused(arena, out, SPROUT_NICKNAME_TOO_LONG, kept, NULL, 0, &text);
  }
  /* A word beginning with a colon is how a property is written, and a period inside a word is how a path is. */
  status = split_spaces(arena, kept, &spaced, &spaced_count);
  if (status != SPROUT_OK) return status;
  shaped = (sprout_str *)sprout_arena_take(arena, (spaced_count + 1) * sizeof *shaped);
  if (shaped == NULL) return SPROUT_NO_MEMORY;
  {
    bool colons = false, periods = false;
    for (i = 0; i < spaced_count; i++) {
      bool colon = spaced[i].length > 0 && spaced[i].bytes[0] == ':', period = period_inside(spaced[i]);
      colons = colons || colon;
      periods = periods || period;
      if (colon || period) shaped[shaped_count++] = spaced[i];
    }
    if (shaped_count > 0) {
      shaped_count = distinct(shaped, shaped_count);
      put_text(&text, "A nickname's word may not ");
      put_text(&text, !colons ? "have a period inside it"
                              : !periods ? "begin with a colon" : "begin with a colon or have a period inside it");
      put_text(&text, ", and ");
      put_quoted(&text, shaped, shaped_count);
      put_text(&text, shaped_count == 1 ? " does" : " do");
      put_text(&text, ": choose another nickname.");
      return refused(arena, out, SPROUT_NICKNAME_SOURCE_SHAPED, kept, shaped, shaped_count, &text);
    }
  }
  status = nickname_typed_words(arena, kept, &words, &word_count);
  if (status != SPROUT_OK) return status;
  for (i = 0; i < word_count; i++)
    if (in_word_set(world, words[i]) || is_connector(words[i])) words[collides++] = words[i];
  if (collides > 0) {
    sprout_str *hit = (sprout_str *)sprout_arena_take(arena, collides * sizeof *hit);
    if (hit == NULL) return SPROUT_NO_MEMORY;
    memcpy(hit, words, collides * sizeof *hit);
    collides = distinct(hit, collides);
    /* A returning visitor's own nickname can only collide after a republish added the word. */
    record = sprout_state_find_visitor(state, visit);
    if (record != NULL) {
      status = typed_as(arena, record->nickname, &mine);
      if (status != SPROUT_OK) return status;
      status = typed_as(arena, kept, &typed_kept);
      if (status != SPROUT_OK) return status;
      if (same_text(mine, typed_kept)) put_text(&text, "Since you were last here, ");
    }
    put_quoted(&text, hit, collides);
    put_text(&text, collides == 1 ? " is a word" : " are words");
    put_text(&text, " this world already reads, so \"");
    put(&text, kept.bytes, kept.length);
    put_text(&text, "\" would not always mean you: choose another nickname.");
    return refused(arena, out, SPROUT_NICKNAME_WORLD_WORD, kept, hit, collides, &text);
  }
  /* The typed words again, for the reserved ones: collisions above removed nothing from the list the second pass needs. */
  status = nickname_typed_words(arena, kept, &words, &word_count);
  if (status != SPROUT_OK) return status;
  collides = 0;
  for (i = 0; i < word_count; i++)
    if (is_reserved(words[i])) words[collides++] = words[i];
  if (collides > 0) {
    collides = distinct(words, collides);
    put_quoted(&text, words, collides);
    put_text(&text, collides == 1 ? " is a word" : " are words");
    put_text(&text, " every world here reads, so \"");
    put(&text, kept.bytes, kept.length);
    put_text(&text, "\" would not always mean you: choose another nickname.");
    return refused(arena, out, SPROUT_NICKNAME_RESERVED, kept, words, collides, &text);
  }
  status = typed_as(arena, kept, &typed_kept);
  if (status != SPROUT_OK) return status;
  if (!held_by_other(state, arena, visit, typed_kept, &held)) return SPROUT_NO_MEMORY;
  if (held) {
    put_text(&text, "Someone here is already called \"");
    put(&text, kept.bytes, kept.length);
    put_text(&text, "\": choose another nickname.");
    return refused(arena, out, SPROUT_NICKNAME_HELD, kept, NULL, 0, &text);
  }
  out->reason = SPROUT_NICKNAME_OK;
  return SPROUT_OK;
}

/* ---- the public call ---- */

typedef struct admitted {
  sprout_host host;
  sprout_arena anchor, arena;
} admitted;

sprout_status sprout_admit(const sprout_world *world, const sprout_state *state, const sprout_host *host,
                           const char *visit, const char *nickname, size_t nickname_length,
                           sprout_admission *admission) {
  sprout_arena boot;
  admitted *keep;
  nickname_check checked;
  sprout_str key, given;
  sprout_status status;
  if (admission == NULL) return SPROUT_BAD_HOST;
  memset(admission, 0, sizeof *admission);
  if (world == NULL || state == NULL || host == NULL || visit == NULL || nickname == NULL) return SPROUT_BAD_INPUT;
  status = sprout_arena_init(&boot, host);
  if (status != SPROUT_OK) return status;
  keep = (admitted *)sprout_arena_take(&boot, sizeof *keep);
  if (keep == NULL) {
    sprout_arena_reset(&boot);
    return SPROUT_NO_MEMORY;
  }
  keep->host = *host;
  keep->anchor = boot;
  keep->anchor.host = &keep->host;
  sprout_arena_init(&keep->arena, &keep->host);
  key.bytes = visit;
  key.length = strlen(visit);
  given.bytes = nickname;
  given.length = nickname_length;
  status = nickname_check_for(&keep->arena, world, state, &host->budgets, key, given, &checked);
  if (status != SPROUT_OK) {
    sprout_arena anchor = keep->anchor, data = keep->arena;
    sprout_host copy = keep->host;
    anchor.host = &copy;
    data.host = &copy;
    sprout_arena_reset(&data);
    sprout_arena_reset(&anchor);
    return status;
  }
  admission->reason = checked.reason;
  admission->kept = checked.kept;
  admission->words = checked.words;
  admission->collide_count = checked.collide_count;
  admission->collides = checked.collides;
  admission->held = keep;
  return SPROUT_OK;
}

void sprout_admission_free(sprout_admission *admission) {
  admitted *keep;
  sprout_arena anchor, data;
  sprout_host host;
  if (admission == NULL || admission->held == NULL) return;
  keep = (admitted *)admission->held;
  host = keep->host;
  anchor = keep->anchor;
  data = keep->arena;
  anchor.host = &host;
  data.host = &host;
  sprout_arena_reset(&data);
  sprout_arena_reset(&anchor);
  memset(admission, 0, sizeof *admission);
}
