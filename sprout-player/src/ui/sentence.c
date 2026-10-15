/* The sentence builder's state; see sentence.h. */
#include "sentence.h"

#include <string.h>

#include "everything.h"
#include "host/files.h"

#define NO_MEMORY "The player ran out of memory building that."
#define TOO_LONG "This sentence has more parts than the player can hold."
#define CANNOT "That cannot be done."
#define NOTHING_HERE "Nothing can be done here."
#define NOTHING_FITS "Nothing here fits that."
#define EVERYTHING "everything"

/* What the disc shows when there was no memory to say more. */
static const sentence_entry LOST = {SENTENCE_ENTRY_NONE, "", true, NO_MEMORY, 0, 0, 0};

/* ---- memory ---- */

/* Makes room for `want` items of `unit` bytes in the block at `*block`, which holds `*room`. */
static bool grow(PlaydateAPI *pd, void **block, size_t *room, size_t want, size_t unit) {
  size_t bigger = *room < 16 ? 16 : *room;
  void *moved;
  if (want <= *room) return true;
  while (bigger < want) bigger *= 2;
  moved = pd->system->realloc(*block, bigger * unit);
  if (moved == NULL) return false;
  *block = moved;
  *room = bigger;
  return true;
}

/* Appends the `n` bytes at `bytes` to the string being made at the end of `t`, which stays NUL-terminated. */
static bool add(PlaydateAPI *pd, sentence_text *t, const char *bytes, size_t n) {
  void *block = t->bytes;
  if (!grow(pd, &block, &t->room, t->length + n + 1, 1)) return false;
  t->bytes = (char *)block;
  if (n > 0) memcpy(t->bytes + t->length, bytes, n);
  t->length += n;
  t->bytes[t->length] = '\0';
  return true;
}

static bool add_text(PlaydateAPI *pd, sentence_text *t, const char *text) { return add(pd, t, text, strlen(text)); }

/* Ends the string begun at `start`: 1 + its offset, or 0 where there was no memory. */
static size_t close_at(PlaydateAPI *pd, sentence_text *t, size_t start, bool ok) {
  if (!ok || !add(pd, t, "", 0)) return 0;
  t->length++;
  return start + 1;
}

static const char *words_at(const sentence_text *t, size_t at) { return at == 0 ? NULL : t->bytes + at - 1; }

/* Appends to the kept words the kept words at `at`, which may move as the block grows. */
static bool add_kept(sentence *s, size_t at) {
  size_t n = strlen(words_at(&s->kept, at));
  void *block = s->kept.bytes;
  if (!grow(s->pd, &block, &s->kept.room, s->kept.length + n + 1, 1)) return false;
  s->kept.bytes = (char *)block;
  memcpy(s->kept.bytes + s->kept.length, s->kept.bytes + at - 1, n);
  s->kept.length += n;
  s->kept.bytes[s->kept.length] = '\0';
  return true;
}

/* ---- labels ---- */

/* A verb's name without its library, its underscores as spaces: `sprout.pick_up` is `pick up`. */
static bool add_verb(PlaydateAPI *pd, sentence_text *t, const char *qualified) {
  const char *name = strrchr(qualified, '.');
  size_t from = t->length, i;
  name = name == NULL ? qualified : name + 1;
  if (!add_text(pd, t, name)) return false;
  for (i = from; i < t->length; i++)
    if (t->bytes[i] == '_') t->bytes[i] = ' ';
  return true;
}

static bool add_names(PlaydateAPI *pd, sentence_text *t, const sprout_seen_thing *const *things, size_t count) {
  size_t i;
  for (i = 0; i < count; i++)
    if ((i > 0 && !add_text(pd, t, ", ")) || !add(pd, t, things[i]->name.bytes, things[i]->name.length)) return false;
  return true;
}

