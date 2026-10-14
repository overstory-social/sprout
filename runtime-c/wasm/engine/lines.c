/*
 * The lines visitors typed, as the command turns each runs (the spec's Parsing > Sequences, again and all;
 * Intents). Several may be under way at once, one per visitor typing, their turns interleaved as a host's lock
 * runs them, so each line is numbered: sw_line begins one and answers its first command, which carries the line's
 * number and its own; the host runs that command through sw_command with a seed of its own, once, which hands the
 * line what it came to; and sw_line_next answers the one after it, or null once the line is over, when its number
 * is let go. A line the host stops running is let go with sw_line_end.
 */
#include <string.h>

#include "engine.h"
#include "reading_json.h"

wasm_line *lines_find(wasm_engine *e, double number) {
  size_t at = (size_t)number;
  if (number < 0 || (double)at != number || at >= e->line_count || !e->lines[at].used) return NULL;
  return &e->lines[at];
}

wasm_line *lines_waiting_on(wasm_engine *e, const sprout_json *line, const sprout_json *step) {
  wasm_line *found = line != NULL && line->kind == SPROUT_JSON_NUMBER ? lines_find(e, line->number) : NULL;
  if (found == NULL || !found->waiting || step == NULL || step->kind != SPROUT_JSON_NUMBER) return NULL;
  return step->number == (double)found->handed ? found : NULL;
}

void lines_ran(wasm_line *line, const sprout_outcome *outcome, bool ran) {
  line->waiting = false;
  if (!ran || sprout_line_next(&line->commands, outcome, &line->pending, &line->more) != SPROUT_OK) line->more = false;
}

/* A slot for a new line, its arena empty; NULL when memory runs out. */
static wasm_line *slot(wasm_engine *e) {
  wasm_line *grown;
  size_t at, count;
  for (at = 0; at < e->line_count; at++)
    if (!e->lines[at].used) break;
  if (at == e->line_count) {
    count = e->line_count == 0 ? 4 : e->line_count * 2;
    grown = (wasm_line *)pool_alloc(NULL, count * sizeof *grown);
    if (grown == NULL) return NULL;
    memset(grown, 0, count * sizeof *grown);
    if (e->line_count > 0) memcpy(grown, e->lines, e->line_count * sizeof *grown);
    /* Each line's arena is moved with it, its pages still its own, and its commands follow it there. */
    for (at = 0; at < e->line_count; at++) grown[at].commands.keep = &grown[at].keep;
    pool_release(NULL, e->lines, e->line_count * sizeof *grown);
    at = e->line_count;
    e->lines = grown;
    e->line_count = count;
  }
  if (e->lines[at].keep.host == NULL && sprout_arena_init(&e->lines[at].keep, &e->host) != SPROUT_OK) return NULL;
  e->lines[at].used = true;
  e->lines[at].more = e->lines[at].waiting = false;
  e->lines[at].handed = 0;
  return &e->lines[at];
}

static void let_go(wasm_line *line) {
  sprout_arena_reset(&line->keep);
  line->used = line->more = line->waiting = false;
}

/*
 * The command `line` hands out next as JSON, `{"visit", "text", "planned", "reread", "line", "step"}`, its line's number
 * and its own among the commands the line handed out; null, and the line let go, once it is over.
 */
static int answer_next(wasm_engine *e, wasm_line *line) {
  sprout_json *root;
  if (!line->more) {
    let_go(line);
    return engine_answer_json(e, engine_null(e));
  }
  root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 6);
  if (root == NULL) return SPROUT_NO_MEMORY;
  sprout_json_adopt(root, "visit", engine_text(e, line->pending.visit, strlen(line->pending.visit)));
  sprout_json_adopt(root, "text", engine_text(e, line->pending.text, line->pending.text_length));
  sprout_json_adopt(root, "planned", line->pending.planned == NULL ? engine_null(e)
                                                                   : sprout_reading_tree(&e->scratch, "verb", line->pending.planned));
  sprout_json_adopt(root, "reread", line->pending.reread == NULL ? engine_null(e)
                                                                 : sprout_reread_tree(&e->scratch, line->pending.reread));
  sprout_json_adopt(root, "line", engine_number(e, (double)(line - e->lines)));
  sprout_json_adopt(root, "step", engine_number(e, (double)++line->handed));
  if (root->count != 6) return SPROUT_NO_MEMORY;
  line->waiting = true;
  return engine_answer_json(e, root);
}

/* Begins a line a visitor typed, the input holding `{"visit", "text"}`, and answers the first command it runs. */
EXPORT("sw_line") int sw_line(size_t length) {
  wasm_engine *e = &the_engine;
  sprout_json *root;
  const char *visit, *words;
  wasm_line *line;
  int status;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  status = engine_input_json(e, length, "The line is not JSON.", &root);
  if (status != SPROUT_OK) return status;
  visit = engine_string_at(root, "visit");
  words = engine_string_at(root, "text");
  if (visit == NULL || words == NULL) return engine_refuse(e, "A line names its visit and the words typed.");
  line = slot(e);
  if (line == NULL) return SPROUT_NO_MEMORY;
  status = sprout_line_begin(&line->commands, &line->keep, visit, words, strlen(words));
  if (status == SPROUT_OK) status = sprout_line_next(&line->commands, NULL, &line->pending, &line->more);
  if (status != SPROUT_OK) {
    let_go(line);
    return status;
  }
  return answer_next(e, line);
}

/* The command the line numbered `number` runs next, once the one it handed out before ran; null once it is over. */
EXPORT("sw_line_next") int sw_line_next(double number) {
  wasm_engine *e = &the_engine;
  wasm_line *line;
  engine_begin(e, 0);
  line = lines_find(e, number);
  if (line == NULL) return engine_refuse(e, "There is no line under way by that number.");
  if (line->waiting) return engine_refuse(e, "Run the command the line handed out before asking for the next.");
  return answer_next(e, line);
}

/* Lets go of the line numbered `number`, which the host runs no more of; one already over is nothing to let go. */
EXPORT("sw_line_end") void sw_line_end(double number) {
  wasm_line *line = lines_find(&the_engine, number);
  if (line != NULL) let_go(line);
}
