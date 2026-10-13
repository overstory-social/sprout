/*
 * A turn's outcome as JSON a host keeps and hands on; see logged.h. The entry's shape is the log's own
 * (the spec's The runtime > The log): the turn's inputs and the budgets it ran under, what it was for, its
 * fault, what it said and who it cut short, each part at its level.
 */
#include "logged.h"

#include <string.h>

#include "seeds.h"
#include "state.h"

/* ---- nodes ---- */

static sprout_json *text_of(sprout_arena *arena, sprout_str s) {
  return sprout_json_text(arena, s.bytes == NULL ? "" : s.bytes, s.length);
}

static sprout_json *word(sprout_arena *arena, const char *s) { return sprout_json_text(arena, s, strlen(s)); }

static sprout_json *number(sprout_arena *arena, double n) {
  sprout_json *node = sprout_json_make(arena, SPROUT_JSON_NUMBER, 0);
  if (node != NULL) node->number = n;
  return node;
}

static sprout_json *truth(sprout_arena *arena, bool b) {
  sprout_json *node = sprout_json_make(arena, SPROUT_JSON_BOOL, 0);
  if (node != NULL) node->boolean = b;
  return node;
}

static sprout_json *nothing(sprout_arena *arena) { return sprout_json_make(arena, SPROUT_JSON_NULL, 0); }

/* Every member made: a member the host refused a page for is missing, and the whole is refused. */
static bool whole(const sprout_json *node, size_t members) { return node != NULL && node->count == members; }

static const char *kind_word(sprout_line_kind kind) {
  switch (kind) {
    case SPROUT_LINE_SAID:
      return "said";
    case SPROUT_LINE_TOLD:
      return "told";
    case SPROUT_LINE_REFUSED:
      return "refused";
    case SPROUT_LINE_DESCRIBED:
      return "described";
    case SPROUT_LINE_NOTICE:
      return "notice";
    case SPROUT_LINE_EXTENSION:
      return "extension";
  }
  return "";
}

/* ---- canonical order ---- */

sprout_json *sprout_logged_canonical(sprout_arena *arena, const sprout_json *node) {
  sprout_json *copy;
  size_t i, j;
  if (node == NULL) return NULL;
  copy = sprout_json_make(arena, node->kind, node->count);
  if (copy == NULL) return NULL;
  copy->boolean = node->boolean;
  copy->number = node->number;
  copy->bytes = node->bytes;
  copy->length = node->length;
  for (i = 0; i < node->count; i++) {
    sprout_json *member = sprout_logged_canonical(arena, node->items[i]);
    if (member == NULL) return NULL;
    sprout_json_adopt(copy, NULL, member);
    member->key = node->items[i]->key;
    member->key_length = node->items[i]->key_length;
  }
  if (copy->kind != SPROUT_JSON_OBJECT) return copy;
  /* Insertion sort by name in code-unit order: an object of a payload or an effect has few members. */
  for (i = 1; i < copy->count; i++) {
    sprout_json *one = copy->items[i];
    sprout_str key = {one->key, one->key_length};
    for (j = i; j > 0; j--) {
      sprout_str before = {copy->items[j - 1]->key, copy->items[j - 1]->key_length};
      if (sprout_str_compare(before, key) <= 0) break;
      copy->items[j] = copy->items[j - 1];
    }
    copy->items[j] = one;
  }
  for (i = 0; i < copy->count; i++) copy->items[i]->index = i;
  return copy;
}

/* ---- effects and faults ---- */

static sprout_json *written_of(sprout_arena *arena, const sprout_told_effect *effect) {
  sprout_json *list = sprout_json_make(arena, SPROUT_JSON_ARRAY, effect->written_count);
  size_t i;
  if (list == NULL) return NULL;
  for (i = 0; i < effect->written_count; i++) {
    const sprout_written *noted = &effect->written[i];
    sprout_json *where = sprout_json_make(arena, SPROUT_JSON_OBJECT, 3);
    if (where == NULL) return NULL;
    if (noted->passage) {
      sprout_json_adopt(where, "passage", word(arena, noted->name));
      sprout_json_adopt(where, "origin", word(arena, noted->origin));
      sprout_json_adopt(where, "at", word(arena, noted->at));
    } else {
      sprout_json_adopt(where, "line", word(arena, noted->at));
    }
    if (!whole(where, noted->passage ? 3 : 1)) return NULL;
    sprout_json_adopt(list, NULL, where);
  }
  return whole(list, effect->written_count) ? list : NULL;
}