/* What a filler is called on the disc: a thing's name, a set's names, a way out's direction or label. */
static bool add_filler(PlaydateAPI *pd, sentence_text *t, const sprout_seen_filler *filler) {
  size_t i;
  switch (filler->binds) {
    case SPROUT_SEEN_OBJECT:
      return add(pd, t, filler->thing.name.bytes, filler->thing.name.length);
    case SPROUT_SEEN_SET:
      for (i = 0; i < filler->member_count; i++)
        if ((i > 0 && !add_text(pd, t, ", ")) || !add(pd, t, filler->members[i].name.bytes, filler->members[i].name.length))
          return false;
      return true;
    case SPROUT_SEEN_EXIT:
      return add_text(pd, t, filler->exit.direction != NULL ? filler->exit.direction : filler->exit.label);
    default:
      return add_text(pd, t, filler->role);
  }
}

/* A whole number as digits, with its sign. */
static bool add_number(PlaydateAPI *pd, sentence_text *t, double number) {
  char digits[32];
  size_t at = sizeof digits;
  long long whole = (long long)number;
  unsigned long long left = whole < 0 ? (unsigned long long)(-(whole + 1)) + 1u : (unsigned long long)whole;
  digits[--at] = '\0';
  do {
    digits[--at] = (char)('0' + (int)(left % 10u));
    left /= 10u;
  } while (left > 0);
  if (whole < 0) digits[--at] = '-';
  return add_text(pd, t, digits + at);
}

/* A refusal's paragraphs as one line. */
static bool add_refusal(PlaydateAPI *pd, sentence_text *t, const sprout_seen_reading *leaf) {
  size_t i;
  for (i = 0; i < leaf->refusal_count; i++)
    if ((i > 0 && !add_text(pd, t, " ")) || !add(pd, t, leaf->refusal[i].bytes, leaf->refusal[i].length)) return false;
  return true;
}

/* ---- numbers ---- */

/* The nearest number the role takes at or beyond `from` in direction `dir` (1 or -1); false where there is none. */
static bool step_number(const sprout_seen_options *role, double from, int dir, double *out) {
  size_t i;
  bool found = false;
  for (i = 0; i < role->range_count; i++) {
    const sprout_seen_range *range = &role->ranges[i];
    double candidate;
    if (dir > 0) {
      candidate = from > range->min ? from : range->min;
      if (candidate <= range->max && (!found || candidate < *out)) {
        *out = candidate;
        found = true;
      }
    } else {
      candidate = from < range->max ? from : range->max;
      if (candidate >= range->min && (!found || candidate > *out)) {
        *out = candidate;
        found = true;
      }
    }
  }
  return found;
}

/* The last number the role takes (`dir` 1) or the first (`dir` -1); false where it takes none. */
static bool edge(const sprout_seen_options *role, int dir, double *out) {
  size_t i;
  bool found = false;
  for (i = 0; i < role->range_count; i++) {
    double value = dir > 0 ? role->ranges[i].max : role->ranges[i].min;
    if (role->ranges[i].min > role->ranges[i].max) continue;
    if (!found || (dir > 0 && value > *out) || (dir < 0 && value < *out)) {
      *out = value;
      found = true;
    }
  }
  return found;
}

static const sprout_seen_options *role_of(const sentence_state *state) {
  return state->leaf != NULL && state->role < state->leaf->options_count ? &state->leaf->options[state->role] : NULL;
}

/* ---- the level the disc shows ---- */

/* Copies the level at `path` from the session; NULL, or the words for why it cannot be had. */
static const char *fetch(sentence *s, const size_t *path, size_t depth, size_t *empty_reason) {
  player_chip_level level = player_chips(s->session, path, depth);
  void *block = s->choices;
  size_t i;
  s->choice_count = 0;
  s->leaf = NULL;
  s->level_words.length = 0;
  if (empty_reason != NULL) *empty_reason = 0;
  if (!level.ok) return level.reason != NULL ? level.reason : CANNOT;
  if (!grow(s->pd, &block, &s->choice_room, level.choice_count + 1, sizeof *s->choices)) return NO_MEMORY;
  s->choices = (sentence_choice *)block;
  for (i = 0; i < level.choice_count; i++) {
    const player_chip *chip = &level.choices[i];
    sentence_choice *choice = &s->choices[i];
    choice->verb = chip->verb;
    choice->filler = chip->filler;
    choice->greyed = chip->greyed;
    choice->reason = 0;
    if (chip->reason != NULL) {
      size_t start = s->level_words.length;
      choice->reason = close_at(s->pd, &s->level_words, start, add_text(s->pd, &s->level_words, chip->reason));
      if (choice->reason == 0) return NO_MEMORY;
    }
  }
  s->choice_count = level.choice_count;
  s->leaf = level.leaf;
  if (empty_reason != NULL && level.choice_count == 0 && level.leaf == NULL) {
    /* Nothing under the verb fits: the verb's own words say why, kept for the confirm step. */
    const char *why = level.verb != NULL && level.verb->reason != NULL ? level.verb->reason : NOTHING_FITS;
    size_t start = s->kept.length;
    *empty_reason = close_at(s->pd, &s->kept, start, add_text(s->pd, &s->kept, why));
    if (*empty_reason == 0) return NO_MEMORY;
  }
  return NULL;
}

