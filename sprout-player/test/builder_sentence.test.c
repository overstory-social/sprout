/*
 * The sentence builder's sentence (ui/builder.c, ui/sentence.c, ui/everything.c) driven through the
 * fake PlaydateAPI. The rules: the sentence so far is the picks joined, and B steps back to where the
 * disc was; a confirmed sentence runs and the reader is told it and then what the turn told, and one
 * whose save fails stops play and greys the world on the shelf. `everything` comes first on a level
 * whose role would read `all` where two or more things can be done, and takes what the view says a
 * typed `all` would: a set role binds them all, and a role that takes one thing runs a turn for each
 * in the level's order, leaving out what the view refuses, stopping at the first refusal and bounded
 * by what a set role may bind; such a line is one save, its state written once after its last step,
 * and a failure of that save stops play. A role a reading may leave out is offered by the word its
 * phrase puts before it beside "that's all", and its fillers once the word is picked.
 */
#include <stdlib.h>

#include "builder_support.h"
#include "session_internal.h"
#include "ui/message.h"
#include "ui/reader.h"
#include "ui/shelf.h"

static void descending_into_a_verb_and_back(void) {
  arrive("descend");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonUp, "ask", 1), "up from the first verb wraps to the last");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "ask") == 0, "the sentence so far: %s", phrase());
  /* `ask all` takes the guard alone, who plays `ask`, and one thing is no everything. */
  CHECK(strcmp(front(), "a hall") == 0, "what can be asked, in the view's order, and no everything: %s", front());
  CHECK(step_to(kButtonDown, "a guard", 1), "the guard is next");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "ask -> a guard") == 0, "%s", phrase());
  CHECK(strcmp(front(), "bridge") == 0, "the words the guard hears: %s", front());
  fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(phrase(), "ask") == 0 && strcmp(front(), "a guard") == 0, "B steps back to where the disc was: %s", front());
  fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(phrase(), "") == 0 && strcmp(front(), "ask") == 0, "and back to the verbs: %s", front());
  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader(), "and closed");
  leave();
}

static void a_completed_reading_runs_and_the_reader_is_told(void) {
  arrive("run");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonUp, "ask", 1), "ask");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a guard", 1), "the guard");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "weather", 2), "the weather");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "ask -> a guard -> weather") == 0, "the whole sentence to confirm: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the reader takes over");
  CHECK(shown_text("> ask -> a guard -> weather"), "the reader is told the sentence as typed");
  CHECK(shown_text("The guard nods."), "and what the turn told");

  /* A number role: the crank and up take it up, left and right by ten, held within its range. */
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "turn", 1), "turn");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a dial", 3), "the dial");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "0") == 0, "the notch starts at the least it takes: %s", front());
  fake_frame(fake, kButtonRight, 0);
  CHECK(strcmp(front(), "9") == 0, "ten more is past the end, so the end: %s", front());
  fake_frame(fake, kButtonLeft, 0);
  CHECK(strcmp(front(), "0") == 0, "and ten less the start: %s", front());
  fake_frame(fake, kButtonUp, 0);
  fake_frame(fake, 0, 48.0f);
  CHECK(strcmp(front(), "3") == 0, "up and two steps of crank: %s", front());
  fake_frame(fake, kButtonDown, 0);
  fake_frame(fake, kButtonUp, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "turn -> a dial -> 3") == 0, "%s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> turn -> a dial -> 3") && shown_text("Click."), "the dial turned");

  /* A set role, joined from the things the view offers one at a time. */
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "juggle", 0), "juggle");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a pebble", 4), "the pebble");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "juggle -> a pebble") == 0, "%s", phrase());
  CHECK(step_to(kButtonDown, "and a shell", 5), "the others are offered: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "juggle -> a pebble, a shell") == 0, "%s", phrase());
  CHECK(!step_to(kButtonDown, "and a shell", 5), "a thing joins once");
  CHECK(step_to(kButtonDown, "that's all", 5), "that's all");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "juggle -> a pebble, a shell") == 0, "%s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> juggle -> a pebble, a shell"), "the set juggled");
  leave();
}

static void a_turn_whose_save_fails_stops_play_and_greys_the_world(void) {
  const fake_run *said;
  arrive("unsaved");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonUp, "ask", 1), "ask");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a guard", 1), "the guard");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "weather", 2), "the weather");
  fake_frame(fake, kButtonA, 0);
  fake->fail_writes = 1;
  fake_frame(fake, kButtonA, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(app->screen == &player_message_screen && said != NULL && HAS(said->text, "The save could not be written"),
        "play stops on the message screen: %s", said != NULL ? said->text : "(nothing)");
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_shelf_screen, "A goes back to the shelf");
  CHECK(player_shelf_blocked(app->shelf, "worlds/chip-tree.sproutworld"), "the world is greyed there");
  fake->fail_writes = 0;
  leave();
}

