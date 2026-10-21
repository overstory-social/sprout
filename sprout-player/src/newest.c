/* The newest build of each world; see newest.h. */
#include "newest.h"

#include <string.h>

/* ---- versions ---- */

/* A version as semver.org writes one: its three numbers and its pre-release identifiers (none when `pre.length` is 0). */
typedef struct version {
  bool ok;
  player_text core, pre;
} version;

/* The identifier at the front of `rest`, taking it and the dot after it off `rest`. */
static player_text next_identifier(player_text *rest) {
  player_text id;
  const char *dot = (const char *)memchr(rest->at, '.', rest->length);
  id.at = rest->at;
  id.length = dot != NULL ? (size_t)(dot - rest->at) : rest->length;
  rest->at += dot != NULL ? id.length + 1 : id.length;
  rest->length -= dot != NULL ? id.length + 1 : id.length;
  return id;
}

static bool is_number(player_text id) {
  size_t i;
  for (i = 0; i < id.length; i++)
    if (id.at[i] < '0' || id.at[i] > '9') return false;
  return id.length > 0;
}

/* Letters, digits and hyphens, at least one. */
static bool is_identifier(player_text id) {
  size_t i;
  for (i = 0; i < id.length; i++) {
    char c = id.at[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-')) return false;
  }
  return id.length > 0;
}

/* Whether `run` is dot-separated identifiers, how many, numbers only where `numbers` says, and a number with a leading
 * zero only where `zeros` allows one. */
static bool run_of(player_text run, bool numbers, bool zeros, size_t *count) {
  *count = 0;
  if (run.length == 0 || run.at[run.length - 1] == '.') return false;
  while (run.length > 0) {
    player_text id = next_identifier(&run);
    if (!is_identifier(id) || (numbers && !is_number(id))) return false;
    if (!zeros && is_number(id) && id.length > 1 && id.at[0] == '0') return false;
    (*count)++;
  }
  return true;
}

/* `text` read by semver.org's grammar: MAJOR.MINOR.PATCH, then `-` and a pre-release, then `+` and build metadata. */
static version read_version(const char *text, size_t length) {
  version read;
  const char *plus = (const char *)memchr(text, '+', length), *end = plus != NULL ? plus : text + length;
  const char *dash = (const char *)memchr(text, '-', (size_t)(end - text));
  size_t count = 0, build = 0;
  player_text after;
  read.core.at = text;
  read.core.length = (size_t)((dash != NULL ? dash : end) - text);
  read.pre.at = dash != NULL ? dash + 1 : end;
  read.pre.length = dash != NULL ? (size_t)(end - dash - 1) : 0;
  after.at = plus != NULL ? plus + 1 : end;
  after.length = plus != NULL ? (size_t)(text + length - plus - 1) : 0;
  read.ok = run_of(read.core, true, false, &count) && count == 3 &&
            (dash == NULL || run_of(read.pre, false, false, &count)) && (plus == NULL || run_of(after, false, true, &build));
  return read;
}

/* semver.org's precedence of two identifiers: numbers by value and below words, words in ASCII order. */
static int compare_identifier(player_text a, player_text b) {
  bool a_number = is_number(a), b_number = is_number(b);
  int bytes;
  if (a_number && b_number && a.length != b.length) return a.length < b.length ? -1 : 1;
  if (a_number != b_number) return a_number ? -1 : 1;
  bytes = memcmp(a.at, b.at, a.length < b.length ? a.length : b.length);
  if (bytes != 0) return bytes < 0 ? -1 : 1;
  return a.length == b.length ? 0 : (a.length < b.length ? -1 : 1);
}

/* The first identifiers that differ decide, else the longer run is the higher. */
static int compare_run(player_text a, player_text b) {
  while (a.length > 0 && b.length > 0) {
    int order = compare_identifier(next_identifier(&a), next_identifier(&b));
    if (order != 0) return order;
  }
  return (a.length > 0) - (b.length > 0);
}

player_text player_text_of(const char *text) {
  player_text whole;
  whole.at = text;
  whole.length = text != NULL ? strlen(text) : 0;
  return whole;
}

int player_version_order(player_text a, player_text b) {
  version x, y;
  int order;
  memset(&x, 0, sizeof x);
  memset(&y, 0, sizeof y);
  if (a.at != NULL) x = read_version(a.at, a.length);
  if (b.at != NULL) y = read_version(b.at, b.length);
  if (!x.ok || !y.ok) return x.ok - y.ok;
  order = compare_run(x.core, y.core);
  if (order != 0) return order;
  if (x.pre.length == 0 || y.pre.length == 0) return (x.pre.length == 0) - (y.pre.length == 0);
  return compare_run(x.pre, y.pre);
}

/* ---- builds ---- */

static bool same_text(player_text a, player_text b) {
  return a.at != NULL && b.at != NULL && a.length == b.length && memcmp(a.at, b.at, a.length) == 0;
}

/* Whether two builds are of one world: the same title and the same author, with both versions known. */
static bool same_world(player_build a, player_build b) {
  return a.version.at != NULL && b.version.at != NULL && same_text(a.title, b.title) && same_text(a.author, b.author);
}

size_t player_newest_builds(const player_builds *list) {
  size_t kept = 0, i, j;
  for (i = 0; i < list->count; i++) {
    player_build build = list->at(list->ctx, i);
    j = 0;
    while (j < kept && !same_world(list->at(list->ctx, j), build)) j++;
    /* Places past `kept` and before `i` hold builds already outranked, so either exchange leaves one of those behind. */
    if (j == kept) {
      if (i != kept) list->swap(list->ctx, kept, i);
      kept++;
    } else if (player_version_order(build.version, list->at(list->ctx, j).version) > 0) {
      list->swap(list->ctx, j, i);
    }
  }
  return kept;
}