/* ---- what the disc shows ---- */

/* One entry, its label made by `label` beforehand at `label_at`; its reason copied when it has one. */
static bool push_entry(sentence *s, sentence_kind kind, size_t label_at, bool greyed, const char *reason, size_t index) {
  void *block = s->entries;
  sentence_entry *entry;
  if (label_at == 0 || !grow(s->pd, &block, &s->entry_room, s->entry_count + 1, sizeof *s->entries)) return false;
  s->entries = (sentence_entry *)block;
  entry = &s->entries[s->entry_count++];
  entry->kind = kind;
  entry->greyed = greyed;
  entry->index = index;
  /* The strings are found by offset until every entry is made, since the words move as they grow. */
  entry->label_at = label_at;
  entry->reason_at = 0;
  if (reason != NULL) {
    size_t start = s->shown.length;
    entry->reason_at = close_at(s->pd, &s->shown, start, add_text(s->pd, &s->shown, reason));
    if (entry->reason_at == 0) return false;
  }
  return true;
}

/* A label of fixed words. */
static size_t label_of(sentence *s, const char *text) {
  size_t start = s->shown.length;
  return close_at(s->pd, &s->shown, start, add_text(s->pd, &s->shown, text));
}

/*
 * The sentence so far into `t`: a pick made as `everything` says so, but where `each` names the thing a turn of
 * a role that takes one thing is run for, which stands in its place.
 */
static bool phrase_into(sentence *s, sentence_text *t, const sprout_seen_filler *each) {
  const sentence_state *state = &s->state;
  bool ok = true;
  size_t i, parts = 0;
  t->length = 0;
  ok = add(s->pd, t, "", 0);
  if (ok && state->verb != NULL) {
    ok = add_verb(s->pd, t, state->verb);
    parts++;
  }
  for (i = 0; ok && i < state->pick_count; i++, parts++) {
    const sentence_filled *pick = &state->picks[i];
    ok = parts == 0 || add_text(s->pd, t, " -> ");
    if (!ok) break;
    if (each != NULL && i + 1 == state->each_pick)
      ok = add_filler(s->pd, t, each);
    else if (pick->everything)
      ok = add_text(s->pd, t, EVERYTHING);
    else
      ok = pick->filler->binds == SPROUT_SEEN_SET ? add_names(s->pd, t, &state->joined[pick->first], pick->count)
                                                   : add_filler(s->pd, t, pick->filler);
  }
  for (i = 0; ok && i < state->member_count; i++)
    ok = add_text(s->pd, t, i == 0 ? (parts++ == 0 ? "" : " -> ") : ", ") &&
         add(s->pd, t, state->members[i].thing->name.bytes, state->members[i].thing->name.length);
  for (i = 0; ok && i < state->value_count; i++, parts++) {
    const sentence_value *value = &state->values[i];
    ok = (parts == 0 || add_text(s->pd, t, " -> ")) &&
         (value->option != NULL ? add(s->pd, t, value->option->words.bytes, value->option->words.length)
                                : add_number(s->pd, t, value->number));
  }
  return ok;
}

static bool make_phrase(sentence *s) { return phrase_into(s, &s->phrase, NULL); }

