/*
 * The cross-checks of a stored world (the spec's The runtime > State): what
 * the stored form's schema holds beyond the shape of each record. Ids are
 * looked up through sorted indexes built in a scratch arena, so a world of
 * thousands of instances is checked in n log n. The first problem found, in
 * the order of the stored records, is the one said.
 */
#include <string.h>

#include "state.h"

typedef struct checker {
  sprout_state *state;
  sprout_refusal *refusal;
  sprout_arena scratch;
  char path[96];
  char what[320];
} checker;

#define PASS(expr)                        \
  do {                                    \
    sprout_status pass_ = (expr);         \
    if (pass_ != SPROUT_OK) return pass_; \
  } while (0)

static void put_number(char *out, uint64_t n) {
  char reversed[24];
  size_t count = 0, i;
  do {
    reversed[count++] = (char)('0' + n % 10);
    n /= 10;
  } while (n > 0);
  for (i = 0; i < count; i++) out[i] = reversed[count - 1 - i];
  out[count] = '\0';
}

/* "name[i]field" into the checker's path. */
static void at(checker *c, const char *name, size_t i, const char *field) {
  char digits[24];
  size_t used, a = strlen(name), b, d = field == NULL ? 0 : strlen(field);
  put_number(digits, i);
  b = strlen(digits);
  if (a + b + d + 3 >= sizeof c->path) {
    c->path[0] = '\0';
    return;
  }
  memcpy(c->path, name, a);
  used = a;
  c->path[used++] = '[';
  memcpy(c->path + used, digits, b);
  used += b;
  c->path[used++] = ']';
  if (d > 0) memcpy(c->path + used, field, d);
  used += d;
  c->path[used] = '\0';
}

/* Joins the pieces into the checker's sentence and refuses with it. */
static sprout_status say(checker *c, const char *const *parts, size_t count) {
  size_t used = 0, i;
  for (i = 0; i < count; i++) {
    size_t n = parts[i] == NULL ? 0 : strlen(parts[i]);
    if (used + n + 1 > sizeof c->what) n = sizeof c->what - 1 - used;
    memcpy(c->what + used, parts[i], n);
    used += n;
  }
  c->what[used] = '\0';
  return sprout_stored_refuse(c->refusal, c->path, c->what, NULL, NULL);
}

/* "`id` <words>" */
static sprout_status about(checker *c, sprout_str id, const char *words) {
  const char *parts[3];
  parts[0] = "`";
  parts[1] = id.bytes;
  parts[2] = words;
  return say(c, parts, 3);
}

/* ---- sorted indexes of strings ---- */

typedef struct index {
  size_t count;
  const sprout_str **sorted; /* stable: equal strings stay in stored order */
  const char *first;         /* the first stored string, to turn a pointer back into a position */
  size_t stride;             /* bytes between the stored strings */
} index;

static void sort_pointers(const sprout_str **a, const sprout_str **tmp, size_t n) {
  size_t width, i;
  for (width = 1; width < n; width *= 2) {
    for (i = 0; i < n; i += 2 * width) {
      size_t mid = i + width < n ? i + width : n;
      size_t right = i + 2 * width < n ? i + 2 * width : n;
      size_t l = i, r = mid, k = i;
      while (l < mid && r < right) tmp[k++] = sprout_str_compare(*a[l], *a[r]) <= 0 ? a[l++] : a[r++];
      while (l < mid) tmp[k++] = a[l++];
      while (r < right) tmp[k++] = a[r++];
    }
    memcpy(a, tmp, n * sizeof *a);
  }
}

/* An index over `count` strings that sit `stride` bytes apart from `first`. */
static sprout_status build(checker *c, index *out, size_t count, const sprout_str *first,
                           size_t stride) {
  const sprout_str **tmp;
  size_t i;
  out->count = count;
  out->first = (const char *)first;
  out->stride = stride;
  out->sorted = (const sprout_str **)sprout_arena_take(&c->scratch, (count + 1) * sizeof(sprout_str *));
  tmp = (const sprout_str **)sprout_arena_take(&c->scratch, (count + 1) * sizeof(sprout_str *));
  if (out->sorted == NULL || tmp == NULL) return SPROUT_NO_MEMORY;
  for (i = 0; i < count; i++) out->sorted[i] = (const sprout_str *)(out->first + i * stride);
  sort_pointers(out->sorted, tmp, count);
  return SPROUT_OK;
}

