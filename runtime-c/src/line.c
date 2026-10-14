/*
 * A line a visitor typed, as the command turns it runs (the spec's Parsing > Sequences, again and all; Intents); see
 * line.h. Each command of the line is a turn, and the turns
 * it planned follow it in order before the line's next command, a command `and` or a comma joined being run with the
 * turns it plans in turn. Whether the line goes on is asked of the turn that ran last in the command whose planned
 * turns are being run, never of a joined command's own, which only ends the line by ending itself.
 */
#include "line.h"

#include <string.h>

#include "prose/prose.h"

/* ---- the commands of a line ---- */

static bool is_word_byte(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
}

/* Whether `then`, in any case, stands as a word at `at` of `bytes`. */
static bool then_at(const char *bytes, size_t length, size_t at) {
  static const char then[] = "then";
  size_t i;
  if (at + 4 > length || (at > 0 && is_word_byte(bytes[at - 1])) || (at + 4 < length && is_word_byte(bytes[at + 4])))
    return false;
  for (i = 0; i < 4; i++) {
    char c = bytes[at + i];
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    if (c != then[i]) return false;
  }
  return true;
}

/* `piece` trimmed of white space and kept where anything is left. */
static bool kept_part(sprout_arena *arena, const char *bytes, size_t length, sprout_str *parts, size_t *count) {
  size_t start = 0, end = length, width;
  while (start < end && prose_is_space(prose_decode(bytes, end, start, &width))) start += width;
  while (end > start) {
    size_t back = end - 1;
    while (back > start && ((unsigned char)bytes[back] & 0xC0) == 0x80) back--;
    if (!prose_is_space(prose_decode(bytes, end, back, &width))) break;
    end = back;
  }
  if (end == start) return true;
  parts[*count].bytes = sprout_arena_copy(arena, bytes + start, end - start);
  parts[*count].length = end - start;
  if (parts[*count].bytes == NULL) return false;
  (*count)++;
  return true;
}

sprout_status sprout_line_parts(sprout_arena *arena, sprout_str text, sprout_str **parts, size_t *count) {
  /* A part ends at each `.` or `then`, so there are at most as many as the line has bytes, and one more. */
  sprout_str *found = (sprout_str *)sprout_arena_take(arena, (text.length + 1) * sizeof *found);
  size_t sentence = 0, at;
  *count = 0;
  *parts = found;
  if (found == NULL) return SPROUT_NO_MEMORY;
  for (at = 0; at <= text.length; at++) {
    size_t piece, i;
    if (at < text.length && text.bytes[at] != '.') continue;
    for (piece = sentence, i = sentence; i < at;) {
      if (!then_at(text.bytes + sentence, at - sentence, i - sentence)) {
        i++;
        continue;
      }
      if (!kept_part(arena, text.bytes + piece, i - piece, found, count)) return SPROUT_NO_MEMORY;
      i += 4;
      piece = i;
    }
    if (!kept_part(arena, text.bytes + piece, at - piece, found, count)) return SPROUT_NO_MEMORY;
    sentence = at + 1;
  }
  if (*count == 0) {
    found[0].bytes = sprout_arena_copy(arena, text.bytes, text.length);
    found[0].length = text.length;
    if (found[0].bytes == NULL) return SPROUT_NO_MEMORY;
    *count = 1;
  }
  return SPROUT_OK;
}

/* ---- copies ---- */

static const char *copied(sprout_arena *arena, const char *text, bool *ok) {
  const char *copy;
  if (text == NULL) return NULL;
  copy = sprout_arena_copy(arena, text, strlen(text));
  if (copy == NULL) *ok = false;
  return copy;
}

sprout_reading *sprout_reading_copy(sprout_arena *arena, const sprout_reading *from) {
  sprout_reading *to = (sprout_reading *)sprout_arena_take(arena, sizeof *to);
  sprout_filling *fillings = (sprout_filling *)sprout_arena_take(arena, (from->filling_count + 1) * sizeof *fillings);
  bool ok = to != NULL && fillings != NULL;
  size_t i, j;
  if (!ok) return NULL;
  to->verb = copied(arena, from->verb, &ok);
  to->actor = copied(arena, from->actor, &ok);
  to->filling_count = from->filling_count;
  to->fillings = fillings;
  for (i = 0; ok && i < from->filling_count; i++) {
    const sprout_filling *one = &from->fillings[i];
    const char **ids = (const char **)sprout_arena_take(arena, (one->id_count + 1) * sizeof *ids);
    fillings[i] = *one;
    fillings[i].role = copied(arena, one->role, &ok);
    fillings[i].id = copied(arena, one->id, &ok);
    fillings[i].direction = copied(arena, one->direction, &ok);
    fillings[i].label = copied(arena, one->label, &ok);
    fillings[i].text = copied(arena, one->text, &ok);
    if (ids == NULL) return NULL;
    for (j = 0; j < one->id_count; j++) ids[j] = copied(arena, one->ids[j], &ok);
    fillings[i].ids = ids;
  }
  return ok ? to : NULL;
}