/* Whether the set being joined holds the thing `id` already. */
static bool joined_already(const sentence_state *state, sprout_str id) {
  size_t i;
  for (i = 0; i < state->member_count; i++)
    if (state->members[i].thing->id.length == id.length && memcmp(state->members[i].thing->id.bytes, id.bytes, id.length) == 0)
      return true;
  return false;
}

static bool make_entries(sentence *s) {
  const sentence_state *state = &s->state;
  size_t i, start;
  if (state->stage == SENTENCE_VERB) {
    for (i = 0; i < s->choice_count; i++) {
      const sentence_choice *choice = &s->choices[i];
      bool greyed = choice->greyed == PLAYER_GREYED_YES;
      start = s->shown.length;
      if (!push_entry(s, SENTENCE_ENTRY_VERB, close_at(s->pd, &s->shown, start, add_verb(s->pd, &s->shown, choice->verb)),
                      greyed, greyed ? words_at(&s->level_words, choice->reason) : NULL, i))
        return false;
    }
  } else if (state->stage == SENTENCE_FILLER || state->stage == SENTENCE_MORE) {
    bool more = state->stage == SENTENCE_MORE;
    if (!more && everything_offered(s) && !push_entry(s, SENTENCE_ENTRY_EVERYTHING, label_of(s, EVERYTHING), false, NULL, 0))
      return false;
    for (i = 0; i < s->choice_count; i++) {
      const sentence_choice *choice = &s->choices[i];
      bool greyed = choice->greyed == PLAYER_GREYED_YES;
      if (more && (choice->filler->binds != SPROUT_SEEN_SET || choice->filler->member_count == 0 ||
                   joined_already(state, choice->filler->members[0].id)))
        continue;
      start = s->shown.length;
      if (!push_entry(s, more ? SENTENCE_ENTRY_MEMBER : SENTENCE_ENTRY_FILLER,
                      close_at(s->pd, &s->shown, start,
                               (!more || add_text(s->pd, &s->shown, "and ")) && add_filler(s->pd, &s->shown, choice->filler)),
                      greyed, greyed ? words_at(&s->level_words, choice->reason) : NULL, i))
        return false;
    }
    if (more || s->leaf != NULL) {
      bool refused = !more && s->leaf->refused;
      const char *reason = NULL;
      if (refused) {
        start = s->kept.length;
        reason = words_at(&s->kept, close_at(s->pd, &s->kept, start, add_refusal(s->pd, &s->kept, s->leaf)));
        s->kept.length = start; /* only borrowed: it is copied into the entry below */
      }
      if (!push_entry(s, SENTENCE_ENTRY_DONE, label_of(s, "that's all"), refused, reason, 0)) return false;
    }
  } else if (state->stage == SENTENCE_OPTION) {
    const sprout_seen_options *role = role_of(state);
    if (role->symbol) {
      for (i = 0; i < role->option_count; i++) {
        start = s->shown.length;
        if (!push_entry(s, SENTENCE_ENTRY_OPTION,
                        close_at(s->pd, &s->shown, start, add(s->pd, &s->shown, role->options[i].words.bytes, role->options[i].words.length)),
                        false, NULL, i))
          return false;
      }
      if (role->option_count == 0 &&
          !push_entry(s, SENTENCE_ENTRY_NONE, label_of(s, "nothing to say"), true, "Nothing here can be said about that.", 0))
        return false;
    } else if (!state->has_number) {
      if (!push_entry(s, SENTENCE_ENTRY_NONE, label_of(s, "no number"), true, "No number fits here.", 0)) return false;
    } else {
      start = s->shown.length;
      if (!push_entry(s, SENTENCE_ENTRY_NUMBER, close_at(s->pd, &s->shown, start, add_number(s->pd, &s->shown, state->number)),
                      false, NULL, 0))
        return false;
    }
  } else {
    const char *reason = NULL;
    bool each = state->each_pick != 0, runs;
    if (each) everything_plan(s);
    /* With `everything`, the first thing's reading may be refused where another's is not: those that can run, run. */
    runs = each && s->each_count > 0;
    if (state->leaf != NULL && state->leaf->refused && !runs) {
      start = s->kept.length;
      reason = words_at(&s->kept, close_at(s->pd, &s->kept, start, add_refusal(s->pd, &s->kept, state->leaf)));
      s->kept.length = start;
      if (reason == NULL) return false;
    } else if (state->refusal != 0) {
      reason = words_at(&s->kept, state->refusal);
    } else if (state->leaf == NULL) {
      reason = state->empty_reason != 0 ? words_at(&s->kept, state->empty_reason) : NOTHING_FITS;
    } else if (each && !runs) {
      reason = NOTHING_FITS;
    }
    start = s->shown.length;
    if (!push_entry(s, SENTENCE_ENTRY_CONFIRM, close_at(s->pd, &s->shown, start, add_text(s->pd, &s->shown, sentence_phrase(s))),
                    reason != NULL, reason, 0))
      return false;
  }
  return true;
}

