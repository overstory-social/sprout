/*
 * The sentence builder's disc (ui/builder.c, ui/disc.c) as drawn, driven through the fake PlaydateAPI
 * in the chip_tree world's hall. The rules: each word on the disc is a label drawn once into a bitmap
 * in the big font and placed along its ray; the front is the selected entry, the only label drawn
 * inverted, level at the hub's height at rest, its neighbours a sector either side in the entries'
 * order, each entry placed once, and the crank's fraction turns every word alike, through the detent; the dividing rays
 * are drawn only where a word sits; the labels are let go with the builder; the root lists the
 * scene's verbs in the view's order; a greyed chip is drawn greyed (at the front, a dotted inverted
 * label) and its reason is the panel's words; the sentence line fits the screen whatever its length,
 * keeping its end in view, while a long word on the disc is cut at the screen's edge.
 */
#include "builder_support.h"

/* Whether a ray at `angle` is drawn: a black pixel at, or a pixel from, where its bent line passes 100 pixels from the hub. */
static bool ray_at(float angle) {
  int x, y, dx, dy;
  disc_point(disc_bent(angle, 100.0f), 100.0f, &x, &y);
  for (dy = -1; dy <= 1; dy++)
    for (dx = -1; dx <= 1; dx++)
      if (fake_pixel(fake, DISC_HUB_X + x + dx, CENTRE + y + dy)) return true;
  return false;
}

/* A verb's name without its library, as the disc shows it. */
static const char *bare(const char *verb) {
  const char *dot = strrchr(verb, '.');
  return dot != NULL ? dot + 1 : verb;
}

