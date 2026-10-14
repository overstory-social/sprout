/*
 * What a host asks of the committed world between turns (the spec's The host contract), over the live state and
 * drawing nothing: why a nickname may not be a visitor's here; the places a visitor stands in, which the host
 * ticks; the wakes due by an instant; who hears what a visitor says to the people with them; and where a visitor
 * stands and what else is there, named for them. Each is answered in the language's shape.
 */
#include <string.h>

#include "address.h"
#include "budget.h"
#include "draft.h"
#include "engine.h"
#include "exec.h"
#include "expr/expr.h"
#include "prose/prose.h"
#include "world.h"

/* One question over the live state: a draft that writes nothing, and a frame of the visitor to name things for. */
typedef struct looking {
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_eval_fault fault;
  sprout_exec x;
  sprout_frame frame;
  const sprout_stored_visitor *visitor;
} looking;

/* Opens a question about the visitor under `visit`, who may have none; false when memory runs out. */
static bool look(wasm_engine *e, const char *visit, looking *l) {
  memset(l, 0, sizeof *l);
  if (sprout_arena_init(&l->turn, &e->host) != SPROUT_OK) return false;
  if (sprout_draft_open(&l->draft, &l->turn, e->world, e->state) != SPROUT_DRAFT_OK) {
    sprout_arena_reset(&l->turn);
    return false;
  }
  sprout_meter_begin(&l->meter, &e->host, SPROUT_TURN_POLL);
  sprout_exec_begin(&l->x, e->world, &l->draft, &l->turn, &l->meter, NULL, &l->fault, 0);
  l->visitor = visit == NULL ? NULL : sprout_draft_visitor(&l->draft, (sprout_str){visit, strlen(visit)});
  if (l->visitor != NULL) l->frame = sprout_exec_frame(&l->x, l->visitor->instance, NULL, NULL);
  return true;
}

static void done(looking *l) { sprout_arena_reset(&l->turn); }

/* The id of the place the visitor stands in: a place still, there, live and holding actors; false otherwise. */
static bool place_of(const looking *l, sprout_str *place) {
  const sprout_stored_instance *person, *standing;
  if (l->visitor == NULL) return false;
  person = sprout_draft_instance(&l->draft, l->visitor->instance);
  if (person == NULL || !person->has_container) return false;
  standing = sprout_draft_instance(&l->draft, person->container);
  *place = person->container;
  return standing != NULL && !sprout_str_same(*place, l->draft.base->world) && expr_live(&l->frame, *place) &&
         standing->kind->contains_actors;
}

bool questions_stands_in_place(wasm_engine *e, const char *visit) {
  looking l;
  sprout_str place;
  bool stands;
  if (!look(e, visit, &l)) return true;
  stands = place_of(&l, &place);
  done(&l);
  return stands;
}

static const char *const REASONS[] = {"", "empty", "not-words", "too-long", "source-shaped", "world-word", "reserved", "held"};

/*
 * Why a nickname may not be a visitor's here, against the world, the host's bound and the people present, the input
 * holding the visit and then the nickname: `{"reason", "nickname", "collides", "words"}`, or null where it may be.
 */
EXPORT("sw_nickname") int sw_nickname(size_t visit_length, size_t nickname_length) {
  wasm_engine *e = &the_engine;
  sprout_admission admission;
  sprout_json *root, *collides;
  const char *visit, *nickname;
  sprout_status status;
  size_t i;
  int said;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  visit = engine_input_string(e, 0, visit_length);
  nickname = engine_input_string(e, visit_length, nickname_length);
  if (visit == NULL || nickname == NULL) return engine_refuse(e, "Hand the visit and nickname in through sw_input first.");
  status = sprout_admit(e->world, e->state, &e->host, visit, nickname, nickname_length, &admission);
  if (status != SPROUT_OK) return engine_answer_text(e, status, sprout_status_text(status));
  if (admission.reason == SPROUT_NICKNAME_OK) {
    sprout_admission_free(&admission);
    return engine_answer_json(e, engine_null(e));
  }
  root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 4);
  collides = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, admission.collide_count);
  said = SPROUT_NO_MEMORY;
  if (root != NULL && collides != NULL) {
    for (i = 0; i < admission.collide_count; i++)
      sprout_json_adopt(collides, NULL, engine_text(e, sprout_arena_copy(&e->scratch, admission.collides[i].bytes, admission.collides[i].length),
                                                    admission.collides[i].length));
    sprout_json_adopt(root, "reason", engine_text(e, REASONS[admission.reason], strlen(REASONS[admission.reason])));
    sprout_json_adopt(root, "nickname", engine_text(e, nickname, nickname_length));
    sprout_json_adopt(root, "collides", collides);
    sprout_json_adopt(root, "words", engine_text(e, sprout_arena_copy(&e->scratch, admission.words.bytes, admission.words.length),
                                                 admission.words.length));
    if (collides->count == admission.collide_count && root->count == 4) said = engine_answer_json(e, root);
  }
  sprout_admission_free(&admission);
  return said;
}

