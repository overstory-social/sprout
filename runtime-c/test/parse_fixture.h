/*
 * What the parser's specs share: a corpus world with Marta arrived in it, or a stored world a golden holds, and a
 * command turn opened over it, never committed, whose frame the parser's areas are asked through. The words of a
 * line are read as the parser reads them, and a thing is a candidate with the address the turn gives it.
 */
#ifndef SPROUT_TEST_PARSE_FIXTURE_H
#define SPROUT_TEST_PARSE_FIXTURE_H

#include "turn_fixture.h"

#include "parse/parse.h"
#include "typed.h"

typedef struct bench {
  turn_world w;
  turn_run run;
  sprout_frame frame;
  sprout_str actor; /* Marta, where she arrived */
} bench;

static inline sprout_str bench_str(const char *text) { return (sprout_str){text, strlen(text)}; }

/* Opens the command turn over the bench's state, with `actor` as the frame's self. */
static inline void bench_turn(bench *b) {
  if (turn_open(&b->run, b->w.world, b->w.state, &b->w.host, SPROUT_TURN_COMMAND, 7, 0, NULL, NULL) != SPROUT_OK) {
    fprintf(stderr, "the bench's turn would not open\n");
    exit(2);
  }
  b->frame = sprout_exec_frame(&b->run.x, b->actor, NULL, NULL);
}

/* The corpus world `name`, with Marta arrived under `nickname`, and a turn open over it. */
static inline void bench_open(bench *b, const char *name, const char *nickname) {
  sprout_outcome arrived;
  memset(b, 0, sizeof *b);
  tw_open(&b->w, name);
  tw_arrive(&b->w, "v-marta", nickname, 1000, &arrived);
  sprout_outcome_free(&arrived);
  b->actor = bench_str(tw_person(&b->w, "v-marta"));
  bench_turn(b);
}

/* The corpus world `name` in the stored world `stored` (its JSON), the visitor of `visit` the actor, a turn open over it. */
static inline void bench_stored(bench *b, const char *name, const char *stored, size_t length, const char *visit) {
  size_t bytes;
  sprout_refusal refusal;
  memset(b, 0, sizeof *b);
  b->w.host.ctx = &b->w;
  b->w.host.page_bytes = 65536;
  b->w.host.alloc = tw_alloc;
  b->w.host.release = tw_release;
  b->w.host.seed = tw_seed;
  b->w.heap.refuse_after = -1;
  tw_default_budgets(&b->w.host.budgets);
  b->w.cartridge = corpus_cartridge(name, &bytes);
  if (sprout_load_explained(&b->w.host, b->w.cartridge, bytes, &b->w.world, &refusal) != SPROUT_OK ||
      sprout_state_read(&b->w.host, stored, length, &b->w.state, &refusal) != SPROUT_OK ||
      sprout_state_open(b->w.state, b->w.world, NULL, &refusal) != SPROUT_OK) {
    fprintf(stderr, "%s: %s\n", name, refusal.text);
    exit(2);
  }
  b->actor = bench_str(tw_person(&b->w, visit));
  bench_turn(b);
}

static inline void bench_close(bench *b) {
  turn_drop(&b->run);
  tw_close(&b->w);
}

/* `line` as the parser's words. */
static inline parse_words bench_words(bench *b, const char *line) {
  parse_words words;
  sprout_str *found;
  size_t count;
  if (typed_words(b->frame.turn, bench_str(line), &found, &count) != SPROUT_OK) exit(2);
  words.words = found;
  words.count = count;
  return words;
}

static inline const sprout_stored_instance *bench_instance(bench *b, const char *id) {
  const sprout_stored_instance *instance = sprout_draft_instance(&b->run.draft, bench_str(id));
  if (instance == NULL) {
    fprintf(stderr, "no instance %s\n", id);
    exit(2);
  }
  return instance;
}

/* `id` as a noun may name it, `near` as near as a case says. */
static inline parse_candidate bench_candidate(bench *b, const char *id, size_t near) {
  parse_candidate candidate;
  memset(&candidate, 0, sizeof candidate);
  candidate.instance = bench_instance(b, id);
  candidate.near = near;
  CHECK_INT(parse_address_of(&b->frame, candidate.instance, &candidate.address), SPROUT_EVAL_OK);
  return candidate;
}

/* The noun context of the bench's turn, with what the pronouns name. */
static inline parse_noun_context bench_nouns(bench *b, const sprout_str *referents, size_t count) {
  parse_noun_context context;
  context.frame = &b->frame;
  context.referents = referents;
  context.referent_count = count;
  return context;
}

/* The words joined by single spaces, in the turn arena, for a check. */
static inline const char *bench_joined(bench *b, parse_words words) {
  size_t length = 0, i, at = 0;
  char *out;
  for (i = 0; i < words.count; i++) length += words.words[i].length + 1;
  out = (char *)sprout_arena_take(b->frame.turn, length + 1);
  for (i = 0; i < words.count; i++) {
    if (i > 0) out[at++] = ' ';
    memcpy(out + at, words.words[i].bytes, words.words[i].length);
    at += words.words[i].length;
  }
  out[at] = '\0';
  return out;
}

/* The role `name` of the verb `verb` of `library`. */
static inline const sprout_role *bench_role(bench *b, const char *library, const char *verb, const char *name) {
  size_t i, j;
  for (i = 0; i < b->w.world->verb_count; i++) {
    const sprout_verb *v = b->w.world->verbs[i];
    if (strcmp(v->library, library) != 0 || strcmp(v->name, verb) != 0) continue;
    for (j = 0; j < v->role_count; j++)
      if (strcmp(v->roles[j].name, name) == 0) return &v->roles[j];
  }
  fprintf(stderr, "no role %s of %s.%s\n", name, library, verb);
  exit(2);
}

#endif