/* ---- everything ---- */

static sentence *built(void) { return &((player_builder *)app->ctx)->sentence; }

/* Whether the disc's first entry is `everything`. */
static bool everything_first(void) {
  size_t count;
  const sentence_entry *entries = sentence_entries(built(), &count);
  return entries[0].kind == SENTENCE_ENTRY_EVERYTHING && strcmp(entries[0].label, "everything") == 0;
}

/* Whether any entry on the disc is `everything`. */
static bool everything_offered(void) {
  size_t count, i;
  const sentence_entry *entries = sentence_entries(built(), &count);
  for (i = 0; i < count; i++)
    if (entries[i].kind == SENTENCE_ENTRY_EVERYTHING) return true;
  return false;
}

/* The reader's transcript, every line of every paragraph oldest first, joined by spaces. */
static const char *told_so_far(void) {
  static char all[32768];
  const transcript *t = &((player_reader *)app->ctx)->lines;
  size_t at = 0, i, k;
  all[0] = '\0';
  for (i = 0; i < t->count; i++) {
    const wrapped *paragraph = &t->paragraphs[(t->first + i) % TRANSCRIPT_KEEP];
    const char *line = paragraph->bytes;
    for (k = 0; k < paragraph->line_count; k++, line = wrap_next(line))
      at += (size_t)snprintf(all + at, sizeof all - at, "%s ", line);
  }
  return all;
}

/* Whether `texts` are each in `whole`, in order. */
static bool in_order(const char *whole, const char *const *texts, size_t count) {
  size_t i;
  for (i = 0; i < count; i++) {
    const char *found = strstr(whole, texts[i]);
    if (found == NULL) return false;
    whole = found + strlen(texts[i]);
  }
  return true;
}

/* How many lines of the fake's file log write a file whose path holds `part`. */
static int writes_of(const char *part) {
  const char *line = fake->file_log;
  int count = 0;
  for (; *line != '\0'; line = strchr(line, '\n') + 1) {
    const char *end = strchr(line, '\n');
    const char *found = strstr(line, part);
    if (strncmp(line, "write ", 6) == 0 && found != NULL && found < end) count++;
  }
  return count;
}

/* Runs frames until the save owed is written; whether it was. */
static bool saved_out(void) {
  int n;
  for (n = 0; n < 10000 && player_saving(app->session); n++) fake_frame(fake, 0, 0);
  return !player_saving(app->session);
}

static void everything_for_a_role_that_takes_one_thing_runs_a_turn_each_and_stops_at_a_refusal(void) {
  static const char *const turns[] = {"> examine -> an apple", "A red apple.", "> examine -> a bell", "A brass bell.",
                                      "> examine -> a lamp", "Too bright to look at."};
  size_t logged, i, alike = 0;
  const char *whole;
  arrive_in("each", "all-in-order.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first() && strcmp(front(), "everything") == 0, "everything comes first, at the front: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "examine -> everything") == 0, "the sentence so far says everything: %s", phrase());
  CHECK(strcmp(front(), "examine -> everything") == 0, "and is the sentence to confirm: %s", front());
  CHECK(sentence_each_count(built()) == 5, "a turn for each thing but the place: %zu", sentence_each_count(built()));
  logged = app->session->log_count;
  CHECK(player_save_settle(app->session).ok, "nothing is owed before the line");
  fake->file_log[0] = '\0';
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "the reader takes over");
  CHECK(writes_of(".json.part") == 0, "no step of the line writes the state:\n%s", fake->file_log);
  CHECK(saved_out() && writes_of(".json.part") == 1, "the line stopped at a refusal writes it once, after:\n%s",
        fake->file_log);
  whole = told_so_far();
  /* The bell's glint dazzles the lamp after the line was read, so the lamp refuses on its turn and the line stops. */
  CHECK(in_order(whole, turns, sizeof turns / sizeof turns[0]), "each turn told as its own sentence, in the walk's order: %s", whole);
  CHECK(strstr(whole, "a mirror") == NULL && strstr(whole, "a pear") == NULL, "nothing after the refusal runs: %s", whole);
  CHECK(app->session->log_count == logged + 3, "three turns are logged: %zu", app->session->log_count - logged);
  for (i = logged; i < app->session->log_count; i++) alike += strstr(app->session->log[i], "\"text\":\"examine -> everything\"") != NULL;
  CHECK(alike == 3, "each under the whole sentence, as a line of `all` logs each turn under the line typed: %zu", alike);
  leave();
}