static void the_root_is_the_scenes_verbs_on_a_disc_turned_by_the_crank(void) {
  static char verbs[32][64];
  player_chip_level root;
  size_t count, i;
  int n, front_at;
  float rest_angle[32], turn;
  arrive("root");
  fake_frame(fake, kButtonA, 0);
  CHECK(!on_reader() && keys_shown(), "A opens the builder, its keys below the disc");
  CHECK(strcmp(phrase(), "") == 0, "nothing is built yet: %s", phrase());
  root = player_chips(app->session, NULL, 0);
  CHECK(root.ok && root.choice_count >= 12, "the scene's verbs");
  count = root.choice_count < 32 ? root.choice_count : 32;
  for (i = 0; i < count; i++) snprintf(verbs[i], sizeof verbs[0], "%s", bare(root.choices[i].verb));
  CHECK(strcmp(verbs[0], "juggle") == 0 && strcmp(verbs[11], "ask") == 0, "the chip_tree hall's verbs: %s ... %s", verbs[0], verbs[11]);

  /* The front is the first verb, the one label drawn inverted, unturned and level with the hub, its word from where words start. */
  front_at = front_placed();
  CHECK(strcmp(front(), verbs[0]) == 0, "the front is %s, the first verb: %s", verbs[0], front());
  CHECK(front_at >= 0 && fake->placed[front_at].x == FRONT_X && fake->placed[front_at].y == FRONT_Y &&
            fake->made[fake->placed[front_at].made].height == LABEL_HEIGHT,
        "level at the front: %d %d", front_at >= 0 ? fake->placed[front_at].x : -1, front_at >= 0 ? fake->placed[front_at].y : -1);
  CHECK(fake_pixel(fake, FRONT_X + 1, FRONT_Y + 1) && !fake_pixel(fake, FRONT_X + 4, FRONT_Y + 4),
        "a black label with its word in white");
  /* A sector either side in the entries' order, the disc wrapping; every word a label in the big font, placed once. */
  CHECK(fake->placed_count == DISC_MOST_ROWS, "as many words as sectors are shown: %d", fake->placed_count);
  for (n = 0; n < fake->placed_count; n++) {
    const builder_label *label = label_placed(n);
    long k;
    int m;
    CHECK(label != NULL && label_run(label) != NULL && label_run(label)->font == FAKE_FONT_BIG, "placement %d is a word in the big font", n);
    if (label == NULL) continue;
    k = label->angle > 0 ? (long)(label->angle / DISC_SECTOR_DEGREES + 0.5f) : -(long)(-label->angle / DISC_SECTOR_DEGREES + 0.5f);
    CHECK(label->angle == (float)k * DISC_SECTOR_DEGREES, "on a sector: %f", (double)label->angle);
    CHECK(strcmp(label_text(label), verbs[(size_t)((long)count + k) % count]) == 0, "%ld sectors round is %s: %s", k,
          verbs[(size_t)((long)count + k) % count], label_text(label));
    CHECK((k == 0) == (n == front_at), "only the front is inverted");
    CHECK(k == 0 || (k > 0) == (fake->placed[n].y > FRONT_Y), "below the front further on, above it further back");
    for (m = n + 1; m < fake->placed_count; m++) CHECK(label_placed(m) != label, "%s placed once", label_text(label));
    if (entry_of(label) < 32) rest_angle[entry_of(label)] = label->angle;
  }
  CHECK(placed_entry(1) >= 0 && label_placed(placed_entry(1))->angle == DISC_SECTOR_DEGREES, "the next verb a sector below");
  CHECK(placed_entry(count - 1) >= 0 && label_placed(placed_entry(count - 1))->angle == -DISC_SECTOR_DEGREES, "the last a sector above");
  /* The hub, its marker at the front, and the rays between the sectors that hold words. */
  CHECK(fake->ellipses == 1 && fake_pixel(fake, DISC_HUB_X + DISC_HUB_RADIUS / 2, CENTRE - DISC_HUB_RADIUS * 7 / 8 + 1) &&
            !fake_pixel(fake, DISC_HUB_X + DISC_HUB_RADIUS / 2, CENTRE - DISC_HUB_RADIUS * 7 / 8 + 6),
        "the hub on the left edge, a ring");
  CHECK(fake_pixel(fake, DISC_HUB_X + DISC_HUB_RADIUS + 2, CENTRE), "its marker pointing at the front");
  CHECK(ray_at(DISC_SECTOR_DEGREES / 2) && ray_at(-DISC_SECTOR_DEGREES / 2) && ray_at(1.5f * DISC_SECTOR_DEGREES),
        "rays between the front and its neighbours, and beyond");

  /* Each 24 degrees of crank is a verb, round the whole disc and back to the first; less is not yet one. */
  for (i = 1; i <= count; i++) {
    fake_frame(fake, 0, 24.0f);
    CHECK(strcmp(front(), verbs[i % count]) == 0, "after %zu steps the front is %s: %s", i, verbs[i % count], front());
  }
  /* A quarter step of crank turns every word up, but by less than a quarter sector: the detent holds it back. */
  fake_frame(fake, 0, 6.0f);
  CHECK(fake->placed_count == DISC_MOST_ROWS, "the same words shown");
  for (n = 0; n < fake->placed_count; n++) {
    const builder_label *label = label_placed(n);
    if (label == NULL || entry_of(label) >= 32) continue;
    CHECK(label->angle < rest_angle[entry_of(label)] && label->angle > rest_angle[entry_of(label)] - DISC_SECTOR_DEGREES / 4,
          "%s turned up less than a quarter sector: %f from %f", label_text(label), (double)label->angle,
          (double)rest_angle[entry_of(label)]);
  }
  /* Ten degrees turns every word up by the detent of ten degrees, the front off level; the labels stay the ones drawn at rest. */
  fake_frame(fake, 0, 4.0f);
  turn = disc_detent(10.0f / SENTENCE_DEGREES_PER_STEP) * DISC_SECTOR_DEGREES;
  CHECK(strcmp(front(), verbs[0]) == 0, "ten degrees is not a step");
  CHECK(fake->placed_count == DISC_MOST_ROWS, "the same words shown");
  for (n = 0; n < fake->placed_count; n++) {
    const builder_label *label = label_placed(n);
    if (label == NULL || entry_of(label) >= 32) continue;
    CHECK(label->angle > rest_angle[entry_of(label)] - turn - 0.01f && label->angle < rest_angle[entry_of(label)] - turn + 0.01f,
          "%s turned %f degrees up: %f from %f", label_text(label), (double)turn, (double)label->angle,
          (double)rest_angle[entry_of(label)]);
  }
  front_at = front_placed();
  CHECK(front_at >= 0 && fake->made[fake->placed[front_at].made].height > LABEL_HEIGHT && fake->placed[front_at].y < FRONT_Y,
        "the front word tilts up off level");
  fake_frame(fake, 0, -34.0f);
  CHECK(strcmp(front(), verbs[count - 1]) == 0, "twenty-four back is a step back: %s", front());
  fake_frame(fake, kButtonDown, 0);
  CHECK(strcmp(front(), verbs[0]) == 0, "down steps forward");
  fake_frame(fake, kButtonUp, 0);
  CHECK(strcmp(front(), verbs[count - 1]) == 0, "up steps back");

  /* Left past halfway, the next verb is the front, still turned below level, and the disc rolls it level once the crank rests. */
  fake_frame(fake, 0, 14.0f);
  front_at = front_placed();
  CHECK(strcmp(front(), verbs[0]) == 0 && front_at >= 0 && label_placed(front_at)->angle > turn - 0.01f &&
            label_placed(front_at)->angle < turn + 0.01f && fake->placed[front_at].y > FRONT_Y,
        "fourteen degrees on, the next verb has turned most of the way to the front: %s", front());
  for (i = 0; i < DISC_REST_FRAMES + 20; i++) fake_frame(fake, 0, 0);
  front_at = front_placed();
  CHECK(strcmp(front(), verbs[0]) == 0 && front_at >= 0 && fake->placed[front_at].x == FRONT_X && fake->placed[front_at].y == FRONT_Y,
        "settled level on the next verb: %s", front());

  fake_frame(fake, kButtonB, 0);
  CHECK(on_reader(), "B at the verbs closes the builder");
  CHECK(fake->made_live == 0, "and lets go of its labels: %d held", fake->made_live);
  leave();
}

