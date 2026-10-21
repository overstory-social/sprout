/*
 * The newest build of each world, as the download screen offers builds from the index and the shelf
 * shows the cartridges installed (the design doc's Shipped worlds and downloads). Builds are one world
 * when they share a title and an author; of those, the highest version wins by semver.org's
 * precedence, since the spec's The manifest gives `version` as semver, and the first listed wins among
 * equals, since neither an index nor a folder carries a publish order. A version that is not semver
 * ranks below any that is, and two such are equal.
 */
#ifndef PLAYER_NEWEST_H
#define PLAYER_NEWEST_H

#include <stdbool.h>
#include <stddef.h>

/* `length` bytes of text at `at`, which need not end in a NUL; `at` is NULL where the text is not known. */
typedef struct player_text {
  const char *at;
  size_t length;
} player_text;

/* The whole of the NUL-terminated `text`, or unknown where it is NULL. */
player_text player_text_of(const char *text);

/* How version `a` ranks against `b`: below zero when lower, zero when equal, above zero when higher; an unknown
 * version ranks as one that is not semver. */
int player_version_order(player_text a, player_text b);

/* A build as the ranking reads it; one whose author or version is not known is a world of its own. */
typedef struct player_build {
  player_text title, author, version;
} player_build;

/* A list of builds: `count` of them, build `i` read by `at` and two exchanged by `swap`. */
typedef struct player_builds {
  void *ctx;
  size_t count;
  player_build (*at)(void *ctx, size_t i);
  void (*swap)(void *ctx, size_t i, size_t j);
} player_builds;

/*
 * Reorders `list` so that its first places hold the newest build of each world, each where that world
 * was first listed, and the builds they outrank follow; returns how many worlds there are.
 */
size_t player_newest_builds(const player_builds *list);

#endif
