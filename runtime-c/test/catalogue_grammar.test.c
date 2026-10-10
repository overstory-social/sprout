/*
 * Tests for src/catalogue_grammar.c: verbs with their roles and phrases, the
 * typed phrases in the order they are tried, the intents' phrases and the
 * messages match the dump the TypeScript catalogue spec wrote for every
 * corpus world; the typed phrases put the world's own verbs first, shadow a
 * library verb of the same name, and read words as a typed line is read.
 */
#include "corpus.h"

static const char *filler_text(const sprout_role *role, char *out) {
  switch (role->filler) {
    case SPROUT_FILLER_NONE:
      return "none";
    case SPROUT_FILLER_KIND:
      sprintf(out, "kind %s", role->filler_kind->qualified);
      return out;
    case SPROUT_FILLER_OPEN:
      return "open";
    case SPROUT_FILLER_SYMBOL:
      return "symbol";
    case SPROUT_FILLER_INTEGER:
      return "integer";
    case SPROUT_FILLER_EXIT:
      return "exit";
  }
  return "";
}

/* A phrase as the dump writes it: its words, and {n} for the slot of role n. */
static void phrase_text(const sprout_phrase *phrase, char *out) {
  size_t i;
  out[0] = '\0';
  for (i = 0; i < phrase->part_count; i++) {
    if (phrase->parts[i].is_slot) sprintf(out + strlen(out), "{%zu}", phrase->parts[i].role);
    else strcat(out, phrase->parts[i].text);
  }
}

/* A typed phrase's parts as the dump writes them: words joined by a space, parts by a bar. */
static void typed_text(size_t count, const sprout_typed_part *parts, char *out) {
  size_t i, j;
  out[0] = '\0';
  for (i = 0; i < count; i++) {
    if (i > 0) strcat(out, "|");
    if (parts[i].is_slot) {
      sprintf(out + strlen(out), "{%zu}", parts[i].role);
      continue;
    }
    for (j = 0; j < parts[i].word_count; j++) {
      if (j > 0) strcat(out, " ");
      strcat(out, parts[i].words[j]);
    }
  }
}

static void verb_name(const sprout_verb *verb, char *out) {
  sprintf(out, "%s.%s", verb->library, verb->name);
}