/* Every place a visitor stands in, once each, in code-unit order: the places a host ticks. */
EXPORT("sw_occupied") int sw_occupied(void) {
  wasm_engine *e = &the_engine;
  sprout_places places;
  sprout_json *ids;
  sprout_status status;
  size_t i;
  int said = SPROUT_NO_MEMORY;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  status = sprout_places_occupied(e->world, e->state, &e->host, &places);
  if (status != SPROUT_OK) return engine_answer_text(e, status, sprout_status_text(status));
  if ((ids = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, places.count)) != NULL) {
    for (i = 0; i < places.count; i++) sprout_json_adopt(ids, NULL, engine_text(e, places.ids[i].bytes, places.ids[i].length));
    if (ids->count == places.count) said = engine_answer_json(e, ids);
  }
  sprout_places_free(&places);
  return said;
}

/* Every wake due by `now`, on an object in the tree, oldest first: `[{"object", "serial", "askedAt", "dueAt"}]`. */
EXPORT("sw_due_wakes") int sw_due_wakes(uint64_t now) {
  wasm_engine *e = &the_engine;
  sprout_wakes wakes;
  sprout_json *list;
  sprout_status status;
  size_t i;
  int said = SPROUT_NO_MEMORY;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  status = sprout_wakes_due(e->world, e->state, &e->host, now, &wakes);
  if (status != SPROUT_OK) return engine_answer_text(e, status, sprout_status_text(status));
  if ((list = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, wakes.count)) != NULL) {
    for (i = 0; i < wakes.count; i++) {
      const sprout_due_wake *due = &wakes.wakes[i];
      sprout_json *one = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 4);
      if (one == NULL) break;
      sprout_json_adopt(one, "object", engine_text(e, due->object.bytes, due->object.length));
      sprout_json_adopt(one, "serial", engine_number(e, (double)due->serial));
      sprout_json_adopt(one, "askedAt", engine_number(e, (double)due->asked_at));
      sprout_json_adopt(one, "dueAt", engine_number(e, (double)due->due_at));
      if (one->count != 4) break;
      sprout_json_adopt(list, NULL, one);
    }
    if (list->count == wakes.count) said = engine_answer_json(e, list);
  }
  sprout_wakes_free(&wakes);
  return said;
}

/*
 * Who hears what a visitor says to the people with them, the input holding the visit: `{"place", "to"}`, the place
 * they stand in and the visit of everyone directly in it, the speaker among them, in contents order; null where
 * they stand in no place, being away or displaced.
 */