/* A label made for each word shown, drawn again only when the level's entries change. */
static void a_label_is_drawn_once_while_its_level_stands(void) {
  const builder_label *front_label;
  int n, made;
  arrive("labels");
  fake_frame(fake, kButtonA, 0);
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  front_label = label_placed(front_placed());
  CHECK(front_label != NULL, "a front");
  if (front_label == NULL) {
    leave();
    return;
  }
  made = fake->made_total;
  fake_frame(fake, 0, 0);
  CHECK(fake->made_total == made && fake->placed_count == DISC_MOST_ROWS, "at rest, nothing is drawn again: %d made",
        fake->made_total - made);
  made = fake->made_total;
  fake_frame(fake, 0, 5.0f);
  CHECK(fake->made_total - made == fake->placed_count, "turned, each word shown is turned again but not drawn again: %d made for %d",
        fake->made_total - made, fake->placed_count);
  fake_frame(fake, kButtonA, 0);
  CHECK(builder()->labels_of == builder()->sentence.made && fake->made_live <= 2 * DISC_MOST_ROWS,
        "a level picked, its labels are new and the last level's let go: %d held", fake->made_live);
  leave();
}

/* The white and black pixels of the first character of the label at the front, at rest. */
static void first_character(int *white, int *black) {
  const fake_run *run = label_run(label_placed(front_placed()));
  int x, y, x0 = FRONT_X + (run != NULL ? run->x : 0), y0 = FRONT_Y + (run != NULL ? run->y : 0);
  *white = *black = 0;
  for (y = y0 + 3; y < y0 + FAKE_BIG_LINE - 3; y++)
    for (x = x0 + 1; x < x0 + FAKE_BIG_GLYPH - 1; x++) {
      *black += fake_pixel(fake, x, y);
      *white += !fake_pixel(fake, x, y);
    }
}

