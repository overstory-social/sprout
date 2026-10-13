/* The lines a call's turns told; see told.h. */
#include "told.h"

#include <string.h>

const char *line_kind_name(sprout_line_kind kind) {
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

const char *turn_kind_name(sprout_turn_kind kind) {
  switch (kind) {
    case SPROUT_TURN_COMMAND:
      return "command";
    case SPROUT_TURN_TICK:
      return "tick";
    case SPROUT_TURN_WAKE:
      return "wake";
    case SPROUT_TURN_MAINTENANCE:
      return "maintenance";
    case SPROUT_TURN_POLL:
      return "poll";
    case SPROUT_TURN_ARRIVAL:
      return "arrival";
    case SPROUT_TURN_DEPARTURE:
      return "departure";
  }
  return "";
}

const char *result_name(sprout_turn_result result) {
  switch (result) {
    case SPROUT_RESULT_DONE:
      return "done";
    case SPROUT_RESULT_FAULTED:
      return "faulted";
    case SPROUT_RESULT_REFUSED:
      return "refused";
    case SPROUT_RESULT_CLOSED:
      return "closed";
    case SPROUT_RESULT_IDLE:
      return "idle";
  }
  return "";
}

static told *told_next(sprout_arena *arena, told_list *list) {
  if (list->count == list->capacity) {
    size_t wanted = list->capacity == 0 ? 8 : list->capacity * 2;
    told *bigger = (told *)sprout_arena_take(arena, wanted * sizeof *bigger);
    if (bigger == NULL) return NULL;
    if (list->count > 0) memcpy(bigger, list->items, list->count * sizeof *bigger);
    list->items = bigger;
    list->capacity = wanted;
  }
  return &list->items[list->count++];
}

static bool told_put(sprout_arena *arena, told_list *list, const char *reader, size_t reader_length, const char *kind,
                     const char *text, size_t text_length) {
  told *line = told_next(arena, list);
  if (line == NULL) return false;
  line->reader = sprout_arena_copy(arena, reader, reader_length);
  line->reader_length = reader_length;
  line->kind = kind;
  line->text = sprout_arena_copy(arena, text, text_length);
  line->text_length = text_length;
  if (line->reader != NULL && line->text != NULL) return true;
  /* A line whose words could not be kept is not kept at all. */
  list->count--;
  return false;
}

bool told_add(sprout_arena *arena, told_list *list, const char *reader, const char *kind, const char *text) {
  return told_put(arena, list, reader, strlen(reader), kind, text, strlen(text));
}

/* Copies what recorded an extension's effect onto the line that tells it; a copy refused leaves the line plain words. */
static bool told_extension(sprout_arena *arena, told *line, const sprout_told_effect *effect) {
  if (effect == NULL || effect->extension == NULL) return true;
  line->extension = sprout_arena_copy(arena, effect->extension, strlen(effect->extension));
  line->statement = sprout_arena_copy(arena, effect->statement, strlen(effect->statement));
  if (effect->payload.length > 0) {
    line->payload = sprout_arena_copy(arena, effect->payload.bytes, effect->payload.length);
    line->payload_length = effect->payload.length;
  }
  if (line->extension != NULL && line->statement != NULL && (effect->payload.length == 0 || line->payload != NULL))
    return true;
  line->extension = line->statement = line->payload = NULL;
  line->payload_length = 0;
  return false;
}

bool told_collect(sprout_arena *arena, told_list *list, const sprout_outcome *outcome, const char *visit) {
  size_t i;
  for (i = 0; i < outcome->line_count; i++) {
    const sprout_line *line = &outcome->lines[i];
    if (!told_put(arena, list, line->recipient, line->recipient_length, line_kind_name(line->kind), line->text,
                  line->text_length))
      return false;
    if (!told_extension(arena, &list->items[list->count - 1],
                        line->effect < outcome->effect_count ? &outcome->effects[line->effect] : NULL))
      return false;
  }
  /* An error shown in play names the fault beside the world's `fault` passage, and never its detail. */
  if (outcome->faulted && outcome->fault_name != NULL) return told_add(arena, list, visit, "record", outcome->fault_name);
  return true;
}
