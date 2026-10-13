/*
 * The nickname screen: who the visitor is in the world, picked from a pool of plain words, since
 * the console has no keyboard (the design doc's Nickname, and Source/nickname.lua's). The pool is
 * filtered by the cartridge's words and by who is present, folded as the TypeScript host folds a
 * nickname (lower case, split on white space); a returning visitor is offered their last name
 * first. The crank and up and down move through the names, A asks `player_admit`, and B closes
 * the world and goes back to the shelf. The engine's admission is the authority (the spec's The
 * host contract › Admission and identity): a name it refuses is told in its words over the
 * screen, and A or B goes back to picking; an admitted one goes on to the arrival told (arrival.h).
 */
#ifndef PLAYER_UI_NICKNAME_H
#define PLAYER_UI_NICKNAME_H

#include <stdbool.h>
#include <stddef.h>

#include "app.h"
#include "wrap.h"

/* Degrees of crank for a name moved. */
#define NICKNAME_DEGREES_PER_STEP 24.0f

#define NICKNAME_POOL_SIZE 45

extern const char *const nickname_pool[NICKNAME_POOL_SIZE];

typedef struct player_nickname {
  char title[128];
  char *notice; /* what the save had to say, from the device's allocator, told when the visitor arrives; or NULL */
  const char *names[NICKNAME_POOL_SIZE]; /* the names offered, from the pool */
  size_t count, selected;
  float crank;     /* degrees turned toward the next name, not yet a name */
  wrapped refused; /* why the last name was refused, shown until A or B; no lines when none */
} player_nickname;

extern const player_screen player_nickname_screen;

/* The screen for the world titled `title`, offering the whole pool; NULL when there is no memory for it. */
player_nickname *player_nickname_new(player_app *app, const char *title);

/* Keeps of the `count` names those that are none of the `word_count` words (any case); how many are kept. */
size_t nickname_without_words(const char **names, size_t count, const char *const *words, size_t word_count);

/* Keeps of the `count` names those that no one of `present`, folded, holds; how many are kept. */
size_t nickname_without_present(const char **names, size_t count, const sprout_str *present, size_t present_count);

/* The index of the name that is `preferred`, folded, or 0 when none is or `preferred` is NULL. */
size_t nickname_preferred(const char *const *names, size_t count, const sprout_str *preferred);

#endif