/* The examine of the sack, the ball and the lunch, run as one line in the left-out world's hall. */
static void examine_everything(void) {
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(sentence_each_count(built()) == 3, "three things: %zu", sentence_each_count(built()));
  CHECK(player_save_settle(app->session).ok, "nothing is owed before the line");
  fake->file_log[0] = '\0';
  fake_frame(fake, kButtonA, 0);
}

/* One input is one save: a line's steps append the log tail each, and the state is written once, after the last. */
static void a_line_of_turns_writes_the_state_once(void) {
  static const char *const turns[] = {"> examine -> a sack", "> examine -> a ball", "> examine -> a lunch"};
  arrive_in("one save", "all-leaves-out-refused.sproutworld");
  examine_everything();
  CHECK(on_reader() && in_order(told_so_far(), turns, 3), "every step ran: %s", told_so_far());
  CHECK(writes_of(".log") == 3, "the log tail is written at each step:\n%s", fake->file_log);
  CHECK(writes_of(".json.part") == 0 && player_saving(app->session), "and the state is owed, not written:\n%s",
        fake->file_log);
  CHECK(saved_out() && writes_of(".json.part") == 1, "then written once:\n%s", fake->file_log);
  leave();
}

/* The save a line owes failing stops play, as a single turn's does. */
static void a_line_whose_save_fails_stops_play(void) {
  const fake_run *said;
  arrive_in("line unsaved", "all-leaves-out-refused.sproutworld");
  examine_everything();
  CHECK(on_reader() && player_saving(app->session), "the line ran and owes its state");
  fake->fail_writes = 1;
  fake_frame(fake, 0, 0);
  said = fake_run_at(fake, PLAYER_MARGIN, MESSAGE_TOP);
  CHECK(app->screen == &player_message_screen && said != NULL && HAS(said->text, "The save could not be written"),
        "play stops on the message screen: %s", said != NULL ? said->text : "(nothing)");
  fake_frame(fake, kButtonA, 0);
  CHECK(app->screen == &player_shelf_screen && player_shelf_blocked(app->shelf, "worlds/all-leaves-out-refused.sproutworld"),
        "and the world is greyed on the shelf");
  fake->fail_writes = 0;
  leave();
}

static void everything_for_a_set_role_binds_them_all(void) {
  const sentence_state *state;
  arrive("set");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "juggle", 0), "juggle");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  state = &built()->state;
  CHECK(strcmp(phrase(), "juggle -> everything") == 0, "the sentence so far says everything: %s", phrase());
  /* The hall is the place and the guard someone here: the dial, the pebble and the shell. */
  CHECK(state->pick_count == 1 && state->picks[0].everything && state->picks[0].count == 3 &&
            strcmp(state->joined[0]->name.bytes, "a dial") == 0 && strcmp(state->joined[2]->name.bytes, "a shell") == 0,
        "the set role binds every thing it takes at once: %zu", state->picks[0].count);
  CHECK(sentence_each_count(built()) == 0, "and is one turn");
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> juggle -> everything"), "run as the one sentence");
  leave();
}

/* The kitchen of `all-plays-a-part`: the table holds the sack and the bottle, and only those two play `pack`. */
static void everything_takes_what_the_view_says_all_takes(void) {
  const sentence_state *state;
  size_t k;
  arrive_in("plays a part", "all-plays-a-part.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "pack", 20), "pack");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  state = &built()->state;
  CHECK(state->pick_count == 1 && state->picks[0].everything && state->picks[0].count == 2,
        "the sack and the bottle, which `pack all` takes: %zu", state->picks[0].count);
  for (k = 0; k < state->picks[0].count; k++)
    CHECK(strcmp(state->joined[k]->name.bytes, "a table") != 0 && strcmp(state->joined[k]->name.bytes, "a kitchen") != 0,
          "and not the table they are on, nor the kitchen: %s", state->joined[k]->name.bytes);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("You pack 2 at once."), "packed as `pack all` packs them");
  leave();
}

static void everything_leaves_out_what_is_greyed_and_needs_two_things(void) {
  arrive_in("left out", "all-leaves-out-refused.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "examine", 20), "examine");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(sentence_each_count(built()) == 3, "the sack, the lunch and the ball, the lamp's refusal left out: %zu",
        sentence_each_count(built()));
  {
    size_t k;
    for (k = 0; k < sentence_each_count(built()); k++)
      CHECK(strcmp(built()->each[k]->thing.name.bytes, "a lamp") != 0, "the greyed lamp is not among them");
  }
  fake_frame(fake, kButtonB, 0);
  fake_frame(fake, kButtonB, 0);
  CHECK(step_to(kButtonDown, "drop", 20), "drop");
  fake_frame(fake, kButtonA, 0);
  CHECK(!everything_offered(), "nothing is held, so nothing can be dropped and nothing is everything");
  fake_frame(fake, kButtonB, 0);
  CHECK(step_to(kButtonDown, "take", 20), "take");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a ball", 5), "a ball");
  fake_frame(fake, kButtonA, 0);
  while (strcmp(front(), "take -> a ball") != 0 && !on_reader() && step_to(kButtonDown, "that's all", 5)) fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> take -> a ball"), "the ball taken");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "drop", 20), "drop");
  fake_frame(fake, kButtonA, 0);
  CHECK(!everything_offered(), "only the ball can be dropped: one thing is no everything");
  leave();
}