/* One effect: the log's form carries its level and not where its words were written; the language's, the reverse. */
static sprout_json *effect_of(sprout_arena *arena, const sprout_outcome *outcome, const sprout_told_effect *effect,
                              bool logged) {
  sprout_json *one = sprout_json_make(arena, SPROUT_JSON_OBJECT, 10), *paragraphs;
  size_t i, members = 7;
  if (one == NULL) return NULL;
  paragraphs = sprout_json_make(arena, SPROUT_JSON_ARRAY, effect->line_count);
  if (paragraphs == NULL) return NULL;
  for (i = 0; i < effect->line_count; i++) {
    const sprout_line *line = &outcome->lines[effect->line_first + i];
    sprout_json_adopt(paragraphs, NULL, sprout_json_text(arena, line->text, line->text_length));
  }
  if (!whole(paragraphs, effect->line_count)) return NULL;
  sprout_json_adopt(one, "kind", word(arena, kind_word(effect->kind)));
  if (logged) sprout_json_adopt(one, "level", word(arena, "prose"));
  sprout_json_adopt(one, "from", text_of(arena, effect->from));
  sprout_json_adopt(one, "actor", effect->has_actor ? text_of(arena, effect->actor) : nothing(arena));
  sprout_json_adopt(one, "to", text_of(arena, effect->to));
  sprout_json_adopt(one, "visit", text_of(arena, effect->visit));
  sprout_json_adopt(one, "paragraphs", paragraphs);
  if (!logged) sprout_json_adopt(one, "written", written_of(arena, effect));
  if (effect->extension != NULL) {
    sprout_json_adopt(one, "extension", word(arena, effect->extension));
    sprout_json_adopt(one, "statement", word(arena, effect->statement));
    members += 2;
    /* Empty where the runtime holds no code for the extension, and so has no payload to give. */
    if (effect->payload.length > 0) {
      sprout_json *payload = NULL;
      sprout_json_error error;
      if (sprout_json_read(arena, effect->payload.bytes, effect->payload.length, &payload, &error) != SPROUT_OK)
        return NULL;
      sprout_json_adopt(one, "payload", payload);
      members++;
    }
  }
  return whole(one, members) ? one : NULL;
}

sprout_json *sprout_logged_effects(sprout_arena *arena, const sprout_outcome *outcome, bool logged) {
  sprout_json *list = sprout_json_make(arena, SPROUT_JSON_ARRAY, outcome->effect_count);
  size_t i;
  if (list == NULL) return NULL;
  for (i = 0; i < outcome->effect_count; i++)
    sprout_json_adopt(list, NULL, effect_of(arena, outcome, &outcome->effects[i], logged));
  return whole(list, outcome->effect_count) ? list : NULL;
}

sprout_json *sprout_logged_fault(sprout_arena *arena, const char *name, sprout_str detail,
                                 const sprout_fault_about *about, bool logged) {
  sprout_json *fault = sprout_json_make(arena, SPROUT_JSON_OBJECT, 6);
  if (fault == NULL) return NULL;
  if (logged) sprout_json_adopt(fault, "level", word(arena, "error"));
  sprout_json_adopt(fault, "name", word(arena, name == NULL ? "Error" : name));
  sprout_json_adopt(fault, "detail", text_of(arena, detail));
  sprout_json_adopt(fault, "object", about->has_object ? text_of(arena, about->object) : nothing(arena));
  sprout_json_adopt(fault, "engine", truth(arena, about->engine));
  sprout_json_adopt(fault, "extension", about->extension == NULL ? nothing(arena) : word(arena, about->extension));
  return whole(fault, logged ? 6 : 5) ? fault : NULL;
}

/* ---- the entry ---- */

