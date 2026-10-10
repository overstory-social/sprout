/*
 * Where the words a reader read were written (the spec's The runtime > Effects): a named passage by the
 * kind that wrote it and its name, or a one-line passage, a string given to `say`, `tell`, `text` or
 * `refuse`, by where it stands. Each is noted once for one reader's reading of one line, after any passage
 * it holds, so a passage that gave words through another is listed after it. This is for an author's tools,
 * which ask what a playthrough read; a client is never sent it.
 */
#include <string.h>

#include "prose.h"

/* `file:line:column` of a place, or `?` where the cartridge kept none. */
static const char *location_of(const prose_reading *reading, const sprout_node *at) {
  const sprout_graph *graph = &reading->world->graph;
  char digits[24];
  size_t used = 0, n, count;
  const char *file;
  char *text;
  long numbers[2];
  size_t i;
  if (at == NULL || at->kind != SPROUT_NODE_PLACE || at->file < 0 || (size_t)at->file >= graph->file_count) return "?";
  file = graph->files[at->file];
  numbers[0] = at->line;
  numbers[1] = at->column;
  n = strlen(file);
  text = (char *)sprout_arena_take(reading->notes->arena, n + 2 * 21 + 1);
  if (text == NULL) return NULL;
  memcpy(text, file, n);
  used = n;
  for (i = 0; i < 2; i++) {
    unsigned long number = (unsigned long)numbers[i];
    text[used++] = ':';
    count = sizeof digits;
    do {
      digits[--count] = (char)('0' + (int)(number % 10));
      number /= 10;
    } while (number > 0);
    memcpy(text + used, digits + count, sizeof digits - count);
    used += sizeof digits - count;
  }
  text[used] = '\0';
  return text;
}

static bool known(const prose_notes *notes, const sprout_noted *wanted) {
  size_t i;
  for (i = 0; i < notes->count; i++) {
    const sprout_noted *have = &notes->items[i];
    if (have->passage != wanted->passage) continue;
    if (wanted->passage ? strcmp(have->origin, wanted->origin) == 0 && strcmp(have->name, wanted->name) == 0
                        : strcmp(have->at, wanted->at) == 0)
      return true;
  }
  return false;
}

static void note(const prose_reading *reading, const sprout_noted *wanted) {
  prose_notes *notes = reading->notes;
  sprout_noted *slot;
  if (notes == NULL || wanted->at == NULL || known(notes, wanted)) return;
  slot = (sprout_noted *)sprout_exec_grow(notes->arena, (void **)&notes->items, &notes->count, &notes->capacity,
                                          sizeof *slot);
  if (slot != NULL) *slot = *wanted;
}

void prose_note_passage(const prose_reading *reading, const sprout_node *passage) {
  sprout_noted wanted;
  if (reading->notes == NULL) return;
  wanted.passage = true;
  wanted.name = sprout_node_text(passage, "name");
  wanted.origin = sprout_node_text(passage, "origin");
  wanted.at = location_of(reading, sprout_node_get(passage, "at"));
  if (wanted.name == NULL || wanted.origin == NULL) return;
  note(reading, &wanted);
}

void prose_note_line(const prose_reading *reading, const sprout_node *prose) {
  sprout_noted wanted;
  if (reading->notes == NULL) return;
  memset(&wanted, 0, sizeof wanted);
  wanted.at = location_of(reading, sprout_node_get(prose, "at"));
  note(reading, &wanted);
}

void prose_note_engine(const prose_reading *reading) {
  sprout_noted wanted;
  if (reading->notes == NULL) return;
  memset(&wanted, 0, sizeof wanted);
  wanted.at = "the engine:1:1";
  note(reading, &wanted);
}
