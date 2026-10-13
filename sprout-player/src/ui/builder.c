/* The sentence builder screen; see builder.h. */
#include "builder.h"

#include <stdint.h>
#include <string.h>

#include "host/files.h"
#include "images.h"
#include "pictures.h"
#include "shelf.h"

static const char NO_MEMORY[] = "The player ran out of memory telling that.";
static const char GO_ON[] = "A to go on";
/* The one line that needs no memory to wrap. */
static char unwrapped[] = "The player ran out of memory.";

/* Half the pixels white, in a checker: drawn over a greyed word. */
static const LCDPattern GREY = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
                                0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55};

/* ---- text in a font ---- */

static int width_in(PlaydateAPI *pd, LCDFont *font, const char *text, size_t length) {
  return pd->graphics->getTextWidth(font, text, player_utf8_count(text, length), kUTF8Encoding, 0);
}

static void say_in(player_app *app, LCDFont *font, const char *text, int x, int y) {
  app->pd->graphics->setFont(font);
  player_pen_say(&app->pen, text, x, y);
  app->pd->graphics->setFont(app->pen.font);
}

const char *player_builder_fit(PlaydateAPI *pd, LCDFont *const *fonts, size_t font_count, const char *text, int room,
                               char *out, size_t size, LCDFont **font) {
  size_t length = strlen(text), lead = strlen(BUILDER_TRIMMED), start = 0, i;
  LCDFont *last = fonts[font_count - 1];
  for (i = 0; i < font_count; i++) {
    if (width_in(pd, fonts[i], text, length) <= room) {
      *font = fonts[i];
      return text;
    }
  }
  *font = last;
  if (size <= lead) return "";
  memcpy(out, BUILDER_TRIMMED, lead + 1);
  /* A character at a time off the front, until what is left fits behind the lead. */
  while (start < length) {
    do start++;
    while (start < length && ((unsigned char)text[start] & 0xC0u) == 0x80u);
    if (start >= length || lead + (length - start) + 1 > size) continue;
    memcpy(out + lead, text + start, length - start + 1);
    if (width_in(pd, last, out, lead + length - start) <= room) return out;
  }
  out[lead] = '\0';
  return out;
}

/* The fonts a slat at `tier` may take, largest first; the ones that could not be loaded are left out. */
static size_t tier_fonts(const player_app *app, drum_tier tier, LCDFont **fonts) {
  size_t n = 0;
  if (tier == DRUM_FRONT && app->big_font != NULL) fonts[n++] = app->big_font;
  if (tier != DRUM_FAR || app->small_font == NULL) fonts[n++] = app->pen.font;
  if (app->small_font != NULL) fonts[n++] = app->small_font;
  return n;
}

/* ---- words over the drum ---- */

static void drop_words(player_app *app, player_builder *b) {
  if (b->message.bytes != NULL && b->message.bytes != unwrapped) player_free(app->pd, b->message.bytes);
  b->message.bytes = NULL;
  b->message.line_count = 0;
}

/* Shows `words` over the drum until A or B. */
static void show_words(player_app *app, player_builder *b, const char *words) {
  drop_words(app, b);
  if (!wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen,
                  &b->message)) {
    b->message.bytes = unwrapped;
    b->message.line_count = 1;
  }
}

/* ---- opening and closing ---- */

/* Loads the drum's fonts the first time the builder opens; one that cannot be loaded is done without. */
static void load_fonts(player_app *app) {
  const char *error = NULL;
  if (app->fonts_tried) return;
  app->fonts_tried = true;
  app->big_font = app->pd->graphics->loadFont(BUILDER_BIG_FONT, &error);
  app->small_font = app->pd->graphics->loadFont(BUILDER_SMALL_FONT, &error);
}

/* Tells the reader `words` as a notice; false, as nothing was built. */
static bool tell_reader(player_reader *reader, const char *words) {
  transcript_push(&reader->lines, "notice", words, strlen(words));
  return false;
}

bool player_builder_open(player_app *app, player_reader *reader) {
  const char *words = NULL;
  const sprout_seen_view *view = player_view(app->session, &words);
  player_builder *b;
  size_t i;
  if (view == NULL) return tell_reader(reader, words != NULL && words[0] != '\0' ? words : "The place cannot be seen.");
  transcript_set_status(&reader->lines, view);
  if (view->faulted) {
    /* A poll that ran out offers nothing, and its description is the fault told. */
    for (i = 0; i < view->description_count; i++)
      transcript_push(&reader->lines, "notice", view->description[i].bytes, view->description[i].length);
    return false;
  }
  b = (player_builder *)player_alloc(app->pd, sizeof *b);
  if (b == NULL) return tell_reader(reader, "The player ran out of memory building a sentence.");
  memset(b, 0, sizeof *b);
  gallery_init(&b->pictures, app->pd);
  if (!sentence_begin(&b->sentence, app->pd, app->session, &words)) {
    player_free(app->pd, b);
    return tell_reader(reader, words);
  }
  load_fonts(app);
  b->reader = reader;
  reader->lent = true;
  player_app_show(app, &player_builder_screen, b);
  return true;
}