/* The host's budgets as the log keeps them; false where a row the log keeps as a figure is left unset. */
static bool budgets_of(sprout_arena *arena, const sprout_budgets *b, sprout_json **out) {
  /* The rows the spec's table gives a figure for; the others a host may leave unbounded, and the log keeps as null. */
  const struct {
    const char *name;
    const sprout_limit *limit;
    bool may_be_unset;
  } rows[] = {
      {"steps", &b->steps, false},
      {"pollSteps", &b->poll_steps, false},
      {"output", &b->output, false},
      {"events", &b->events, false},
      {"cascadeDepth", &b->cascade_depth, false},
      {"passageDepth", &b->passage_depth, false},
      {"setRoleObjects", &b->set_role_objects, false},
      {"spawnsPerTurn", &b->spawns, false},
      {"shortestWakeSeconds", &b->shortest_wake_seconds, false},
      {"pendingWakesPerObject", &b->pending_wakes, false},
      {"peoplePerPlace", &b->people_per_place, true},
      {"extensionEffects", &b->extension_effects, true},
      {"nicknameCharacters", &b->nickname_characters, false},
      {"wallClockMs", &b->wall_clock_ms, true},
  };
  const size_t count = sizeof rows / sizeof rows[0];
  sprout_json *budgets = sprout_json_make(arena, SPROUT_JSON_OBJECT, count);
  size_t i;
  *out = NULL;
  if (budgets == NULL) return true;
  for (i = 0; i < count; i++) {
    if (!rows[i].limit->set && !rows[i].may_be_unset) return false;
    sprout_json_adopt(budgets, rows[i].name,
                      rows[i].limit->set ? number(arena, (double)rows[i].limit->value) : nothing(arena));
  }
  if (whole(budgets, count)) *out = budgets;
  return true;
}

static sprout_json *cuts_of(sprout_arena *arena, const sprout_outcome *outcome, bool kept) {
  size_t count = kept ? outcome->cut_count : 0, i;
  sprout_json *list = sprout_json_make(arena, SPROUT_JSON_ARRAY, count);
  if (list == NULL) return NULL;
  for (i = 0; i < count; i++) {
    sprout_json *cut = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
    if (cut == NULL) return NULL;
    sprout_json_adopt(cut, "level", word(arena, "warning"));
    sprout_json_adopt(cut, "to", text_of(arena, outcome->cuts[i].id));
    if (!whole(cut, 2)) return NULL;
    sprout_json_adopt(list, NULL, cut);
  }
  return whole(list, count) ? list : NULL;
}

/* How many effects there were and the SHA-256 of them as debug depth logs them, read in canonical order. */
static sprout_json *digest_of(sprout_arena *arena, const sprout_json *effects) {
  static const char hex[] = "0123456789abcdef";
  sprout_json *digest = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2), *canonical = sprout_logged_canonical(arena, effects);
  const char *bytes;
  size_t length, i;
  unsigned char sum[32];
  char *text;
  if (digest == NULL || canonical == NULL || sprout_json_write(arena, canonical, &bytes, &length) != SPROUT_OK) return NULL;
  sprout_sha256(bytes, length, sum);
  text = (char *)sprout_arena_take(arena, 65);
  if (text == NULL) return NULL;
  for (i = 0; i < 32; i++) {
    text[2 * i] = hex[sum[i] >> 4];
    text[2 * i + 1] = hex[sum[i] & 15];
  }
  sprout_json_adopt(digest, "count", number(arena, (double)effects->count));
  sprout_json_adopt(digest, "sha256", sprout_json_text(arena, text, 64));
  return whole(digest, 2) ? digest : NULL;
}

static sprout_json *wakes_of(sprout_arena *arena, size_t count, const sprout_logged_wake *wakes, bool faulted) {
  sprout_json *list = sprout_json_make(arena, SPROUT_JSON_ARRAY, count);
  size_t i;
  if (list == NULL) return NULL;
  for (i = 0; i < count; i++) {
    sprout_json *one = sprout_json_make(arena, SPROUT_JSON_OBJECT, 3);
    if (one == NULL) return NULL;
    sprout_json_adopt(one, "object", text_of(arena, wakes[i].object));
    sprout_json_adopt(one, "serial", number(arena, (double)wakes[i].serial));
    if (faulted)
      sprout_json_adopt(one, "fault",
                        sprout_logged_fault(arena, wakes[i].fault_name, wakes[i].fault_detail, &wakes[i].fault_about, true));
    if (!whole(one, faulted ? 3 : 2)) return NULL;
    sprout_json_adopt(list, NULL, one);
  }
  return whole(list, count) ? list : NULL;
}