/* Makes the phrase and the entries again after the state changed. */
static void refresh(sentence *s) {
  size_t i;
  s->made++;
  s->entry_count = 0;
  s->shown.length = 0;
  if (!make_phrase(s)) s->phrase.length = 0;
  if (!make_entries(s)) {
    s->entry_count = 0;
    return;
  }
  for (i = 0; i < s->entry_count; i++) {
    sentence_entry *entry = &s->entries[i];
    entry->label = words_at(&s->shown, entry->label_at);
    entry->reason = words_at(&s->shown, entry->reason_at);
  }
  if (s->state.selected >= s->entry_count) s->state.selected = 0;
}

/* ---- the state ---- */

/* Begins the value role `state->role`, or the confirmation when none is left. */
static void start_role(sentence_state *state) {
  const sprout_seen_options *role = role_of(state);
  if (role == NULL) {
    state->stage = SENTENCE_CONFIRM;
    return;
  }
  state->stage = SENTENCE_OPTION;
  state->has_number = !role->symbol && edge(role, -1, &state->number);
}

static void at_leaf(sentence_state *state, const sprout_seen_reading *leaf) {
  state->leaf = leaf;
  state->role = 0;
  start_role(state);
}

/* The builder arrives at the level `choice` names under the state's path: its fillers, or its leaf. NULL, or why not. */
static const char *arrive(sentence *s, sentence_state *state, size_t choice) {
  const char *why;
  if (state->depth == SENTENCE_MOST_PARTS) return TOO_LONG;
  state->path[state->depth++] = choice;
  why = fetch(s, state->path, state->depth, &state->empty_reason);
  if (why != NULL) return why;
  if (s->choice_count > 0)
    state->stage = SENTENCE_FILLER;
  else
    at_leaf(state, s->leaf);
  return NULL;
}

/* Adds the things of a set filler to the set being joined, each with the choice's refusal. */
static const char *join(sentence *s, sentence_state *state, const sentence_choice *choice) {
  size_t i, reason = 0;
  if (state->member_count + choice->filler->member_count > SENTENCE_MOST_MEMBERS) return TOO_LONG;
  if (choice->greyed == PLAYER_GREYED_YES && choice->reason != 0) {
    size_t start = s->kept.length;
    reason = close_at(s->pd, &s->kept, start, add_text(s->pd, &s->kept, words_at(&s->level_words, choice->reason)));
    if (reason == 0) return NO_MEMORY;
  }
  for (i = 0; i < choice->filler->member_count; i++) {
    state->members[state->member_count].thing = &choice->filler->members[i];
    state->members[state->member_count++].reason = reason;
  }
  return NULL;
}

/* The set joined becomes a pick, its first refused member's words the sentence's refusal, and the roles after it follow. */
static const char *close_set(sentence *s, sentence_state *state, bool everything) {
  sentence_filled *pick;
  size_t i;
  if (state->pick_count == SENTENCE_MOST_PARTS || state->joined_count + state->member_count > SENTENCE_MOST_MEMBERS) return TOO_LONG;
  pick = &state->picks[state->pick_count++];
  pick->filler = state->set;
  pick->first = state->joined_count;
  pick->count = state->member_count;
  pick->everything = everything;
  for (i = 0; i < state->member_count; i++) {
    const sentence_member *member = &state->members[i];
    state->joined[state->joined_count++] = member->thing;
    if (member->reason != 0 && state->refusal == 0) {
      size_t start = s->kept.length;
      bool ok = add(s->pd, &s->kept, member->thing->name.bytes, member->thing->name.length) && add_text(s->pd, &s->kept, ": ") &&
                add_kept(s, member->reason);
      state->refusal = close_at(s->pd, &s->kept, start, ok);
      if (state->refusal == 0) return NO_MEMORY;
    }
  }
  state->member_count = 0;
  state->set = NULL;
  return arrive(s, state, state->set_choice);
}

