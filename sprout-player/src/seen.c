/*
 * The visitor's view for the UI (the spec's The runtime > The view): the place, by id and as the
 * visitor reads it, its description as paragraphs, what its extension statements recorded (an image
 * to draw), the ways out, who else is there, what is carried. That is the scene, polled without any
 * readings; the verbs the scene lists are the root of the chip tree the sentence builder walks, and
 * a verb's readings are asked of the runtime only when the builder reaches that verb, arranged as
 * its subtree and kept, so no poll ever runs the offers for every verb at once and the UI never
 * holds a tree. `player_chips` hands a level at a time, each choice with whether anything under it
 * can be done and why not; a verb whose readings have not been asked for is neither greyed nor not,
 * and the level under it answers that too. The scene and the subtrees live until the state changes
 * (a turn that commits or changes it marks them stale, and the next view polls again), the next
 * load, the close or the end; a view asked while they stand is the kept one, so opening the
 * sentence builder costs no poll.
 */
#include <string.h>

#include "chips.h"
#include "session_internal.h"
#include "view.h"

void session_drop_view(player_session *session) {
  if (!session->seen_live) return;
  sprout_arena_reset(&session->chip_arena);
  sprout_view_free(&session->seen);
  memset(&session->seen, 0, sizeof session->seen);
  memset(&session->chips, 0, sizeof session->chips);
  session->fetched = NULL;
  session->why_empty = NULL;
  session->seen_live = false;
}

/* The root of the tree: one verb each of the scene's, its subtree not yet asked for. */
static bool begin_tree(player_session *session) {
  const sprout_seen_view *view = &session->seen;
  sprout_arena *arena = &session->chip_arena;
  size_t i;
  session->chips.verb_count = view->verb_count;
  session->chips.verbs = (sprout_chip_verb *)sprout_arena_take(arena, (view->verb_count + 1) * sizeof *session->chips.verbs);
  session->fetched = (bool *)sprout_arena_take(arena, (view->verb_count + 1) * sizeof *session->fetched);
  session->why_empty = (const char **)sprout_arena_take(arena, (view->verb_count + 1) * sizeof *session->why_empty);
  if (session->chips.verbs == NULL || session->fetched == NULL || session->why_empty == NULL) return false;
  for (i = 0; i < view->verb_count; i++) session->chips.verbs[i].verb = view->verbs[i];
  return true;
}

const sprout_seen_view *player_view(player_session *session, const char **words) {
  sprout_seen_view *view = &session->seen;
  sprout_status status;
  session_answer(session);
  if (session->seen_live && !session->seen_stale) {
    *words = "";
    return view;
  }
  session_drop_view(session);
  if (!(session->state != NULL && session_visitor(session) != NULL &&
        session_visitor_present(session, session_visitor(session)))) {
    *words = "You are not in a world.";
    return NULL;
  }
  status = sprout_scene(session->world, session->state, &session->host.record, PLAYER_VISIT, view);
  if (status != SPROUT_OK) {
    *words = session_keep(session, status == SPROUT_BAD_INPUT ? view->fault.text : sprout_status_text(status));
    return NULL;
  }
  session->seen_live = true;
  session->seen_stale = false;
  sprout_arena_init(&session->chip_arena, &session->host.record);
  if (!begin_tree(session)) {
    session_drop_view(session);
    *words = "The player ran out of memory looking around.";
    return NULL;
  }
  *words = "";
  return view;
}

/* ---- the chips, a level at a time ---- */

/* Whether nothing at or below `node` can be done: its reading and every choice are refused. */
static bool refused_all(const sprout_chip_node *node) {
  size_t i;
  if (node->leaf != NULL && !node->leaf->refused) return false;
  for (i = 0; i < node->choice_count; i++)
    if (!refused_all(node->choices[i].next)) return false;
  return true;
}