/* A planned step as the log keeps it: its verb by library and name, who performs it, and what fills each role it binds. */
static sprout_json *planned_of(sprout_arena *arena, const sprout_reading *reading) {
  sprout_json *planned = sprout_json_make(arena, SPROUT_JSON_OBJECT, 3), *verb = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
  sprout_json *bindings = sprout_json_make(arena, SPROUT_JSON_ARRAY, reading->filling_count);
  const char *dot = strrchr(reading->verb, '.');
  size_t i, j, bound = 0;
  if (planned == NULL || verb == NULL || bindings == NULL || dot == NULL) return NULL;
  sprout_json_adopt(verb, "library", sprout_json_text(arena, reading->verb, (size_t)(dot - reading->verb)));
  sprout_json_adopt(verb, "name", word(arena, dot + 1));
  for (i = 0; i < reading->filling_count; i++) {
    const sprout_filling *one = &reading->fillings[i];
    sprout_json *pair = sprout_json_make(arena, SPROUT_JSON_ARRAY, 2), *what = sprout_json_make(arena, SPROUT_JSON_OBJECT, 1);
    sprout_json *exit, *ids;
    if (one->binds == SPROUT_FILL_UNBOUND) continue;
    if (pair == NULL || what == NULL) return NULL;
    switch (one->binds) {
      case SPROUT_FILL_OBJECT:
        sprout_json_adopt(what, "object", word(arena, one->id));
        break;
      case SPROUT_FILL_SET:
        ids = sprout_json_make(arena, SPROUT_JSON_ARRAY, one->id_count);
        for (j = 0; ids != NULL && j < one->id_count; j++) sprout_json_adopt(ids, NULL, word(arena, one->ids[j]));
        if (ids == NULL || ids->count != one->id_count) return NULL;
        sprout_json_adopt(what, "set", ids);
        break;
      case SPROUT_FILL_EXIT:
        exit = sprout_json_make(arena, SPROUT_JSON_OBJECT, 3);
        if (exit == NULL) return NULL;
        sprout_json_adopt(exit, "direction", one->direction == NULL ? nothing(arena) : word(arena, one->direction));
        sprout_json_adopt(exit, "label", word(arena, one->label));
        sprout_json_adopt(exit, "to", word(arena, one->id));
        if (!whole(exit, 3)) return NULL;
        sprout_json_adopt(what, "exit", exit);
        break;
      case SPROUT_FILL_TEXT:
        sprout_json_adopt(what, "value", word(arena, one->text));
        break;
      case SPROUT_FILL_NUMBER:
        sprout_json_adopt(what, "value", number(arena, one->number));
        break;
      case SPROUT_FILL_UNBOUND:
        break;
    }
    sprout_json_adopt(pair, NULL, word(arena, one->role));
    sprout_json_adopt(pair, NULL, what);
    if (!whole(pair, 2) || !whole(what, 1)) return NULL;
    sprout_json_adopt(bindings, NULL, pair);
    bound++;
  }
  sprout_json_adopt(planned, "verb", verb);
  sprout_json_adopt(planned, "actor", word(arena, reading->actor));
  sprout_json_adopt(planned, "bindings", bindings);
  return whole(verb, 2) && whole(bindings, bound) && whole(planned, 3) ? planned : NULL;
}