EXPORT("sw_hearers") int sw_hearers(size_t visit_length) {
  wasm_engine *e = &the_engine;
  const sprout_str *ids;
  sprout_json *root, *to;
  sprout_str place;
  const char *visit;
  looking l;
  size_t i, count;
  int said = SPROUT_NO_MEMORY;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  visit = engine_input_string(e, 0, visit_length);
  if (visit == NULL) return engine_refuse(e, "Hand the visit in through sw_input first.");
  if (!look(e, visit, &l)) return SPROUT_NO_MEMORY;
  if (!place_of(&l, &place)) {
    done(&l);
    return engine_answer_json(e, engine_null(e));
  }
  root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 2);
  if (root != NULL && sprout_draft_children(&l.draft, place, &ids, &count) == SPROUT_DRAFT_OK &&
      (to = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, count)) != NULL) {
    for (i = 0; i < count; i++) {
      const sprout_stored_instance *one = sprout_draft_instance(&l.draft, ids[i]);
      const sprout_stored_visitor *person =
          one != NULL && one->made == SPROUT_MADE_VISITOR ? sprout_visitor_of(&l.draft, ids[i]) : NULL;
      if (person != NULL)
        sprout_json_adopt(to, NULL, engine_text(e, sprout_arena_copy(&e->scratch, person->visit.bytes, person->visit.length), person->visit.length));
    }
    sprout_json_adopt(root, "place", engine_text(e, sprout_arena_copy(&e->scratch, place.bytes, place.length), place.length));
    sprout_json_adopt(root, "to", to);
    if (root->count == 2) said = engine_answer_json(e, root);
  }
  done(&l);
  return said;
}

/* `id` named for the visitor of `l` as `{"id", "name"}`; NULL with `*eval` set where naming it faulted. */
static sprout_json *named(wasm_engine *e, looking *l, sprout_str id, sprout_eval_status *eval) {
  sprout_json *one = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 2);
  sprout_str words;
  if (one == NULL) return NULL;
  *eval = prose_object_words(&l->frame, id, l->visitor->instance, &words);
  if (*eval != SPROUT_EVAL_OK) return NULL;
  sprout_json_adopt(one, "id", engine_text(e, sprout_arena_copy(&e->scratch, id.bytes, id.length), id.length));
  sprout_json_adopt(one, "name", engine_text(e, sprout_arena_copy(&e->scratch, words.bytes, words.length), words.length));
  return one;
}

/*
 * Where a visitor stands and what is there, named for them, the input holding the visit: `{"place", "here"}`, the
 * place and the things it directly holds other than the visitor, people among them, in contents order, each
 * `{"id", "name"}`; null where they are away or their place is gone.
 */
EXPORT("sw_standing") int sw_standing(size_t visit_length) {
  wasm_engine *e = &the_engine;
  const sprout_stored_instance *person;
  const sprout_str *ids;
  sprout_json *root, *here;
  sprout_eval_status eval = SPROUT_EVAL_OK;
  const char *visit;
  looking l;
  size_t i, count, wanted = 0;
  int said = SPROUT_NO_MEMORY;
  engine_begin(e, 0);
  if (!engine_ready(e)) return engine_refuse(e, "Load a cartridge and open a state first.");
  visit = engine_input_string(e, 0, visit_length);
  if (visit == NULL) return engine_refuse(e, "Hand the visit in through sw_input first.");
  if (!look(e, visit, &l)) return SPROUT_NO_MEMORY;
  person = l.visitor == NULL ? NULL : sprout_draft_instance(&l.draft, l.visitor->instance);
  if (person == NULL || !person->has_container || sprout_draft_instance(&l.draft, person->container) == NULL) {
    done(&l);
    return engine_answer_json(e, engine_null(e));
  }
  root = sprout_json_make(&e->scratch, SPROUT_JSON_OBJECT, 2);
  if (root != NULL && sprout_draft_children(&l.draft, person->container, &ids, &count) == SPROUT_DRAFT_OK &&
      (here = sprout_json_make(&e->scratch, SPROUT_JSON_ARRAY, count)) != NULL) {
    sprout_json_adopt(root, "place", named(e, &l, person->container, &eval));
    for (i = 0; i < count && eval == SPROUT_EVAL_OK; i++) {
      if (sprout_str_same(ids[i], l.visitor->instance)) continue;
      wanted++;
      sprout_json_adopt(here, NULL, named(e, &l, ids[i], &eval));
    }
    sprout_json_adopt(root, "here", here);
    if (eval != SPROUT_EVAL_OK && eval != SPROUT_EVAL_NO_MEMORY)
      said = engine_answer_text(e, SPROUT_BAD_INPUT, l.fault.text[0] != '\0' ? l.fault.text : l.meter.fault.text);
    else if (eval == SPROUT_EVAL_OK && root->count == 2 && here->count == wanted)
      said = engine_answer_json(e, root);
  }
  done(&l);
  return said;
}
