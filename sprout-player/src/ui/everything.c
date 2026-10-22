/* What `everything` takes on a level of the sentence builder; see everything.h. */
#include "everything.h"

#include <string.h>

#include "budgets.h"

static bool same_str(sprout_str a, sprout_str b) {
  return a.length == b.length && (a.length == 0 || memcmp(a.bytes, b.bytes, a.length) == 0);
}

static bool same_text(const char *a, const char *b) { return a == b || (a != NULL && b != NULL && strcmp(a, b) == 0); }

size_t everything_most(void) {
  sprout_budgets budgets;
  memset(&budgets, 0, sizeof budgets);
  player_budgets(&budgets);
  return budgets.set_role_objects.set ? (size_t)budgets.set_role_objects.value : (size_t)-1;
}

bool everything_takes(const sentence_choice *choice) {
  const sprout_seen_filler *filler = choice->filler;
  if (choice->greyed == PLAYER_GREYED_YES) return false;
  if (filler->binds == SPROUT_SEEN_SET) return filler->member_count == 1 && filler->all;
  return filler->binds == SPROUT_SEEN_OBJECT && filler->all;
}

bool everything_offered(const sentence *s) {
  size_t i, count = 0;
  for (i = 0; i < s->choice_count && count < 2; i++)
    if (sentence_offers(s, &s->choices[i]) && everything_takes(&s->choices[i]) &&
        (s->choices[i].filler->binds == SPROUT_SEEN_SET || s->state.each_pick == 0))
      count++;
  return count >= 2;
}

/* Whether two fillers fill the same role with the same thing, set or way out. */
static bool same_filler(const sprout_seen_filler *a, const sprout_seen_filler *b) {
  if (a->binds != b->binds || !same_text(a->role, b->role)) return false;
  switch (a->binds) {
    case SPROUT_SEEN_OBJECT:
      return same_str(a->thing.id, b->thing.id);
    case SPROUT_SEEN_SET:
      return a->member_count > 0 && b->member_count > 0 && same_str(a->members[0].id, b->members[0].id);
    case SPROUT_SEEN_EXIT:
      return same_str(a->exit.to, b->exit.to) && same_text(a->exit.direction, b->exit.direction) &&
             same_text(a->exit.label, b->exit.label);
    default:
      return true;
  }
}

/* Whether `leaf` takes each value role the sentence filled, with the word or number it was filled with. */
static bool values_fit(const sprout_seen_reading *leaf, const sentence_state *state) {
  size_t i, r, k;
  for (i = 0; i < state->value_count; i++) {
    const sentence_value *value = &state->values[i];
    const sprout_seen_options *role = NULL;
    bool fits = false;
    for (r = 0; r < leaf->options_count && role == NULL; r++)
      if (same_text(leaf->options[r].role, value->role->role)) role = &leaf->options[r];
    if (role == NULL) return false;
    if (value->option != NULL) {
      for (k = 0; k < role->option_count && !fits; k++) fits = same_str(role->options[k].value, value->option->value);
    } else {
      for (k = 0; k < role->range_count && !fits; k++) fits = role->ranges[k].min <= value->number && value->number <= role->ranges[k].max;
    }
    if (!fits) return false;
  }
  return true;
}

void everything_plan(sentence *s) {
  const sentence_state *state = &s->state;
  size_t most = everything_most(), at = state->each_pick, k, d, j;
  size_t path[SENTENCE_MOST_PARTS];
  s->each_count = 0;
  for (k = 0; k < state->each_count && s->each_count < most; k++) {
    const sprout_seen_filler *thing;
    player_chip_level level;
    bool found = true;
    memcpy(path, state->path, state->depth * sizeof *path);
    level = player_chips(s->session, path, at);
    if (!level.ok || state->each_choices[k] > level.choice_count) continue;
    thing = level.choices[state->each_choices[k] - 1].filler;
    path[at] = state->each_choices[k];
    /* The picks after it are found again under this thing, by what they fill the role with. */
    for (d = at + 1; d < state->depth && found; d++) {
      level = player_chips(s->session, path, d);
      found = false;
      for (j = 0; level.ok && j < level.choice_count && !found; j++)
        if (same_filler(level.choices[j].filler, state->picks[d - 1].filler)) {
          path[d] = j + 1;
          found = true;
        }
    }
    if (!found) continue;
    level = player_chips(s->session, path, state->depth);
    if (!level.ok || level.leaf == NULL || level.leaf->refused || !values_fit(level.leaf, state)) continue;
    s->each[s->each_count++] = thing;
  }
}