/* An item of a run read afresh, as the log keeps it: its role and words, each value role's words, and what the pronouns named. */
static sprout_json *reread_of(sprout_arena *arena, const sprout_reread *reread) {
  sprout_json *kept = sprout_json_make(arena, SPROUT_JSON_OBJECT, 4);
  sprout_json *values = sprout_json_make(arena, SPROUT_JSON_ARRAY, reread->value_count);
  sprout_json *referents = sprout_json_make(arena, SPROUT_JSON_ARRAY, reread->referent_count);
  size_t i;
  if (kept == NULL || values == NULL || referents == NULL) return NULL;
  for (i = 0; i < reread->value_count; i++) {
    sprout_json *one = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
    if (one == NULL) return NULL;
    sprout_json_adopt(one, "role", word(arena, reread->values[i].role));
    sprout_json_adopt(one, "words", word(arena, reread->values[i].words));
    if (!whole(one, 2)) return NULL;
    sprout_json_adopt(values, NULL, one);
  }
  for (i = 0; i < reread->referent_count; i++) sprout_json_adopt(referents, NULL, word(arena, reread->referents[i]));
  sprout_json_adopt(kept, "role", word(arena, reread->role));
  sprout_json_adopt(kept, "words", word(arena, reread->words));
  sprout_json_adopt(kept, "values", values);
  sprout_json_adopt(kept, "referents", referents);
  return whole(values, reread->value_count) && whole(referents, reread->referent_count) && whole(kept, 4) ? kept : NULL;
}

/* The draw a command's reading was, as a warning; null where it stood alone. */
static sprout_json *drawn_of(sprout_arena *arena, uint64_t among) {
  sprout_json *drawn;
  if (among == 0) return nothing(arena);
  drawn = sprout_json_make(arena, SPROUT_JSON_OBJECT, 2);
  if (drawn == NULL) return NULL;
  sprout_json_adopt(drawn, "level", word(arena, "warning"));
  sprout_json_adopt(drawn, "among", number(arena, (double)among));
  return whole(drawn, 2) ? drawn : NULL;
}

/* What the entry keeps beside its inputs, for each kind of turn; the number of members it added. */
static size_t parts_of(sprout_arena *arena, const sprout_outcome *outcome, sprout_json *entry, sprout_json **effects_kept) {
  const sprout_log_entry *log = &outcome->log;
  bool faulted = log->faulted, refused = outcome->result == SPROUT_RESULT_REFUSED;
  /*
   * A faulted tick, wake or arrival says nothing in the world; a faulted departure keeps what its quiet going said,
   * and a faulted command the world's `fault` told to the one who typed.
   */
  bool says = !faulted || log->kind == SPROUT_TURN_DEPARTURE || log->kind == SPROUT_TURN_COMMAND;
  bool cuts = says && !refused && !(faulted && log->kind == SPROUT_TURN_COMMAND);
  sprout_json *fault = faulted ? sprout_logged_fault(arena, log->fault_name, log->fault_detail, &log->fault_about, true)
                               : nothing(arena);
  size_t added = 0;
  *effects_kept = NULL;
  switch (log->kind) {
    case SPROUT_TURN_MAINTENANCE:
      sprout_json_adopt(entry, "delivered", wakes_of(arena, log->delivered_count, log->delivered, false));
      sprout_json_adopt(entry, "faulted", wakes_of(arena, log->faulted_count, log->faulted_wakes, true));
      sprout_json_adopt(entry, "abandoned", wakes_of(arena, log->abandoned_count, log->abandoned, false));
      return 3;
    case SPROUT_TURN_TICK:
      sprout_json_adopt(entry, "place", text_of(arena, log->who));
      added = 1;
      break;
    case SPROUT_TURN_WAKE:
      sprout_json_adopt(entry, "object", text_of(arena, log->who));
      sprout_json_adopt(entry, "serial", number(arena, (double)log->wake_serial));
      added = 2;
      break;
    case SPROUT_TURN_ARRIVAL:
      sprout_json_adopt(entry, "visit", text_of(arena, log->who));
      sprout_json_adopt(entry, "nickname", text_of(arena, log->nickname));
      sprout_json_adopt(entry, "outcome", word(arena, faulted ? "faulted" : refused ? "refused" : "admitted"));
      added = 3;
      break;
    case SPROUT_TURN_DEPARTURE:
      sprout_json_adopt(entry, "visit", text_of(arena, log->who));
      added = 1;
      break;
    case SPROUT_TURN_COMMAND:
      sprout_json_adopt(entry, "visit", text_of(arena, log->who));
      sprout_json_adopt(entry, "text", text_of(arena, log->text));
      sprout_json_adopt(entry, "planned", log->planned == NULL ? nothing(arena) : planned_of(arena, log->planned));
      sprout_json_adopt(entry, "reread", log->reread == NULL ? nothing(arena) : reread_of(arena, log->reread));
      sprout_json_adopt(entry, "drawn", drawn_of(arena, log->drawn_among));
      added = 5;
      break;
    case SPROUT_TURN_POLL:
      return 0;
  }
  sprout_json_adopt(entry, "fault", fault);
  *effects_kept = says ? sprout_logged_effects(arena, outcome, true) : sprout_json_make(arena, SPROUT_JSON_ARRAY, 0);
  sprout_json_adopt(entry, "effects", *effects_kept);
  /* A refused arrival kept nobody from reading on: only an admission's lines can cut anyone short. */
  sprout_json_adopt(entry, "cutShort", cuts_of(arena, outcome, cuts));
  return added + 3;
}