static void everything_runs_at_most_what_a_set_role_may_bind(void) {
  arrive_in("bound", "all-leaves-out-refused.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "go", 20), "go");
  fake_frame(fake, kButtonA, 0);
  CHECK(!everything_offered(), "a way out is no thing");
  CHECK(step_to(kButtonDown, "down", 5), "down");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader(), "gone down");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "take", 20), "take");
  fake_frame(fake, kButtonA, 0);
  CHECK(everything_first(), "everything comes first: %s", front());
  fake_frame(fake, kButtonA, 0);
  while (strcmp(front(), "take -> everything") != 0 && step_to(kButtonDown, "that's all", 5)) fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "take -> everything") == 0, "the sentence: %s", front());
  CHECK(sentence_each_count(built()) == 8, "nine marbles, and a set role binds eight: %zu", sentence_each_count(built()));
  leave();
}

/* The kinds of the entries on the disc, as one string of initials: v, f, r (a role's word), m, e, d, o, n, -, c. */
static const char *kinds(void) {
  static char out[64];
  static const char initials[] = "vfrmedon-c";
  size_t count, i;
  const sentence_entry *entries = sentence_entries(built(), &count);
  for (i = 0; i < count && i < sizeof out - 1; i++) out[i] = initials[entries[i].kind];
  out[i] = '\0';
  return out;
}

/* The kitchen of `role-by-its-word`: `hang [target] on [hook]` leaves the hook out of `hang [target]`, and the library's `take` its source. */
static void a_role_a_reading_may_leave_out_is_offered_by_its_word_and_then_its_fillers(void) {
  arrive_in("role word", "role-by-its-word.sproutworld");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "hang", 20), "hang");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a sack", 5), "a sack");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "on") == 0 && strcmp(kinds(), "rd") == 0, "the hook's word, then that's all: %s, %s", front(), kinds());
  CHECK(strcmp(phrase(), "hang -> a sack") == 0, "%s", phrase());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "a hook") == 0 && strcmp(kinds(), "f") == 0, "the word opens the hooks alone: %s, %s", front(), kinds());
  CHECK(strcmp(phrase(), "hang -> a sack -> on") == 0, "the word picked, nothing under it yet: %s", phrase());
  fake_frame(fake, kButtonB, 0);
  CHECK(strcmp(front(), "on") == 0 && strcmp(kinds(), "rd") == 0, "B steps back to the word: %s", front());
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "hang -> a sack -> on a hook") == 0, "the sentence shows the word before the pick: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> hang -> a sack -> on a hook") && shown_text("You hang a sack on a hook."),
        "the finished reading binds the hook");
  /* That's all leaves the role out. */
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "hang", 20), "hang");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a sack", 5), "a sack");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "that's all", 2), "that's all");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "hang -> a sack") == 0, "%s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(on_reader() && shown_text("> hang -> a sack") && shown_text("You hang a sack up."), "the hook left out");
  /* The library's take: its source by the phrase's `from`. */
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "take", 20), "take");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a sack", 5), "a sack");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "from") == 0 && strcmp(kinds(), "rd") == 0, "from, then that's all: %s, %s", front(), kinds());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "a table") == 0, "the table it is on: %s", front());
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(front(), "take -> a sack -> from a table") == 0, "%s", front());
  leave();
}

int main(void) {
  test_program("builder_sentence");
  descending_into_a_verb_and_back();
  a_completed_reading_runs_and_the_reader_is_told();
  a_turn_whose_save_fails_stops_play_and_greys_the_world();
  everything_for_a_role_that_takes_one_thing_runs_a_turn_each_and_stops_at_a_refusal();
  a_line_of_turns_writes_the_state_once();
  a_line_whose_save_fails_stops_play();
  everything_for_a_set_role_binds_them_all();
  everything_takes_what_the_view_says_all_takes();
  everything_leaves_out_what_is_greyed_and_needs_two_things();
  everything_runs_at_most_what_a_set_role_may_bind();
  a_role_a_reading_may_leave_out_is_offered_by_its_word_and_then_its_fillers();
  return finish();
}
