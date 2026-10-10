/*
 * What an object is called when a slot renders it (the spec's Prose > Slots; Names > Addressing and
 * display, Articles, Nicknames). An object renders as its article and its name, as its grammar block
 * and the defaults give them (address.c), and as "you" to the reader it is. The default article is
 * `a`, or `an` before a vowel.
 */
#include "../address.h"
#include "prose.h"

static sprout_eval_status joined(const sprout_frame *frame, const char *article, size_t article_length, sprout_str name,
                                 sprout_str *words) {
  size_t gap = article_length > 0 ? article_length + 1 : 0;
  char *out = (char *)sprout_arena_take(frame->turn, gap + name.length + 1);
  if (out == NULL) return SPROUT_EVAL_NO_MEMORY;
  if (gap > 0) {
    memcpy(out, article, article_length);
    out[article_length] = ' ';
  }
  memcpy(out + gap, name.bytes, name.length);
  words->bytes = out;
  words->length = gap + name.length;
  return SPROUT_EVAL_OK;
}

sprout_eval_status prose_object_words(const sprout_frame *frame, sprout_str object, sprout_str reader,
                                      sprout_str *words) {
  const sprout_stored_instance *instance;
  const sprout_node *written;
  sprout_str name;
  const char *article;
  if (sprout_str_same(object, reader)) {
    *words = (sprout_str){"you", 3};
    return SPROUT_EVAL_OK;
  }
  EXPR_NEED(expr_instance_of(frame, object, &instance));
  EXPR_NEED(sprout_name_of(frame, instance, &name));
  if (instance->made == SPROUT_MADE_VISITOR && sprout_visitor_of(frame->draft, object) != NULL) {
    *words = name;
    return SPROUT_EVAL_OK;
  }
  written = sprout_grammar_text(instance->kind, "article");
  if (written != NULL) article = written->text;
  else
    article = name.length > 0 && strchr("aeiouAEIOU", name.bytes[0]) != NULL ? "an" : "a";
  if (strcmp(article, "none") == 0) {
    *words = name;
    return SPROUT_EVAL_OK;
  }
  return joined(frame, article, strlen(article), name, words);
}