static size_t position(const index *idx, const sprout_str *one) {
  return (size_t)((const char *)one - idx->first) / idx->stride;
}

/* The stored position of the first string equal to `key`, or (size_t)-1. */
static size_t find(const index *idx, sprout_str key) {
  size_t lo = 0, hi = idx->count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    int order = sprout_str_compare(*idx->sorted[mid], key);
    if (order == 0) {
      while (mid > 0 && sprout_str_compare(*idx->sorted[mid - 1], key) == 0) mid--;
      return position(idx, idx->sorted[mid]);
    }
    if (order < 0) lo = mid + 1;
    else hi = mid;
  }
  return (size_t)-1;
}

/* The earliest stored position that repeats an earlier string, or (size_t)-1. */
static size_t first_repeat(const index *idx) {
  size_t best = (size_t)-1, i;
  for (i = 1; i < idx->count; i++)
    if (sprout_str_same(*idx->sorted[i - 1], *idx->sorted[i])) {
      size_t later = position(idx, idx->sorted[i]);
      if (later < best) best = later;
    }
  return best;
}

/* ---- the checks ---- */

static const char *form_name(sprout_id_form form) {
  return form == SPROUT_ID_WORLD ? "world" : form == SPROUT_ID_DECLARED ? "declared" : "minted";
}

static const char *made_name(sprout_made_from made) {
  switch (made) {
    case SPROUT_MADE_WORLD:
      return "world";
    case SPROUT_MADE_DECLARED:
      return "declared";
    case SPROUT_MADE_VISITOR:
      return "visitor";
    case SPROUT_MADE_SPAWNED:
      return "spawned";
    case SPROUT_MADE_GIVEN:
      return "given";
  }
  return "";
}

static sprout_id_form form_wanted(sprout_made_from made) {
  if (made == SPROUT_MADE_WORLD) return SPROUT_ID_WORLD;
  if (made == SPROUT_MADE_DECLARED) return SPROUT_ID_DECLARED;
  return SPROUT_ID_MINTED;
}

/* An id of this world, minted no later than the world's serial. */
static sprout_status an_id(checker *c, sprout_str id) {
  sprout_id_form form = sprout_id_form_of(c->state->world, id);
  if (form == SPROUT_ID_NONE) {
    const char *parts[5];
    parts[0] = "`";
    parts[1] = id.bytes;
    parts[2] = "` is not an id in ";
    parts[3] = c->state->world.bytes;
    parts[4] = ".";
    return say(c, parts, 5);
  }
  if (form == SPROUT_ID_MINTED) {
    const char *digits = id.bytes + c->state->world.length + 1;
    uint64_t n = 0;
    size_t i;
    for (i = 0; digits[i] != '\0' && n <= ((uint64_t)1 << 53); i++)
      n = n * 10 + (uint64_t)(digits[i] - '0');
    if (n > c->state->serial) {
      char serial[24];
      const char *parts[7];
      put_number(serial, c->state->serial);
      parts[0] = "`";
      parts[1] = id.bytes;
      parts[2] = "` was minted past the world's serial, ";
      parts[3] = c->state->world.bytes;
      parts[4] = "#";
      parts[5] = serial;
      parts[6] = ".";
      return say(c, parts, 7);
    }
  }
  return SPROUT_OK;
}

static sprout_status issued(checker *c, uint64_t n) {
  char number[24], serial[24];
  const char *parts[5];
  if (n <= c->state->serial) return SPROUT_OK;
  put_number(number, n);
  put_number(serial, c->state->serial);
  parts[0] = "serial ";
  parts[1] = number;
  parts[2] = " is past the world's serial, ";
  parts[3] = serial;
  parts[4] = ".";
  return say(c, parts, 5);
}

