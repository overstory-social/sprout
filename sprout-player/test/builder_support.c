/* What the sentence builder's test programs share; see builder_support.h. */
#include "builder_support.h"

#include "session_internal.h"
#include "ui/nickname.h"

static const char READER_KEYS[] = "A: build a sentence   crank: scroll back";

player_app *app;

const fake_run *panel(void) { return fake_run_at(fake, PLAYER_MARGIN, BOTTOM + 2); }

bool on_reader(void) {
  const fake_run *keys = fake_run_at(fake, PLAYER_MARGIN, READER_PANEL + 2);
  return keys != NULL && strcmp(keys->text, READER_KEYS) == 0;
}

bool keys_shown(void) { return panel() != NULL && strcmp(panel()->text, BUILDER_KEYS) == 0; }

player_builder *builder(void) { return app != NULL && app->screen == &player_builder_screen ? (player_builder *)app->ctx : NULL; }

const wheel_label *label_placed(int n) { return builder() != NULL ? wheel_placed(&builder()->wheel, n) : NULL; }

size_t entry_of(const wheel_label *label) { return (size_t)(label - builder()->wheel.labels); }

const fake_run *label_run(const wheel_label *label) { return wheel_label_run(label); }

const char *label_text(const wheel_label *label) { return wheel_label_text(label); }

int front_placed(void) { return wheel_front_placed(); }

const char *front(void) {
  int n = front_placed();
  return n >= 0 ? label_text(label_placed(n)) : "(no front)";
}

int placed_entry(size_t index) { return builder() != NULL ? wheel_placed_entry(&builder()->wheel, index) : -1; }

const char *phrase(void) {
  const fake_run *run = fake_run_at(fake, PLAYER_MARGIN, 0);
  return run != NULL ? run->text : "(no line)";
}

void arrive_in(const char *scenario, const char *world) {
  const char *const shipped[] = {world};
  const char *why = NULL;
  int n;
  begin(scenario);
  app_folder("app");
  ship(shipped, 1);
  app = player_app_new(&fake->api, &why);
  CHECK(app != NULL, "%s", why);
  fake->api.system->setUpdateCallback(player_app_update, app);
  fake_frame(fake, 0, 0);
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < 10000 && !on_reader(); n++) fake_frame(fake, app->screen == &player_nickname_screen ? kButtonA : 0, 0);
  CHECK(on_reader(), "the reader came up");
}

void arrive(const char *scenario) { arrive_in(scenario, "chip-tree.sproutworld"); }

void leave(void) {
  player_app_free(app);
  app = NULL;
  CHECK(fake->made_live == 0, "no label is held once the app ends: %d", fake->made_live);
  end();
}

bool step_to(PDButtons button, const char *label, int most) {
  int n;
  for (n = 0; n <= most; n++) {
    if (strcmp(front(), label) == 0) return true;
    fake_frame(fake, button, 0);
  }
  return strcmp(front(), label) == 0;
}

size_t verbs_asked(const player_session *s) {
  size_t v, asked = 0;
  for (v = 0; v < s->chips.verb_count; v++) asked += s->fetched[v];
  return asked;
}

bool shown_text(const char *text) {
  int i;
  for (i = 0; i < fake->run_count; i++)
    if (HAS(fake->runs[i].text, text)) return true;
  return false;
}