/* Hands the reader back and shows it, behind the pictures the sentence run asked for where it asked for any. */
static void close_builder(player_app *app, player_builder *b) {
  b->reader->lent = false;
  player_pictures_show(app, b->reader, &b->pictures);
  b->reader = NULL;
}

/* Runs the sentence confirmed: the reader is told it as typed and then what the turn told, and takes over. */
static void run(player_app *app, player_builder *b) {
  transcript *t = &b->reader->lines;
  const char *phrase = sentence_phrase(&b->sentence);
  sprout_reading reading;
  player_told told;
  bool kept;
  sentence_reading(&b->sentence, &reading);
  kept = transcript_push(t, "typed", phrase, strlen(phrase));
  told = player_turn(app->session, &reading, NULL);
  if (told.ok && !told.saved) {
    player_shelf_unsaved(app);
    return;
  }
  if (!told.ok)
    kept = transcript_push(t, "notice", told.words, strlen(told.words)) && kept;
  else
    kept = transcript_tell(t, &told.lines) && images_take_told(&b->pictures, app->assets, &told.lines) && kept;
  kept = player_reader_look(app, b->reader, NULL) && kept;
  transcript_scroll(t, -(long)t->offset);
  if (!kept) {
    /* The transcript could not hold all of it: the words say so, and the builder closes after them. */
    b->closing = true;
    show_words(app, b, NO_MEMORY);
    return;
  }
  close_builder(app, b);
}

static void confirm(player_app *app, player_builder *b) {
  const char *words = NULL;
  sentence_end end = sentence_pick(&b->sentence, &words);
  if (end == SENTENCE_REFUSED) {
    player_cue(app, PLAYER_CUE_REFUSED);
    show_words(app, b, words);
    return;
  }
  player_cue(app, PLAYER_CUE_PICK);
  if (end == SENTENCE_DONE) run(app, b);
}

/* ---- the screen ---- */

static void update(player_app *app, void *ctx, const player_input *input) {
  player_builder *b = (player_builder *)ctx;
  sentence *s = &b->sentence;
  bool numbered, stepped;
  long down;
  if (b->message.bytes != NULL) {
    if (input->pushed & (kButtonA | kButtonB)) {
      drop_words(app, b);
      if (b->closing) close_builder(app, b);
    }
    return;
  }
  if (sentence_turn(s, input->crank) != 0) player_cue(app, PLAYER_CUE_TICK);
  if (drum_update(&b->drum, s, input->crank != 0)) {
    player_cue(app, PLAYER_CUE_CLACK);
    sentence_prepare(s);
  }
  /* Down moves to the next entry; on a number it takes the number down, as up takes it up. */
  numbered = sentence_numbered(s);
  down = numbered ? -1 : 1;
  if (input->pushed & kButtonDown) sentence_nudge(s, down);
  if (input->pushed & kButtonUp) sentence_nudge(s, -down);
  if (numbered && (input->pushed & kButtonRight)) sentence_add_number(s, 1, true);
  if (numbered && (input->pushed & kButtonLeft)) sentence_add_number(s, -1, true);
  stepped = (input->pushed & (kButtonDown | kButtonUp)) || (numbered && (input->pushed & (kButtonRight | kButtonLeft)));
  if (stepped) {
    player_cue(app, PLAYER_CUE_TICK);
    sentence_prepare(s);
  }
  if (input->pushed & kButtonA) {
    confirm(app, b);
  } else if (input->pushed & kButtonB) {
    player_cue(app, PLAYER_CUE_BACK);
    if (sentence_back(s))
      sentence_prepare(s);
    else
      close_builder(app, b);
  }
}

static void draw_lines(player_app *app, const wrapped *lines, int y) {
  const char *line = lines->bytes;
  size_t i;
  for (i = 0; i < lines->line_count; i++, line = wrap_next(line), y += app->pen.line_height)
    player_pen_say(&app->pen, line, PLAYER_MARGIN, y);
}