static sprout_status check_instance(checker *c, size_t i) {
  const sprout_stored_instance *in = &c->state->instances[i];
  sprout_id_form form = sprout_id_form_of(c->state->world, in->id);
  size_t k;
  at(c, "instances", i, ".id");
  PASS(an_id(c, in->id));
  if (form != form_wanted(in->made)) {
    const char *parts[9];
    at(c, "instances", i, ".made");
    parts[0] = "`";
    parts[1] = in->id.bytes;
    parts[2] = "` is a ";
    parts[3] = form_name(form);
    parts[4] = " id, and made from ";
    parts[5] = made_name(in->made);
    parts[6] = " takes a ";
    parts[7] = form_name(form_wanted(in->made));
    parts[8] = " one.";
    return say(c, parts, 9);
  }
  if (in->has_container) {
    at(c, "instances", i, ".container");
    PASS(an_id(c, in->container));
  }
  if (in->has_arrival) {
    at(c, "instances", i, ".arrival");
    PASS(issued(c, in->arrival));
  }
  at(c, "instances", i, ".links");
  for (k = 0; k < in->link_count; k++) PASS(an_id(c, in->links[k].to));
  at(c, "instances", i, ".wakes");
  for (k = 0; k < in->wake_count; k++) PASS(issued(c, in->wakes[k].serial));
  at(c, "instances", i, ".memory");
  for (k = 0; k < in->memory_count; k++) PASS(an_id(c, in->memory[k].actor));
  return SPROUT_OK;
}

static sprout_status check_bound(checker *c, size_t v, const sprout_stored_bound *bound) {
  size_t i;
  at(c, "visitors", v, ".lastReading.bindings");
  if (bound->kind == SPROUT_BOUND_OBJECT) PASS(an_id(c, bound->object));
  if (bound->kind == SPROUT_BOUND_SET)
    for (i = 0; i < bound->set_count; i++) PASS(an_id(c, bound->set[i]));
  if (bound->kind == SPROUT_BOUND_EXIT) PASS(an_id(c, bound->to));
  return SPROUT_OK;
}

static sprout_status check_visitor(checker *c, size_t v, const index *ids) {
  const sprout_stored_visitor *visitor = &c->state->visitors[v];
  size_t k, found;
  at(c, "visitors", v, ".instance");
  PASS(an_id(c, visitor->instance));
  found = find(ids, visitor->instance);
  if (found == (size_t)-1) return about(c, visitor->instance, "` is not a stored instance.");
  if (c->state->instances[found].made != SPROUT_MADE_VISITOR) {
    const char *parts[5];
    parts[0] = "`";
    parts[1] = visitor->instance.bytes;
    parts[2] = "` is made from ";
    parts[3] = made_name(c->state->instances[found].made);
    parts[4] = ", and a visitor's instance is made from visitor.";
    return say(c, parts, 5);
  }
  if (visitor->has_last_place) {
    at(c, "visitors", v, ".lastPlace");
    PASS(an_id(c, visitor->last_place));
  }
  at(c, "visitors", v, ".referents");
  for (k = 0; k < visitor->referent_count; k++) PASS(an_id(c, visitor->referents[k]));
  if (visitor->has_reading)
    for (k = 0; k < visitor->reading.binding_count; k++)
      PASS(check_bound(c, v, &visitor->reading.bindings[k].bound));
  return SPROUT_OK;
}