static const char *pick_value(sentence_state *state, const sprout_seen_option *option) {
  sentence_value *value;
  if (state->value_count == SENTENCE_MOST_PARTS) return TOO_LONG;
  value = &state->values[state->value_count++];
  value->role = role_of(state);
  value->option = option;
  value->number = option == NULL ? state->number : 0;
  state->has_number = false;
  state->role++;
  start_role(state);
  return NULL;
}

/*
 * `everything` picked: a set role joins every thing it takes, at most as many as a set role may bind, and goes
 * on; a role that takes one thing keeps them for the turns and goes on under the first.
 */
static const char *pick_everything(sentence *s, sentence_state *state) {
  size_t i, first = 0, count = 0, most = everything_most();
  bool set = false;
  const char *why;
  state->member_count = 0;
  for (i = 0; i < s->choice_count; i++) {
    const sentence_choice *choice = &s->choices[i];
    if (!everything_takes(s, choice)) continue;
    if (count == 0) {
      first = i;
      set = choice->filler->binds == SPROUT_SEEN_SET;
    }
    if (set) {
      if (count == most) break;
      why = join(s, state, choice);
      if (why != NULL) return why;
    } else {
      if (count == SENTENCE_MOST_MEMBERS) return TOO_LONG;
      state->each_choices[count] = i + 1;
    }
    count++;
  }
  if (count == 0) return CANNOT;
  if (set) {
    state->set = s->choices[first].filler;
    state->set_choice = first + 1;
    return close_set(s, state, true);
  }
  if (state->pick_count == SENTENCE_MOST_PARTS) return TOO_LONG;
  state->each_count = count;
  state->each_pick = state->pick_count + 1;
  state->picks[state->pick_count].filler = s->choices[first].filler;
  state->picks[state->pick_count].first = state->picks[state->pick_count].count = 0;
  state->picks[state->pick_count].everything = true;
  state->pick_count++;
  return arrive(s, state, first + 1);
}

bool sentence_begin(sentence *s, PlaydateAPI *pd, player_session *session, const sprout_seen_view *view, const char **why) {
  memset(s, 0, sizeof *s);
  s->pd = pd;
  s->session = session;
  s->view = view;
  s->state.stage = SENTENCE_VERB;
  *why = fetch(s, NULL, 0, NULL);
  if (*why == NULL && s->choice_count == 0) *why = NOTHING_HERE;
  if (*why != NULL) {
    sentence_free(s);
    return false;
  }
  if (!sentence_prepare(s)) refresh(s);
  return true;
}

void sentence_free(sentence *s) {
  player_free(s->pd, s->history);
  player_free(s->pd, s->choices);
  player_free(s->pd, s->level_words.bytes);
  player_free(s->pd, s->kept.bytes);
  player_free(s->pd, s->entries);
  player_free(s->pd, s->shown.bytes);
  player_free(s->pd, s->phrase.bytes);
  player_free(s->pd, s->each_phrase.bytes);
  memset(s, 0, sizeof *s);
}

const sentence_entry *sentence_entries(const sentence *s, size_t *count) {
  if (s->entry_count == 0) {
    *count = 1;
    return &LOST;
  }
  *count = s->entry_count;
  return s->entries;
}

const char *sentence_phrase(const sentence *s) { return s->phrase.length > 0 ? s->phrase.bytes : ""; }

void sentence_move(sentence *s, long steps) {
  size_t count;
  long n, at;
  sentence_entries(s, &count);
  n = (long)count;
  at = ((long)s->state.selected + steps) % n;
  s->state.selected = (size_t)(at < 0 ? at + n : at);
}