/* The drum: the window at its front and the words on it, each in the font of its tier. */
static void draw_drum(player_app *app, player_builder *b, int top, int bottom) {
  PlaydateAPI *pd = app->pd;
  int centre = (top + bottom) / 2, room = PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN;
  size_t count, made, i;
  const sentence_entry *entries = sentence_entries(&b->sentence, &count);
  drum_row rows[DRUM_MOST_ROWS];
  pd->graphics->drawLine(0, centre - BUILDER_WINDOW, PLAYER_SCREEN_WIDTH, centre - BUILDER_WINDOW, 1, kColorBlack);
  pd->graphics->drawLine(0, centre + BUILDER_WINDOW, PLAYER_SCREEN_WIDTH, centre + BUILDER_WINDOW, 1, kColorBlack);
  pd->graphics->fillTriangle(PLAYER_MARGIN, centre - 6, PLAYER_MARGIN, centre + 6, PLAYER_MARGIN + 8, centre, kColorBlack);
  pd->graphics->fillTriangle(PLAYER_SCREEN_WIDTH - PLAYER_MARGIN, centre - 6, PLAYER_SCREEN_WIDTH - PLAYER_MARGIN, centre + 6,
                             PLAYER_SCREEN_WIDTH - PLAYER_MARGIN - 8, centre, kColorBlack);
  made = drum_rows(count, b->sentence.state.selected, sentence_fraction(&b->sentence), rows);
  for (i = 0; i < made; i++) {
    const sentence_entry *entry = &entries[rows[i].index];
    LCDFont *fonts[3], *font = NULL;
    char fitted[512];
    const char *text = player_builder_fit(pd, fonts, tier_fonts(app, rows[i].tier, fonts), entry->label, room, fitted,
                                          sizeof fitted, &font);
    int width = width_in(pd, font, text, strlen(text)), height = pd->graphics->getFontHeight(font);
    int x = PLAYER_SCREEN_WIDTH / 2 - width / 2, y = centre + rows[i].y - height / 2;
    if (y < top || y + height > bottom) continue;
    say_in(app, font, text, x, y);
    if (entry->greyed) pd->graphics->fillRect(x, y, width, height, (LCDColor)(uintptr_t)&GREY);
  }
}

static void draw(player_app *app, void *ctx) {
  player_builder *b = (player_builder *)ctx;
  PlaydateAPI *pd = app->pd;
  int line_height = app->pen.line_height, header = line_height + 4, bottom = PLAYER_SCREEN_HEIGHT - (line_height * 3 + 8);
  LCDFont *line_fonts[2], *font = NULL;
  size_t font_count = 0, count;
  const sentence_entry *entry;
  const char *words, *line;
  wrapped panel;
  if (b->message.bytes != NULL) {
    draw_lines(app, &b->message, 40);
    player_pen_say(&app->pen, GO_ON, PLAYER_MARGIN, PLAYER_SCREEN_HEIGHT - line_height - 2);
    return;
  }
  line_fonts[font_count++] = app->pen.font;
  if (app->small_font != NULL) line_fonts[font_count++] = app->small_font;
  line = player_builder_fit(pd, line_fonts, font_count, sentence_phrase(&b->sentence), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN,
                            b->line, sizeof b->line, &font);
  say_in(app, font, line, PLAYER_MARGIN, 0);
  pd->graphics->drawLine(0, header - 1, PLAYER_SCREEN_WIDTH, header - 1, 1, kColorBlack);
  draw_drum(app, b, header, bottom);
  pd->graphics->drawLine(0, bottom, PLAYER_SCREEN_WIDTH, bottom, 1, kColorBlack);
  entry = &sentence_entries(&b->sentence, &count)[b->sentence.state.selected];
  words = entry->reason != NULL ? entry->reason : BUILDER_KEYS;
  if (wrap_lines(pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen, &panel)) {
    draw_lines(app, &panel, bottom + 2);
    player_free(pd, panel.bytes);
  } else {
    player_pen_say(&app->pen, NO_MEMORY, PLAYER_MARGIN, bottom + 2);
  }
}

static void leave(player_app *app, void *ctx) {
  player_builder *b = (player_builder *)ctx;
  if (b->reader != NULL) {
    /* The app ends with the builder up: the reader it holds goes with it. */
    b->reader->lent = false;
    player_reader_screen.leave(app, b->reader);
  }
  drop_words(app, b);
  gallery_free(&b->pictures);
  sentence_free(&b->sentence);
  player_free(app->pd, b);
}

const player_screen player_builder_screen = {update, draw, leave};
