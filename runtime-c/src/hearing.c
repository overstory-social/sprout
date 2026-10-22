/*
 * Who reads what a body says (the spec's Verbs > Acting; Other people > Who
 * hears it). A person's reading is answered to the person; an NPC's is
 * heard from it by whoever would hear its `tell`, found where the NPC stands
 * when the line is said, since a `move` earlier in the same `do` may have
 * carried it somewhere else. What a body does that nobody reads, a refused
 * `move` or a `send` that reached nothing, is kept as a warning for the log
 * (the spec's The runtime > The log), its words as written and never
 * rendered, since rendering draws and costs.
 */
#include <string.h>

#include "exec.h"

sprout_eval_status sprout_exec_hearers(const sprout_exec *x, const sprout_frame *frame, const sprout_str **to,
                                       size_t *count) {
  if (!x->hears_live) {
    *to = x->heard_by;
    *count = x->heard_count;
    return SPROUT_EVAL_OK;
  }
  return sprout_told_to(x, frame, x->speaker, SPROUT_TELL_PLACE, to, count);
}

sprout_eval_status sprout_record_refusal(sprout_exec *x, const sprout_frame *frame, const sprout_move_refusal *refusal,
                                         size_t *readers) {
  sprout_effect effect;
  sprout_eval_status status;
  memset(&effect, 0, sizeof effect);
  effect.kind = SPROUT_EFFECT_REFUSED;
  status = sprout_exec_hearers(x, frame, &effect.to, &effect.to_count);
  if (status != SPROUT_EVAL_OK) return status;
  if (readers != NULL) *readers = effect.to_count;
  effect.by = refusal->by;
  effect.has_speaker = x->has_speaker;
  effect.speaker = x->speaker;
  effect.said = refusal->said;
  effect.bindings = refusal->bindings;
  effect.binding_count = refusal->binding_count;
  return sprout_exec_record(x, &effect);
}

/* A refusal's words as written, for the log: the line in quotes, or the passage it names, never rendered. */
static const char *words_written(const sprout_frame *frame, const sprout_speech *said) {
  const sprout_node *value;
  const char *text, *name;
  size_t length;
  char *words;
  switch (said->kind) {
    case SPROUT_SPEECH_TEXT:
      value = sprout_node_get(frame->graph, said->node, "value");
      text = sprout_text(frame->graph, value);
      length = sprout_text_length(frame->graph, value);
      words = (char *)sprout_arena_take(frame->turn, length + 3);
      if (words == NULL) return NULL;
      words[0] = '"';
      memcpy(words + 1, text == NULL ? "" : text, length);
      words[length + 1] = '"';
      words[length + 2] = '\0';
      return words;
    case SPROUT_SPEECH_RECORDED:
      return sprout_arena_copy(frame->turn, said->transcript.bytes == NULL ? "" : said->transcript.bytes,
                               said->transcript.length);
    default:
      name = said->name == NULL ? "" : said->name;
      length = strlen(name);
      words = (char *)sprout_arena_take(frame->turn, length + 9);
      if (words == NULL) return NULL;
      memcpy(words, "passage ", 8);
      memcpy(words + 8, name, length + 1);
      return words;
  }
}

static sprout_eval_status warned(sprout_exec *x, const sprout_warning *warning) {
  sprout_warning *slot = (sprout_warning *)sprout_exec_grow(x->turn, (void **)&x->warnings, &x->warning_count,
                                                            &x->warning_capacity, sizeof *x->warnings);
  if (slot == NULL) return SPROUT_EVAL_NO_MEMORY;
  *slot = *warning;
  return SPROUT_EVAL_OK;
}

sprout_eval_status sprout_warn_unread(sprout_exec *x, const sprout_frame *frame, sprout_str item, sprout_str to,
                                      const sprout_move_refusal *refusal) {
  sprout_warning warning;
  memset(&warning, 0, sizeof warning);
  warning.kind = SPROUT_WARNING_UNREAD_REFUSAL;
  warning.by = frame->self;
  warning.item = item;
  warning.to = to;
  warning.refuser = refusal->by;
  warning.guard = refusal->guard;
  warning.words = words_written(frame, &refusal->said);
  if (warning.words == NULL) return SPROUT_EVAL_NO_MEMORY;
  return warned(x, &warning);
}

sprout_eval_status sprout_warn_send_lost(sprout_exec *x, const sprout_frame *frame, const char *written,
                                         const char *key) {
  sprout_warning warning;
  memset(&warning, 0, sizeof warning);
  warning.kind = SPROUT_WARNING_SEND_LOST;
  warning.by = frame->self;
  warning.target = written;
  warning.message = key;
  return warned(x, &warning);
}

sprout_eval_status sprout_hear_reading(sprout_exec *x, const sprout_frame *frame, sprout_str actor,
                                       const sprout_str *participants, size_t count, sprout_hearing *saved) {
  saved->heard_by = x->heard_by;
  saved->heard_count = x->heard_count;
  saved->left_out = x->left_out;
  saved->left_out_count = x->left_out_count;
  saved->has_speaker = x->has_speaker;
  saved->speaker = x->speaker;
  saved->records_as_said = x->records_as_said;
  saved->hears_live = x->hears_live;
  x->left_out = participants;
  x->left_out_count = count;
  x->records_as_said = true;
  if (sprout_is_person(frame, actor)) {
    sprout_str *to = (sprout_str *)sprout_arena_take(x->turn, sizeof *to);
    if (to == NULL) return SPROUT_EVAL_NO_MEMORY;
    *to = actor;
    x->heard_by = to;
    x->heard_count = 1;
    x->has_speaker = false;
    x->hears_live = false;
  } else {
    x->has_speaker = true;
    x->speaker = actor;
    x->hears_live = true;
  }
  return SPROUT_EVAL_OK;
}

void sprout_hearing_restore(sprout_exec *x, const sprout_hearing *saved) {
  x->heard_by = saved->heard_by;
  x->heard_count = saved->heard_count;
  x->left_out = saved->left_out;
  x->left_out_count = saved->left_out_count;
  x->has_speaker = saved->has_speaker;
  x->speaker = saved->speaker;
  x->records_as_said = saved->records_as_said;
  x->hears_live = saved->hears_live;
}