/* Why nothing at or below `node` can be done: the first refused reading under it, or NULL. */
static const sprout_seen_reading *reason_under(const sprout_chip_node *node) {
  if (node->leaf != NULL && node->leaf->refused) return node->leaf;
  if (node->leaf == NULL && node->choice_count > 0) return reason_under(node->choices[0].next);
  return NULL;
}

/* A refusal's paragraphs as one line in `arena`, or NULL where there is none or no room. */
static const char *reason_text(sprout_arena *arena, const sprout_seen_reading *refused) {
  size_t total = 0, i, at = 0;
  char *joined;
  if (refused == NULL) return NULL;
  for (i = 0; i < refused->refusal_count; i++) total += refused->refusal[i].length + 1;
  joined = (char *)sprout_arena_take(arena, total + 1);
  if (joined == NULL) return NULL;
  for (i = 0; i < refused->refusal_count; i++) {
    if (i > 0) joined[at++] = ' ';
    memcpy(joined + at, refused->refusal[i].bytes, refused->refusal[i].length);
    at += refused->refusal[i].length;
  }
  joined[at] = '\0';
  return joined;
}

/*
 * The subtree of verb `v`, asked of the runtime the first time it is reached: its readings over what is in
 * range, kept with the scene. A verb with no reading, or whose poll ran out, has an empty subtree. False
 * when the host refuses a page, with `*why` the words.
 */
static bool fetch_verb(player_session *session, size_t v, const char **why) {
  sprout_chip_verb *verb = &session->chips.verbs[v];
  sprout_arena *arena = &session->chip_arena;
  sprout_seen_view readings;
  sprout_chip_tree tree;
  sprout_status status;
  if (session->fetched[v]) return true;
  status = sprout_readings_for(session->world, session->state, &session->host.record, PLAYER_VISIT, verb->verb, arena,
                               &readings);
  if (status == SPROUT_BAD_INPUT) {
    const char *copy = sprout_arena_copy(arena, readings.fault.text, strlen(readings.fault.text));
    *why = copy != NULL ? copy : sprout_status_text(SPROUT_NO_MEMORY);
    return false;
  }
  if (status != SPROUT_OK || sprout_chip_tree_of(arena, &readings, &tree) != SPROUT_OK) {
    *why = sprout_status_text(SPROUT_NO_MEMORY);
    return false;
  }
  if (readings.faulted) {
    /* The poll ran out: the verb is greyed with the fault's words, and asked for again when reached next. */
    const char *words = readings.fault.text[0] != '\0' ? readings.fault.text : "This world has too much to read here.";
    verb->next = (sprout_chip_node *)sprout_arena_take(arena, sizeof *verb->next);
    session->why_empty[v] = verb->next == NULL ? NULL : sprout_arena_copy(arena, words, strlen(words));
    if (verb->next == NULL || session->why_empty[v] == NULL) {
      *why = sprout_status_text(SPROUT_NO_MEMORY);
      return false;
    }
    session->fetched[v] = false;
    return true;
  }
  if (tree.verb_count > 0) {
    verb->next = tree.verbs[0].next;
    session->why_empty[v] = NULL;
  } else {
    /* Its roles could be filled from what is here, but no reading fits: the verb says so when reached. */
    const char *name = strrchr(verb->verb, '.');
    size_t head = strlen("Nothing here fits "), tail;
    char *words;
    name = name == NULL ? verb->verb : name + 1;
    tail = strlen(name);
    verb->next = (sprout_chip_node *)sprout_arena_take(arena, sizeof *verb->next);
    words = (char *)sprout_arena_take(arena, head + tail + 2);
    if (verb->next == NULL || words == NULL) {
      *why = sprout_status_text(SPROUT_NO_MEMORY);
      return false;
    }
    memcpy(words, "Nothing here fits ", head);
    memcpy(words + head, name, tail);
    words[head + tail] = '.';
    words[head + tail + 1] = '\0';
    session->why_empty[v] = words;
  }
  session->fetched[v] = true;
  return true;
}

#define NO_CHOICE "The path names no choice of the tree."