sprout_status sprout_logged_entry(sprout_arena *arena, const sprout_host *host, const sprout_outcome *outcome,
                                  sprout_log_depth depth, sprout_json **out) {
  const sprout_log_entry *log = &outcome->log;
  const sprout_limit may_hold = host->budgets.instances;
  sprout_json *entry, *budgets, *effects;
  size_t members;
  *out = NULL;
  if (!outcome->has_log || log->kind == SPROUT_TURN_POLL) return SPROUT_BAD_INPUT;
  if (!budgets_of(arena, &host->budgets, &budgets)) return SPROUT_BAD_HOST;
  entry = sprout_json_make(arena, SPROUT_JSON_OBJECT, 16);
  if (entry == NULL || budgets == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(entry, "kind", word(arena, log->kind == SPROUT_TURN_COMMAND       ? "command"
                                               : log->kind == SPROUT_TURN_TICK        ? "tick"
                                               : log->kind == SPROUT_TURN_WAKE        ? "wake"
                                               : log->kind == SPROUT_TURN_MAINTENANCE ? "maintenance"
                                               : log->kind == SPROUT_TURN_ARRIVAL     ? "arrival"
                                                                                      : "departure"));
  sprout_json_adopt(entry, "level", word(arena, "info"));
  sprout_json_adopt(entry, "seed", number(arena, (double)log->seed));
  sprout_json_adopt(entry, "mayHold", may_hold.set ? number(arena, (double)may_hold.value) : nothing(arena));
  sprout_json_adopt(entry, "now", number(arena, (double)log->seconds));
  sprout_json_adopt(entry, "budgets", budgets);
  members = 6 + parts_of(arena, outcome, entry, &effects);
  if (effects != NULL && depth == SPROUT_LOG_PLAY) {
    /* At play depth the effects give way to how many there were and their digest; replaying the turn gives them back. */
    sprout_json *digest = digest_of(arena, effects), *none = sprout_json_make(arena, SPROUT_JSON_ARRAY, 0);
    size_t i;
    if (digest == NULL || none == NULL) return SPROUT_NO_MEMORY;
    for (i = 0; i < entry->count; i++)
      if (entry->items[i] == effects) {
        none->parent = entry;
        none->index = i;
        none->key = effects->key;
        none->key_length = effects->key_length;
        entry->items[i] = none;
      }
    sprout_json_adopt(entry, "digest", digest);
    members++;
  }
  if (!whole(entry, members)) return SPROUT_NO_MEMORY;
  *out = entry;
  return SPROUT_OK;
}

/* ---- as text ---- */

sprout_status sprout_log_write(const sprout_host *host, const sprout_outcome *outcome, sprout_log_depth depth,
                               sprout_arena *scratch, const char **bytes, size_t *length) {
  sprout_json *entry;
  sprout_status status = sprout_logged_entry(scratch, host, outcome, depth, &entry);
  if (status != SPROUT_OK) return status;
  return sprout_json_write(scratch, entry, bytes, length);
}

sprout_status sprout_effects_write(const sprout_outcome *outcome, sprout_arena *scratch, const char **bytes,
                                   size_t *length) {
  sprout_json *effects = sprout_logged_effects(scratch, outcome, false);
  if (effects == NULL) return SPROUT_NO_MEMORY;
  return sprout_json_write(scratch, effects, bytes, length);
}