static void a_greyed_chip_is_drawn_greyed_and_says_why(void) {
  const int area = (FAKE_BIG_GLYPH - 2) * (FAKE_BIG_LINE - 6);
  int white, black, n, greyed_below = 0;
  arrive("greyed");
  fake_frame(fake, kButtonA, 0);
  first_character(&white, &black);
  CHECK(white == area && black == 0, "a word that can be done is solid white on the black label: %d white, %d black", white, black);
  CHECK(step_to(kButtonDown, "drop", 20), "the disc reaches drop");
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  /* Nothing is held, so nothing can be dropped: the verb is greyed once the disc reaches it. */
  CHECK(panel() != NULL && strcmp(panel()->text, "You are not holding a guard.") == 0, "the panel says why: %s",
        panel() ? panel()->text : "(none)");
  /* At the front a greyed word is dotted: half its pixels white, half the label's black, in a checker. */
  first_character(&white, &black);
  CHECK(white == area / 2 && black == area / 2, "the word is drawn in a checker: %d white, %d black", white, black);
  CHECK(fake_pixel(fake, FRONT_X + 1, FRONT_Y + 1), "on a black label");
  CHECK(step_to(kButtonUp, "take", 1), "back to take");
  for (n = 0; n < DISC_REST_FRAMES + 20; n++) fake_frame(fake, 0, 0);
  /* Off the front a greyed word keeps its checker: half the pixels of each of its characters are black. */
  n = placed_entry(builder()->sentence.state.selected + 1);
  if (n >= 0 && strcmp(label_text(label_placed(n)), "drop") == 0) {
    int made = fake_made_index(fake, label_placed(n)->flat), x, y, drawn = 0;
    for (y = 0; y < fake->made[made].height; y++)
      for (x = 0; x < fake->made[made].width; x++) drawn += fake_made_pixel(fake, made, x, y) == kColorBlack;
    greyed_below = drawn == 4 * area / 2;
  }
  CHECK(greyed_below, "drop, a sector below, is drawn greyed");
  CHECK(step_to(kButtonUp, "take", 1), "back to take");
  CHECK(keys_shown(), "a chip that can be done shows the keys");

  /* A greyed sentence cannot be run: A says why, and A again goes on. */
  CHECK(step_to(kButtonDown, "give", 5), "give");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), "give") == 0, "a greyed verb can be looked into: %s", phrase());
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(phrase(), "give -> "), "two picks: %s", phrase());
  CHECK(HAS(front(), "give -> "), "the whole sentence at the front: %s", front());
  CHECK(panel() != NULL && HAS(panel()->text, "You are not holding"), "and why it cannot be: %s", panel() ? panel()->text : "");
  fake_frame(fake, kButtonA, 0);
  CHECK(fake_run_at(fake, PLAYER_MARGIN, 40) != NULL && HAS(fake_run_at(fake, PLAYER_MARGIN, 40)->text, "You are not holding"),
        "A on it says why in full");
  fake_frame(fake, kButtonA, 0);
  CHECK(HAS(front(), "give -> "), "and A again goes back to the sentence");
  leave();
}

