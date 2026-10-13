/*
 * The sentence builder's state, as Source/sentence.lua keeps it, over the session's chip tree a
 * level at a time (player_chips; the design doc's The chip tree and the crank sentence builder).
 * The visitor picks a verb, then what fills each of its roles, then a word or a number for each
 * value role, then confirms. A verb's readings are asked for only when the drum reaches it
 * (`sentence_prepare`), so at the verbs a choice not yet reached is neither greyed nor not. A set
 * role is joined from the singletons the view offers, and the roles after it are offered under its
 * first member. A finished reading lists the roles a thing fills in the tree's order and then the
 * value roles. Nothing here draws; the entries and the phrase are what the screen shows.
 *
 * The fillers and leaves the sentence points at live in the session's view, so a sentence lives
 * only until the next view is polled.
 */
#ifndef PLAYER_UI_SENTENCE_H
#define PLAYER_UI_SENTENCE_H

#include <stdbool.h>
#include <stddef.h>

#include "pd_api.h"
#include "session.h"

/* Degrees of crank for one step of the drum. */
#define SENTENCE_DEGREES_PER_STEP 24.0f
/* Numbers a d-pad left or right moves a number role by. */
#define SENTENCE_BIG_STEP 10
/* The parts a sentence holds: picks along the tree, and value roles. */
#define SENTENCE_MOST_PARTS 16
/* The things a set role joins. */
#define SENTENCE_MOST_MEMBERS 32

typedef enum sentence_stage {
  SENTENCE_VERB,    /* the verbs */
  SENTENCE_FILLER,  /* what fills the next role, and `that's all` where a reading ends here */
  SENTENCE_MORE,    /* a set role begun: the other things it can join, and `that's all` */
  SENTENCE_OPTION,  /* a value role's word or number */
  SENTENCE_CONFIRM  /* the whole sentence, to run */
} sentence_stage;

typedef enum sentence_kind {
  SENTENCE_ENTRY_VERB,
  SENTENCE_ENTRY_FILLER,
  SENTENCE_ENTRY_MEMBER,
  SENTENCE_ENTRY_DONE,
  SENTENCE_ENTRY_OPTION,
  SENTENCE_ENTRY_NUMBER,
  SENTENCE_ENTRY_NONE,
  SENTENCE_ENTRY_CONFIRM
} sentence_kind;

/* One word on the drum; its strings live until the sentence next changes. */
typedef struct sentence_entry {
  sentence_kind kind;
  const char *label;
  bool greyed;
  const char *reason; /* why it cannot be done, where it is greyed and that is known; else NULL */
  size_t index;       /* the choice or option it stands for, from 0 */
  size_t label_at, reason_at; /* where the strings are in the sentence's words while the entries are made */
} sentence_entry;

/* A thing a set role has joined, and why it cannot be done, if it cannot. */
typedef struct sentence_member {
  const sprout_seen_thing *thing;
  size_t reason; /* 1 + its offset in the kept words, or 0 */
} sentence_member;

/* A pick along the tree: a filler, or a set role joined from several. */
typedef struct sentence_filled {
  const sprout_seen_filler *filler;
  size_t first, count; /* a set: its members in the state's `joined` */
} sentence_filled;

/* A value role filled: a symbol role's option, or an integer role's number. */
typedef struct sentence_value {
  const sprout_seen_options *role;
  const sprout_seen_option *option; /* NULL for a number */
  double number;
} sentence_value;

/* Where the builder is; a pick keeps the state it left so B can step back to it. */
typedef struct sentence_state {
  sentence_stage stage;
  size_t selected; /* the entry in the drum's window, from 0 */
  const char *verb;
  size_t path[SENTENCE_MOST_PARTS]; /* the level the drum shows: 1-based picks, as player_chips takes them */
  size_t depth;
  sentence_filled picks[SENTENCE_MOST_PARTS];
  size_t pick_count;
  const sprout_seen_thing *joined[SENTENCE_MOST_MEMBERS]; /* the members of the sets picked */
  size_t joined_count;
  sentence_value values[SENTENCE_MOST_PARTS];
  size_t value_count;
  /* a set role being joined */
  const sprout_seen_filler *set;
  size_t set_choice; /* the 1-based pick of its first member */
  sentence_member members[SENTENCE_MOST_MEMBERS];
  size_t member_count;
  size_t refusal; /* 1 + the offset in the kept words of the first member's refusal, or 0 */
  /* the leaf reached and its value roles */
  const sprout_seen_reading *leaf;
  size_t empty_reason; /* no leaf: 1 + the offset of why nothing fits, or 0 */
  size_t role;
  double number;
  bool has_number;
} sentence_state;