static void every_verb_of_every_corpus_world_matches_the_dump(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, v, r, p;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *verbs = corpus_get(dump->items[w], "verbs");
    sprout_world *world = corpus_load(dump->items[w]->key, &host);
    CHECK_INT(world->verb_count, verbs->count);
    for (v = 0; v < world->verb_count && v < verbs->count; v++) {
      const sprout_json *row = verbs->items[v];
      const sprout_json *roles = corpus_get(row, "roles");
      const sprout_json *phrases = corpus_get(row, "phrases");
      const sprout_verb *verb = world->verbs[v];
      char text[512], filler[256];
      verb_name(verb, text);
      CHECK_STR(text, corpus_get(row, "name")->bytes);
      CHECK_INT(verb->role_count, roles->count);
      for (r = 0; r < verb->role_count && r < roles->count; r++) {
        const sprout_json *want = roles->items[r];
        CHECK_STR(verb->roles[r].name, want->items[0]->bytes);
        CHECK_STR(filler_text(&verb->roles[r], filler), want->items[1]->bytes);
        CHECK(verb->roles[r].many == want->items[2]->boolean);
        CHECK(verb->roles[r].optional == want->items[3]->boolean);
        CHECK(verb->roles[r].carried == want->items[4]->boolean);
      }
      CHECK_INT(verb->phrase_count, phrases->count);
      for (p = 0; p < verb->phrase_count && p < phrases->count; p++) {
        phrase_text(&verb->phrases[p], text);
        CHECK_STR(text, phrases->items[p]->bytes);
      }
    }
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

static void every_typed_phrase_matches_the_dump_in_the_order_it_is_tried(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_arena arena;
  const sprout_json *dump;
  size_t w, i;
  sprout_arena_init(&arena, &host);
  dump = corpus_dump(&arena);
  for (w = 0; w < dump->count; w++) {
    const sprout_json *phrases = corpus_get(dump->items[w], "phrases");
    const sprout_json *intents = corpus_get(dump->items[w], "intentPhrases");
    const sprout_json *messages = corpus_get(dump->items[w], "messages");
    sprout_world *world = corpus_load(dump->items[w]->key, &host);
    CHECK_INT(world->phrase_count, phrases->count);
    for (i = 0; i < world->phrase_count && i < phrases->count; i++) {
      const sprout_json *row = phrases->items[i];
      char text[1024];
      verb_name(world->phrases[i].verb, text);
      CHECK_STR(text, row->items[0]->bytes);
      typed_text(world->phrases[i].part_count, world->phrases[i].parts, text);
      CHECK_STR(text, row->items[1]->bytes);
      if (row->items[2]->kind == SPROUT_JSON_NULL) CHECK(world->phrases[i].only == NULL);
      else if (world->phrases[i].only != NULL) CHECK_STR(world->phrases[i].only, row->items[2]->bytes);
      else CHECK(false);
    }
    CHECK_INT(world->intent_phrase_count, intents->count);
    for (i = 0; i < world->intent_phrase_count && i < intents->count; i++) {
      char text[1024];
      const sprout_intent *intent = world->intent_phrases[i].intent;
      sprintf(text, "%s.%s", intent->library, intent->name);
      CHECK_STR(text, intents->items[i]->items[0]->bytes);
      typed_text(world->intent_phrases[i].part_count, world->intent_phrases[i].parts, text);
      CHECK_STR(text, intents->items[i]->items[1]->bytes);
    }
    CHECK_INT(world->message_count, messages->count);
    for (i = 0; i < world->message_count && i < messages->count; i++) {
      char text[256];
      sprintf(text, "%s.%s", world->messages[i].library, world->messages[i].name);
      CHECK_STR(text, messages->items[i]->items[0]->bytes);
      if (messages->items[i]->items[1]->kind == SPROUT_JSON_NULL) CHECK(world->messages[i].carries == NULL);
      else if (world->messages[i].carries != NULL)
        CHECK_STR(world->messages[i].carries->key, messages->items[i]->items[1]->bytes);
      else CHECK(false);
    }
    sprout_world_free(world);
  }
  sprout_arena_reset(&arena);
}

static void the_worlds_own_verbs_are_tried_before_the_standard_librarys(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("verbs", &host);
  size_t i;
  bool left_own = false;
  CHECK(world->phrase_count > 0);
  for (i = 0; i < world->phrase_count; i++) {
    bool own = strcmp(world->phrases[i].verb->library, world->header.name) == 0;
    if (!own) left_own = true;
    else CHECK(!left_own); /* no world verb after a library one */
  }
  CHECK(left_own);
  sprout_world_free(world);
}

static void a_comma_in_a_phrase_is_a_word_of_its_own_and_words_are_lower_case(void) {
  test_heap heap;
  sprout_host host = corpus_host(&heap);
  sprout_world *world = corpus_load("comma-commands", &host);
  size_t i, j, k;
  bool saw_comma = false;
  for (i = 0; i < world->phrase_count; i++)
    for (j = 0; j < world->phrases[i].part_count; j++)
      for (k = 0; k < world->phrases[i].parts[j].word_count; k++) {
        const char *word = world->phrases[i].parts[j].words[k];
        const char *c;
        if (strcmp(word, ",") == 0) saw_comma = true;
        else CHECK(strchr(word, ',') == NULL);
        for (c = word; *c != '\0'; c++) CHECK(!(*c >= 'A' && *c <= 'Z'));
      }
  CHECK(saw_comma);
  sprout_world_free(world);
}

int main(void) {
  RUN(every_verb_of_every_corpus_world_matches_the_dump);
  RUN(every_typed_phrase_matches_the_dump_in_the_order_it_is_tried);
  RUN(the_worlds_own_verbs_are_tried_before_the_standard_librarys);
  RUN(a_comma_in_a_phrase_is_a_word_of_its_own_and_words_are_lower_case);
  return REPORT();
}