/*
 * The node `picks` names (the verb's, then each choice's), its verb's readings asked for on the way; NULL when
 * the picks name nothing (`*why` NO_CHOICE) or the readings could not be asked for (`*why` the words); the root
 * is no node, so `*root` says where there are no picks, and `*verb` is the verb's index where there are.
 */
static const sprout_chip_node *node_at(player_session *session, const size_t *picks, size_t count, bool *root,
                                       size_t *verb, const char **why) {
  const sprout_chip_node *node = NULL;
  size_t i, at;
  *root = count == 0;
  *why = NO_CHOICE;
  for (i = 0; i < count; i++) {
    at = picks[i];
    if (at == 0) return NULL;
    if (i == 0) {
      if (at > session->chips.verb_count) return NULL;
      *verb = at - 1;
      if (!fetch_verb(session, at - 1, why)) return NULL;
      node = session->chips.verbs[at - 1].next;
    } else {
      if (at > node->choice_count) return NULL;
      node = node->choices[at - 1].next;
    }
  }
  return node;
}

/* A level that cannot be given, and why. */
static player_chip_level no_level(player_session *session, const char *reason) {
  player_chip_level level;
  memset(&level, 0, sizeof level);
  level.reason = session_keep(session, reason);
  return level;
}

/* Whether and why nothing under a verb can be done, once its readings are known; unknown before. */
static void grey_verb(player_session *session, size_t v, player_chip *into) {
  const sprout_chip_verb *verb = &session->chips.verbs[v];
  into->verb = verb->verb;
  if (session->why_empty[v] != NULL) {
    /* Nothing fits it, or its poll ran out: greyed, with the words that say which. */
    into->greyed = PLAYER_GREYED_YES;
    into->reason = session->why_empty[v];
    return;
  }
  if (!session->fetched[v]) {
    into->greyed = PLAYER_GREYED_UNKNOWN;
    into->reason = NULL;
    return;
  }
  into->greyed = refused_all(verb->next) ? PLAYER_GREYED_YES : PLAYER_GREYED_NO;
  into->reason = reason_text(&session->answer, reason_under(verb->next));
}

player_chip_level player_chips(player_session *session, const size_t *picks, size_t pick_count) {
  player_chip_level level;
  player_chip *choices, *verb_chip;
  const sprout_chip_node *node;
  const char *why;
  bool at_root = false;
  size_t i, verb = 0;
  session_answer(session);
  if (!session->seen_live) return no_level(session, "No view has been polled.");
  node = node_at(session, picks, pick_count, &at_root, &verb, &why);
  if (node == NULL && !at_root) return no_level(session, why);
  memset(&level, 0, sizeof level);
  level.ok = true;
  level.choice_count = at_root ? session->chips.verb_count : node->choice_count;
  choices = (player_chip *)sprout_arena_take(&session->answer, (level.choice_count + 1) * sizeof *choices);
  if (choices == NULL) return no_level(session, sprout_status_text(SPROUT_NO_MEMORY));
  level.choices = choices;
  if (at_root) {
    for (i = 0; i < level.choice_count; i++) grey_verb(session, i, &choices[i]);
    return level;
  }
  for (i = 0; i < level.choice_count; i++) {
    const sprout_chip_choice *one = &node->choices[i];
    choices[i].filler = one->filler;
    choices[i].greyed = refused_all(one->next) ? PLAYER_GREYED_YES : PLAYER_GREYED_NO;
    choices[i].reason = reason_text(&session->answer, reason_under(one->next));
  }
  level.leaf = node->leaf;
  /* The level under a verb says of the verb itself what the root could not before its readings were asked for. */
  if (pick_count == 1) {
    verb_chip = (player_chip *)sprout_arena_take(&session->answer, sizeof *verb_chip);
    if (verb_chip == NULL) return no_level(session, sprout_status_text(SPROUT_NO_MEMORY));
    grey_verb(session, verb, verb_chip);
    level.verb = verb_chip;
  }
  return level;
}