static sprout_status check_tombstones(checker *c, const index *tombs) {
  sprout_state *s = c->state;
  size_t i, repeat = first_repeat(tombs);
  for (i = 0; i < s->tombstone_count; i++) {
    at(c, "tombstones", i, NULL);
    if (sprout_id_form_of(s->world, s->tombstones[i]) != SPROUT_ID_DECLARED) {
      const char *parts[5];
      parts[0] = "`";
      parts[1] = s->tombstones[i].bytes;
      parts[2] = "` is not a declared object's id in ";
      parts[3] = s->world.bytes;
      parts[4] = ".";
      return say(c, parts, 5);
    }
    if (repeat == i) return about(c, s->tombstones[i], "` is a tombstone twice.");
  }
  for (i = 0; i < s->instance_count; i++) {
    const sprout_stored_instance *in = &s->instances[i];
    if (find(tombs, in->id) != (size_t)-1) {
      at(c, "instances", i, ".id");
      return about(c, in->id, "` was destroyed, and is stored again.");
    }
    if (in->has_container && find(tombs, in->container) != (size_t)-1) {
      const char *parts[5];
      at(c, "instances", i, ".container");
      parts[0] = "`";
      parts[1] = in->id.bytes;
      parts[2] = "` is inside `";
      parts[3] = in->container.bytes;
      parts[4] = "`, which was destroyed.";
      return say(c, parts, 5);
    }
  }
  return SPROUT_OK;
}

static sprout_status check_with(checker *c) {
  sprout_state *s = c->state;
  index ids, visits, named, tombs;
  size_t i, repeat_id, repeat_visit, repeat_named;
  sprout_stored_instance no_instance;
  sprout_stored_visitor no_visitor;
  sprout_str no_tombstone;
  memset(&no_instance, 0, sizeof no_instance);
  memset(&no_visitor, 0, sizeof no_visitor);
  memset(&no_tombstone, 0, sizeof no_tombstone);
  PASS(build(c, &ids, s->instance_count, s->instance_count ? &s->instances[0].id : &no_instance.id,
             sizeof(sprout_stored_instance)));
  PASS(build(c, &visits, s->visitor_count, s->visitor_count ? &s->visitors[0].visit : &no_visitor.visit,
             sizeof(sprout_stored_visitor)));
  PASS(build(c, &named, s->visitor_count,
             s->visitor_count ? &s->visitors[0].instance : &no_visitor.instance, sizeof(sprout_stored_visitor)));
  PASS(build(c, &tombs, s->tombstone_count, s->tombstone_count ? &s->tombstones[0] : &no_tombstone,
             sizeof(sprout_str)));
  repeat_id = first_repeat(&ids);
  repeat_visit = first_repeat(&visits);
  repeat_named = first_repeat(&named);

  for (i = 0; i < s->instance_count; i++) {
    PASS(check_instance(c, i));
    if (repeat_id == i) {
      at(c, "instances", i, ".id");
      return about(c, s->instances[i].id, "` is stored twice.");
    }
  }
  for (i = 0; i < s->visitor_count; i++) {
    if (repeat_visit == i) {
      const char *parts[3];
      at(c, "visitors", i, ".visit");
      parts[0] = "visit `";
      parts[1] = s->visitors[i].visit.bytes;
      parts[2] = "` is stored twice.";
      return say(c, parts, 3);
    }
    PASS(check_visitor(c, i, &ids));
    if (repeat_named == i) {
      at(c, "visitors", i, ".instance");
      return about(c, s->visitors[i].instance, "` is named by two visitors.");
    }
  }
  PASS(check_tombstones(c, &tombs));
  for (i = 0; i < s->instance_count; i++) {
    if (s->instances[i].made != SPROUT_MADE_VISITOR) continue;
    if (find(&named, s->instances[i].id) == (size_t)-1) {
      at(c, "instances", i, ".made");
      return about(c, s->instances[i].id, "` is made from visitor, and no visitor is stored for it.");
    }
  }
  return SPROUT_OK;
}

sprout_status sprout_state_check(const sprout_state *state, sprout_refusal *refusal) {
  checker c;
  sprout_status status;
  memset(&c, 0, sizeof c);
  c.state = (sprout_state *)state;
  c.refusal = refusal;
  status = sprout_arena_init(&c.scratch, &state->host);
  if (status != SPROUT_OK) return status;
  status = check_with(&c);
  sprout_arena_reset(&c.scratch);
  return status;
}