static void the_sentence_line_fits_the_screen_and_keeps_its_end(void) {
  const fake_run *line;
  int width;
  const char *built = "juggle -> a pebble, a hall, a guard, a dial";
  size_t length = strlen(built), shown;
  arrive("long");
  fake_frame(fake, kButtonA, 0);
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "a pebble", 4), "the pebble");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "and a hall", 5), "a hall");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "and a guard", 5), "a guard");
  fake_frame(fake, kButtonA, 0);
  CHECK(step_to(kButtonDown, "and a dial", 5), "a dial");
  fake_frame(fake, kButtonA, 0);
  CHECK(strcmp(phrase(), built) == 0 && fake_run_at(fake, PLAYER_MARGIN, 0)->font == FAKE_FONT_SYSTEM,
        "it fits in the system font: %s", phrase());

  /* Wider type: the small font where the system font does not fit. */
  fake->glyph = 20;
  fake_frame(fake, 0, 0);
  line = fake_run_at(fake, PLAYER_MARGIN, 0);
  CHECK(line != NULL && strcmp(line->text, built) == 0 && line->font == FAKE_FONT_SMALL, "the small font: %s", phrase());

  /* Wider still: trimmed from the left, so the end of the sentence, the part being built, is in view. */
  fake->small_glyph = 20;
  fake_frame(fake, 0, 0);
  line = fake_run_at(fake, PLAYER_MARGIN, 0);
  CHECK(line != NULL && line->font == FAKE_FONT_SMALL, "the small font");
  if (line != NULL) {
    shown = strlen(line->text);
    width = (int)shown * fake->small_glyph;
    CHECK(strncmp(line->text, BUILDER_TRIMMED, strlen(BUILDER_TRIMMED)) == 0, "led by the mark of a trimmed line: %s", line->text);
    CHECK(width <= ROOM, "it fits: %d pixels", width);
    CHECK(width + fake->small_glyph > ROOM, "and no character more would: %d pixels", width);
    shown -= strlen(BUILDER_TRIMMED);
    CHECK(shown < length && strcmp(line->text + strlen(BUILDER_TRIMMED), built + length - shown) == 0, "it ends as the sentence does: %s",
          line->text);
  }
  /* The rest of the screen's text fits it too. */
  {
    int i;
    for (i = 0; i < fake->run_count; i++)
      CHECK(fake->runs[i].x >= 0 && fake->runs[i].x + (int)strlen(fake->runs[i].text) * fake_glyph(fake, fake->runs[i].font) <= 400,
            "%s is drawn inside the screen", fake->runs[i].text);
  }
  /* A word on the disc is not fitted: the whole sentence at the front runs off the screen's edge, cut there. */
  CHECK(step_to(kButtonDown, "that's all", 10), "that's all");
  fake_frame(fake, kButtonA, 0);
  {
    int n = front_placed(), i;
    const builder_label *label = n >= 0 ? label_placed(n) : NULL;
    CHECK(label != NULL && strcmp(label_text(label), built) == 0, "the whole sentence is drawn at the front: %s", front());
    CHECK(n >= 0 && fake->made[fake->placed[n].made].width == 400, "into a label as wide as the screen, past which nothing shows: %d",
          n >= 0 ? fake->made[fake->placed[n].made].width : 0);
    for (i = 0; i < fake->placed_count; i++)
      CHECK(fake->placed[i].clipped && fake->placed[i].clip_x == 0 && fake->placed[i].clip_y == HEADER &&
                fake->placed[i].clip_width == 400 && fake->placed[i].clip_height == BOTTOM - HEADER,
            "every word is drawn clipped to the disc, between the sentence line and the panel");
  }
  leave();
}

static void the_fit_trims_a_character_at_a_time_and_never_inside_one(void) {
  LCDFont *fonts[1];
  LCDFont *font = NULL;
  const char *why = NULL;
  char out[64];
  const char *fitted;
  begin("fit");
  fonts[0] = fake->api.graphics->loadFont(BUILDER_SMALL_FONT, &why);
  CHECK(fonts[0] != NULL, "%s", why);
  fitted = player_builder_fit(&fake->api, fonts, 1, "short", ROOM, out, sizeof out, &font);
  CHECK(strcmp(fitted, "short") == 0 && font == fonts[0], "what fits is drawn as it is");
  fake->small_glyph = 100;
  /* Room for four characters: the lead and one more, which is the last; a two-byte character is never split. */
  fitted = player_builder_fit(&fake->api, fonts, 1, "abcd\xc3\xa9", 400, out, sizeof out, &font);
  CHECK(strcmp(fitted, "...\xc3\xa9") == 0, "the last character whole: %s", fitted);
  fitted = player_builder_fit(&fake->api, fonts, 1, "abcdef", 300, out, sizeof out, &font);
  CHECK(strcmp(fitted, "...") == 0, "nothing past the lead fits: %s", fitted);
  end();
}

int main(void) {
  test_program("builder_disc");
  the_fit_trims_a_character_at_a_time_and_never_inside_one();
  the_root_is_the_scenes_verbs_on_a_disc_turned_by_the_crank();
  a_label_is_drawn_once_while_its_level_stands();
  a_greyed_chip_is_drawn_greyed_and_says_why();
  the_sentence_line_fits_the_screen_and_keeps_its_end();
  return finish();
}
