/* The figures this app ships; see budgets.h. */
#include "budgets.h"

#include <stddef.h>

#include "text.h"
#include "world.h"

void player_budgets(sprout_budgets *b) {
  /* The spec's Runtime budgets table. */
  b->steps = (sprout_limit){true, 50000};
  b->poll_steps = (sprout_limit){true, 10000};
  b->output = (sprout_limit){true, 8000};
  b->events = (sprout_limit){true, 256};
  b->cascade_depth = (sprout_limit){true, 20};
  b->passage_depth = (sprout_limit){true, 8};
  b->set_role_objects = (sprout_limit){true, 8};
  b->spawns = (sprout_limit){true, 8};
  b->shortest_wake_seconds = (sprout_limit){true, 60};
  b->pending_wakes = (sprout_limit){true, 1};
  b->nickname_characters = (sprout_limit){true, 24};
  b->list_elements = (sprout_limit){true, 16};
  /* The rows the spec leaves to the host: one visitor stands in a world on a device, an extension
   * can draw nothing here, a turn that takes five seconds has failed, and the live instances are
   * bounded by 16 MB of RAM. */
  b->people_per_place = (sprout_limit){true, 1};
  b->extension_effects = (sprout_limit){true, 64};
  b->wall_clock_ms = (sprout_limit){true, 5000};
  b->instances = (sprout_limit){true, 1024};
}

/* One static cap: where the cartridge records it, the app's figure, and what it bounds, in the limit table's words. */
typedef struct cap_row {
  size_t offset;
  unsigned allowed;
  const char *bounds;
} cap_row;

/* The spec's Static caps table, in its order. The caps it leaves to the host are not listed. */
static const cap_row CAPS[] = {
    {offsetof(sprout_caps, options_per_enum), 100, "options on one enum"},
    {offsetof(sprout_caps, roles_per_verb), 8, "roles on one verb, counting a set role as one"},
    {offsetof(sprout_caps, phrases_per_verb), 8, "phrases on one verb or intent"},
    {offsetof(sprout_caps, steps_per_intent), 8, "steps in one intent"},
    {offsetof(sprout_caps, phrase_characters), 80, "characters in one phrase"},
    {offsetof(sprout_caps, nouns_per_object), 8, "nouns on one object"},
    {offsetof(sprout_caps, noun_characters), 40, "characters in one noun word"},
    {offsetof(sprout_caps, exits_per_place), 8, "exits on one place"},
    {offsetof(sprout_caps, list_elements), 16, "elements in one list"},
    {offsetof(sprout_caps, literal_characters), 600,
     "characters in a say, tell or text written as a literal"},
};

bool player_caps_fit(const sprout_world *world, char *words, size_t size) {
  text_buffer out;
  bool fits = true;
  size_t i;
  text_begin(&out, words, size);
  for (i = 0; i < sizeof CAPS / sizeof *CAPS; i++) {
    double recorded = *(const double *)((const char *)&world->caps + CAPS[i].offset);
    if (recorded <= (double)CAPS[i].allowed) continue;
    if (!fits) text_add(&out, " ");
    fits = false;
    text_add(&out, "This world was published allowing ");
    text_add_number(&out, (uint64_t)recorded);
    text_add(&out, " ");
    text_add(&out, CAPS[i].bounds);
    text_add(&out, ". This player allows ");
    text_add_number(&out, CAPS[i].allowed);
    text_add(&out, ", ");
    text_add_number(&out, (uint64_t)recorded - CAPS[i].allowed);
    text_add(&out, " fewer.");
  }
  if (!fits) text_add(&out, " Publish it again under this player's limits.");
  return fits;
}