bool sentence_numbered(const sentence *s) {
  const sprout_seen_options *role = s->state.stage == SENTENCE_OPTION ? role_of(&s->state) : NULL;
  return role != NULL && !role->symbol;
}

void sentence_add_number(sentence *s, long steps, bool big) {
  const sprout_seen_options *role = role_of(&s->state);
  double unit = big ? SENTENCE_BIG_STEP : 1, next = 0;
  int dir = steps > 0 ? 1 : -1;
  long i, count = steps < 0 ? -steps : steps;
  if (!sentence_numbered(s) || !s->state.has_number) return;
  for (i = 0; i < count; i++) {
    bool found = step_number(role, s->state.number + dir * unit, dir, &next);
    if (!found && big) found = edge(role, dir, &next);
    if (found) s->state.number = next;
  }
  refresh(s);
}

void sentence_nudge(sentence *s, long steps) {
  if (sentence_numbered(s))
    sentence_add_number(s, steps, false);
  else
    sentence_move(s, steps);
}

long sentence_turn(sentence *s, float degrees) {
  float half = SENTENCE_DEGREES_PER_STEP / 2;
  long steps = 0;
  s->crank += degrees;
  for (; s->crank >= half; steps++) s->crank -= SENTENCE_DEGREES_PER_STEP;
  for (; s->crank < -half; steps--) s->crank += SENTENCE_DEGREES_PER_STEP;
  if (steps != 0) sentence_nudge(s, steps);
  return steps;
}

float sentence_fraction(const sentence *s) { return s->crank / SENTENCE_DEGREES_PER_STEP; }

void sentence_settle(sentence *s, float share) {
  s->crank *= 1 - share;
  if (s->crank > -0.5f && s->crank < 0.5f) s->crank = 0;
}

bool sentence_prepare(sentence *s) {
  size_t pick;
  if (s->state.stage != SENTENCE_VERB || s->state.selected >= s->choice_count) return false;
  if (s->choices[s->state.selected].greyed != PLAYER_GREYED_UNKNOWN) return false;
  pick = s->state.selected + 1;
  player_chips(s->session, &pick, 1);
  /* The root says of the verb now what its level said. */
  if (fetch(s, NULL, 0, NULL) != NULL) s->choice_count = 0;
  refresh(s);
  return true;
}

/* The level at the state's path asked for again, after the state went back to it. */
static void return_to(sentence *s) {
  size_t empty;
  if (s->state.stage == SENTENCE_VERB || s->state.stage == SENTENCE_FILLER || s->state.stage == SENTENCE_MORE)
    fetch(s, s->state.path, s->state.depth, &empty);
  refresh(s);
}

sentence_end sentence_pick(sentence *s, const char **words) {
  size_t count;
  const sentence_entry *entry = &sentence_entries(s, &count)[s->state.selected];
  sentence_state next;
  const sentence_choice *choice = NULL;
  const char *why = NULL;
  void *block = s->history;
  *words = NULL;
  if (entry->kind == SENTENCE_ENTRY_NONE || (entry->kind == SENTENCE_ENTRY_CONFIRM && entry->greyed)) {
    *words = entry->reason != NULL ? entry->reason : CANNOT;
    return SENTENCE_REFUSED;
  }
  if (entry->kind == SENTENCE_ENTRY_CONFIRM) return SENTENCE_DONE;
  if (!grow(s->pd, &block, &s->history_room, s->history_count + 1, sizeof *s->history)) {
    *words = NO_MEMORY;
    return SENTENCE_REFUSED;
  }
  s->history = (sentence_state *)block;
  s->history[s->history_count++] = s->state;
  next = s->state;
  if (entry->kind == SENTENCE_ENTRY_VERB || entry->kind == SENTENCE_ENTRY_FILLER || entry->kind == SENTENCE_ENTRY_MEMBER)
    choice = &s->choices[entry->index];
  switch (entry->kind) {
    case SENTENCE_ENTRY_VERB:
      next.verb = choice->verb;
      why = arrive(s, &next, entry->index + 1);
      break;
    case SENTENCE_ENTRY_FILLER:
      if (choice->filler->binds == SPROUT_SEEN_SET) {
        next.set = choice->filler;
        next.set_choice = entry->index + 1;
        next.member_count = 0;
        why = join(s, &next, choice);
        next.stage = SENTENCE_MORE;
      } else if (next.pick_count == SENTENCE_MOST_PARTS) {
        why = TOO_LONG;
      } else {
        next.picks[next.pick_count].filler = choice->filler;
        next.picks[next.pick_count].first = next.picks[next.pick_count].count = 0;
        next.picks[next.pick_count].everything = false;
        next.pick_count++;
        why = arrive(s, &next, entry->index + 1);
      }
      break;
    case SENTENCE_ENTRY_MEMBER:
      why = join(s, &next, choice);
      break;
    case SENTENCE_ENTRY_EVERYTHING:
      why = pick_everything(s, &next);
      break;
    case SENTENCE_ENTRY_DONE:
      if (next.stage == SENTENCE_MORE)
        why = close_set(s, &next, false);
      else
        at_leaf(&next, s->leaf);
      break;
    case SENTENCE_ENTRY_OPTION:
      why = pick_value(&next, &role_of(&next)->options[entry->index]);
      break;
    case SENTENCE_ENTRY_NUMBER:
      why = pick_value(&next, NULL);
      break;
    default:
      break;
  }
  if (why != NULL) {
    /* Nothing changed: the builder stays where it was, and the words say why. */
    s->state = s->history[--s->history_count];
    return_to(s);
    *words = why;
    return SENTENCE_REFUSED;
  }
  next.selected = 0;
  s->state = next;
  s->crank = 0;
  refresh(s);
  return SENTENCE_GOES_ON;
}