sprout_reread *sprout_reread_copy(sprout_arena *arena, const sprout_reread *from) {
  sprout_reread *to = (sprout_reread *)sprout_arena_take(arena, sizeof *to);
  sprout_reread_value *values = (sprout_reread_value *)sprout_arena_take(arena, (from->value_count + 1) * sizeof *values);
  const char **referents = (const char **)sprout_arena_take(arena, (from->referent_count + 1) * sizeof *referents);
  bool ok = to != NULL && values != NULL && referents != NULL;
  size_t i;
  if (!ok) return NULL;
  to->role = copied(arena, from->role, &ok);
  to->words = copied(arena, from->words, &ok);
  for (i = 0; i < from->value_count; i++) {
    values[i].role = copied(arena, from->values[i].role, &ok);
    values[i].words = copied(arena, from->values[i].words, &ok);
  }
  for (i = 0; i < from->referent_count; i++) referents[i] = copied(arena, from->referents[i], &ok);
  to->value_count = from->value_count;
  to->values = values;
  to->referent_count = from->referent_count;
  to->referents = referents;
  return ok ? to : NULL;
}

/* ---- the turns a line runs ---- */

/* One command under way: its words, the turns its own turn planned, and whether the turn that ran last lets the line go on. */
typedef struct line_frame {
  sprout_str text;
  size_t next_count, next_at;
  const sprout_following *next;
  bool goes_on;
  bool first; /* its own turn is the one handed out */
} line_frame;

/* The turns `outcome` planned, copied into `keep`; NULL where the host refuses a page. */
static const sprout_following *next_of(sprout_arena *keep, const sprout_outcome *outcome) {
  sprout_following *next = (sprout_following *)sprout_arena_take(keep, (outcome->next_count + 1) * sizeof *next);
  bool ok = next != NULL;
  size_t i;
  for (i = 0; ok && i < outcome->next_count; i++) {
    const sprout_following *one = &outcome->next[i];
    if (one->text != NULL) {
      next[i].text = copied(keep, one->text, &ok);
      continue;
    }
    next[i].planned = sprout_reading_copy(keep, one->planned);
    next[i].reread = one->reread == NULL ? NULL : sprout_reread_copy(keep, one->reread);
    ok = next[i].planned != NULL && (one->reread == NULL || next[i].reread != NULL);
  }
  return ok ? next : NULL;
}

/* A command begun: its own turn handed out. */
static sprout_status push(sprout_commands *line, sprout_str text, sprout_turn_input *input) {
  line_frame *frames = (line_frame *)line->frames, *top;
  if (line->depth == line->room) {
    size_t room = line->room == 0 ? 4 : line->room * 2;
    line_frame *bigger = (line_frame *)sprout_arena_take(line->keep, room * sizeof *bigger);
    if (bigger == NULL) return SPROUT_NO_MEMORY;
    if (line->depth > 0) memcpy(bigger, frames, line->depth * sizeof *bigger);
    line->frames = frames = bigger;
    line->room = room;
  }
  top = &frames[line->depth++];
  memset(top, 0, sizeof *top);
  top->text = text;
  top->first = true;
  input->text = text.bytes;
  input->text_length = text.length;
  line->waiting = true;
  return SPROUT_OK;
}

sprout_status sprout_line_begin(sprout_commands *line, sprout_arena *keep, const char *visit, const char *text,
                                size_t length) {
  sprout_str whole, *parts;
  sprout_status status;
  if (line == NULL || keep == NULL || visit == NULL || text == NULL) return SPROUT_BAD_HOST;
  memset(line, 0, sizeof *line);
  line->keep = keep;
  line->visit = sprout_arena_copy(keep, visit, strlen(visit));
  if (line->visit == NULL) return SPROUT_NO_MEMORY;
  whole.bytes = text;
  whole.length = length;
  status = sprout_line_parts(keep, whole, &parts, &line->part_count);
  line->parts = parts;
  return status;
}

sprout_status sprout_line_next(sprout_commands *line, const sprout_outcome *last, sprout_turn_input *input, bool *more) {
  line_frame *top;
  if (line == NULL || input == NULL || more == NULL) return SPROUT_BAD_HOST;
  memset(input, 0, sizeof *input);
  input->kind = SPROUT_TURN_COMMAND;
  input->visit = line->visit;
  *more = true;
  if (line->waiting) {
    if (last == NULL) return SPROUT_BAD_INPUT;
    top = &((line_frame *)line->frames)[line->depth - 1];
    if (top->first && last->next_count > 0) {
      top->next = next_of(line->keep, last);
      if (top->next == NULL) return SPROUT_NO_MEMORY;
      top->next_count = last->next_count;
    }
    top->first = false;
    top->goes_on = last->goes_on;
    line->waiting = false;
  }
  for (;;) {
    const sprout_following *step;
    if (line->depth == 0) {
      if (line->part_at == line->part_count) break;
      return push(line, line->parts[line->part_at++], input);
    }
    top = &((line_frame *)line->frames)[line->depth - 1];
    if (top->next_at == top->next_count) {
      line->depth--;
      if (top->goes_on) continue;
      break;
    }
    if (!top->goes_on) break;
    step = &top->next[top->next_at++];
    if (step->text != NULL) {
      sprout_str text;
      text.bytes = step->text;
      text.length = strlen(step->text);
      return push(line, text, input);
    }
    input->text = top->text.bytes;
    input->text_length = top->text.length;
    input->planned = step->planned;
    input->reread = step->reread;
    line->waiting = true;
    return SPROUT_OK;
  }
  /* The line is over: a turn that did not let it go on ended it, or every command ran. */
  line->depth = 0;
  line->part_at = line->part_count;
  *more = false;
  return SPROUT_OK;
}