/* Text that grows from the device's allocator; strings in it are found by offset, since it moves. */
typedef struct sentence_text {
  char *bytes;
  size_t length, room;
} sentence_text;

/* One choice of the level the drum shows, copied from the session's answer. */
typedef struct sentence_choice {
  const char *verb;
  const sprout_seen_filler *filler;
  player_greyed greyed;
  size_t reason; /* 1 + its offset in the level's words, or 0 */
} sentence_choice;

typedef struct sentence {
  PlaydateAPI *pd;
  player_session *session;
  sentence_state state;
  sentence_state *history;
  size_t history_count, history_room;
  float crank; /* degrees turned past the selected entry toward the next */
  /* the level at the state's path */
  sentence_choice *choices;
  size_t choice_count, choice_room;
  const sprout_seen_reading *leaf;
  sentence_text level_words;
  /* words kept while the sentence lives: members' refusals */
  sentence_text kept;
  /* what the drum shows now */
  sentence_entry *entries;
  size_t entry_count, entry_room;
  sentence_text shown;
  sentence_text phrase;
  /* the reading built on confirming */
  sprout_filling fillings[2 * SENTENCE_MOST_PARTS];
  const char *ids[SENTENCE_MOST_MEMBERS];
} sentence;

/* What a pick came to. */
typedef enum sentence_end {
  SENTENCE_GOES_ON, /* the sentence moved on, or the drum is at a new step */
  SENTENCE_DONE,    /* the visitor confirmed: the reading is ready */
  SENTENCE_REFUSED  /* it cannot be picked: the words say why */
} sentence_end;

/*
 * A sentence at the verbs of the last view, the first of them asked for at once. False with the
 * words in `*why` when the verbs cannot be had or there is no memory for them.
 */
bool sentence_begin(sentence *s, PlaydateAPI *pd, player_session *session, const char **why);
void sentence_free(sentence *s);

/* The entries on the drum, in order; there is always at least one. */
const sentence_entry *sentence_entries(const sentence *s, size_t *count);

/* The sentence so far: the verb and what has been chosen, joined by arrows. */
const char *sentence_phrase(const sentence *s);

/* Moves the drum by `steps` entries, wrapping. */
void sentence_move(sentence *s, long steps);

/* A step of the drum: a number role changes its number by `steps`, any other drum moves. */
void sentence_nudge(sentence *s, long steps);

/* Whether the drum is on an integer role, where steps change the number. */
bool sentence_numbered(const sentence *s);

/* Moves the number by `steps`, each of 1 or, when `big`, of SENTENCE_BIG_STEP; a big step past the end goes to the end. */
void sentence_add_number(sentence *s, long steps, bool big);

/* Turns the crank by `degrees`: a step for each SENTENCE_DEGREES_PER_STEP, the rest kept toward the next. The steps. */
long sentence_turn(sentence *s, float degrees);

/* How far the crank has turned past the selected entry toward the next, in steps (-1 to 1). */
float sentence_fraction(const sentence *s);

/*
 * Lets the drum come to rest on the nearest entry, `share` of the way a call: a crank past half a step
 * completes the step first. Whether it arrived this call; `*steps` the steps the completion moved.
 */
bool sentence_settle(sentence *s, float share, long *steps);

/* Asks for the readings of the verb in the window, if the drum is at the verbs and they are not known. Whether it asked. */
bool sentence_prepare(sentence *s);

/* Picks the entry in the window; for SENTENCE_REFUSED `*words` says why. */
sentence_end sentence_pick(sentence *s, const char **words);

/* Steps back one pick; false when the builder is already at the verbs. */
bool sentence_back(sentence *s);

/* The reading confirmed, its actor left for the session; it points into the sentence and the view. */
void sentence_reading(sentence *s, sprout_reading *reading);

#endif