bool sentence_back(sentence *s) {
  if (s->history_count == 0) return false;
  s->state = s->history[--s->history_count];
  s->crank = 0;
  return_to(s);
  return true;
}

void sentence_reading(sentence *s, sprout_reading *reading) {
  const sentence_state *state = &s->state;
  size_t i, count = 0, k;
  memset(reading, 0, sizeof *reading);
  reading->verb = state->verb;
  for (i = 0; i < state->pick_count; i++) {
    const sentence_filled *pick = &state->picks[i];
    sprout_filling *filling = &s->fillings[count++];
    memset(filling, 0, sizeof *filling);
    filling->role = pick->filler->role;
    if (pick->filler->binds == SPROUT_SEEN_SET) {
      filling->binds = SPROUT_FILL_SET;
      for (k = 0; k < pick->count; k++) s->ids[pick->first + k] = state->joined[pick->first + k]->id.bytes;
      filling->ids = &s->ids[pick->first];
      filling->id_count = pick->count;
    } else if (pick->filler->binds == SPROUT_SEEN_EXIT) {
      filling->binds = SPROUT_FILL_EXIT;
      filling->id = pick->filler->exit.to.bytes;
      filling->direction = pick->filler->exit.direction;
      filling->label = pick->filler->exit.label;
    } else {
      filling->binds = SPROUT_FILL_OBJECT;
      filling->id = pick->filler->thing.id.bytes;
    }
  }
  for (i = 0; i < state->value_count; i++) {
    const sentence_value *value = &state->values[i];
    sprout_filling *filling = &s->fillings[count++];
    memset(filling, 0, sizeof *filling);
    filling->role = value->role->role;
    if (value->option != NULL) {
      filling->binds = SPROUT_FILL_TEXT;
      filling->text = value->option->value.bytes;
    } else {
      filling->binds = SPROUT_FILL_NUMBER;
      filling->number = value->number;
    }
  }
  reading->filling_count = count;
  reading->fillings = s->fillings;
}

size_t sentence_each_count(const sentence *s) { return s->state.stage == SENTENCE_CONFIRM && s->state.each_pick != 0 ? s->each_count : 0; }

void sentence_each(sentence *s, size_t k, sprout_reading *reading, const char **phrase) {
  sprout_filling *filling;
  sentence_reading(s, reading);
  filling = &s->fillings[s->state.each_pick - 1];
  filling->id = s->each[k]->thing.id.bytes;
  *phrase = phrase_into(s, &s->each_phrase, s->each[k]) ? s->each_phrase.bytes : sentence_phrase(s);
}
