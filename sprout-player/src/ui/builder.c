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

/* ---- words over the disc ---- */

static void drop_words(player_app *app, player_builder *b) {
  if (b->message.bytes != NULL && b->message.bytes != unwrapped) player_free(app->pd, b->message.bytes);
  b->message.bytes = NULL;
  b->message.line_count = 0;
}

/* Shows `words` over the disc until A or B. */
static void show_words(player_app *app, player_builder *b, const char *words) {
  drop_words(app, b);
  if (!wrap_lines(app->pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen,
                  &b->message)) {
    b->message.bytes = unwrapped;
    b->message.line_count = 1;
  }
}

/* ---- opening and closing ---- */

/* Loads the builder's fonts the first time the builder opens; one that cannot be loaded is done without. */
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
  player_reader_status(app, reader, view);
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
  if (!sentence_begin(&b->sentence, app->pd, app->session, view, &words)) {
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

/*
 * One turn of the sentence: the reader is told `phrase` as typed and then what the turn told; `text`, where not
 * NULL, is the line the log keeps for it, and `continues` says it is a later step of the line. `*goes_on` whether
 * a line of turns goes on past it. False where play stopped, as the save failed.
 */
static bool take_turn(player_app *app, player_builder *b, const sprout_reading *reading, const char *phrase,
                      const char *text, bool continues, bool *kept, bool *goes_on) {
  transcript *t = &b->reader->lines;
  player_told told;
  *kept = transcript_push(t, "typed", phrase, strlen(phrase)) && *kept;
  told = player_turn(app->session, reading, text, continues);
  if (told.ok && !told.saved) {
    player_shelf_unsaved(app);
    return false;
  }
  if (!told.ok)
    *kept = transcript_push(t, "notice", told.words, strlen(told.words)) && *kept;
  else
    *kept = transcript_tell(t, &told.lines) && images_take_told(&b->pictures, app->assets, &told.lines) && *kept;
  *goes_on = told.ok && told.result == SPROUT_RESULT_DONE && told.goes_on;
  return true;
}

/*
 * Runs the sentence confirmed and the reader takes over. A sentence with `everything` for a role that takes one
 * thing is a turn for each of its things, each told as its own sentence and logged under the whole one, until one
 * does not let the line go on (the spec's Parsing › Sequences, again and all). The line is one input and one save:
 * its state is written once, after its last step.
 */
static void run(player_app *app, player_builder *b) {
  transcript *t = &b->reader->lines;
  size_t turns = sentence_each_count(&b->sentence), k;
  sprout_reading reading;
  const char *phrase;
  bool kept = true, goes_on = true;
  if (turns == 0) {
    sentence_reading(&b->sentence, &reading);
    if (!take_turn(app, b, &reading, sentence_phrase(&b->sentence), NULL, false, &kept, &goes_on)) return;
  }
  for (k = 0; k < turns && goes_on; k++) {
    sentence_each(&b->sentence, k, &reading, &phrase);
    if (!take_turn(app, b, &reading, phrase, sentence_phrase(&b->sentence), k > 0, &kept, &goes_on)) return;
  }
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
  if (disc_update(&b->disc, s, input->crank != 0)) {
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

/* ---- the disc ---- */

/* Lets go of every label's bitmaps, and of the labels. */
static void drop_labels(player_app *app, player_builder *b) {
  size_t i;
  for (i = 0; i < b->label_count; i++) {
    if (b->labels[i].flat != NULL) app->pd->graphics->freeBitmap(b->labels[i].flat);
    if (b->labels[i].turned != NULL) app->pd->graphics->freeBitmap(b->labels[i].turned);
  }
  player_free(app->pd, b->labels);
  b->labels = NULL;
  b->label_count = 0;
}

/* A label for each of the level's `count` entries, none drawn yet, where the entries changed since the labels were made. False where there is no memory for them. */
static bool labels_stand(player_app *app, player_builder *b, size_t count) {
  if (b->labels != NULL && b->labels_of == b->sentence.made && b->label_count == count) return true;
  drop_labels(app, b);
  b->labels = (builder_label *)player_alloc(app->pd, count * sizeof *b->labels);
  if (b->labels == NULL) return false;
  memset(b->labels, 0, count * sizeof *b->labels);
  b->label_count = count;
  b->labels_of = b->sentence.made;
  return true;
}

/* `entry`'s word drawn flat in `font`, black on white, and greyed in a checker where it is greyed; NULL where there is no memory for it. */
static LCDBitmap *flat_label(player_app *app, LCDFont *font, const sentence_entry *entry) {
  PlaydateAPI *pd = app->pd;
  size_t length = strlen(entry->label);
  int width = width_in(pd, font, entry->label, length) + 6, height = pd->graphics->getFontHeight(font) + 2;
  LCDBitmap *flat;
  if (width > PLAYER_SCREEN_WIDTH) width = PLAYER_SCREEN_WIDTH;
  flat = pd->graphics->newBitmap(width, height, kColorWhite);
  if (flat == NULL) return NULL;
  pd->graphics->pushContext(flat);
  pd->graphics->setFont(font);
  pd->graphics->drawText(entry->label, player_utf8_count(entry->label, length), kUTF8Encoding, 3, 1);
  if (entry->greyed) pd->graphics->fillRect(0, 0, width, height, (LCDColor)(uintptr_t)&GREY);
  pd->graphics->popContext();
  pd->graphics->setFont(app->pen.font);
  return flat;
}

/*
 * Places `label`, the word of `entry`, along the ray of `row` from the hub at (hx, cy): drawn flat the
 * first time, and turned again only where its angle or whether it is the front has changed.
 */
static void place_label(player_app *app, LCDFont *font, builder_label *label, const sentence_entry *entry, const disc_row *row,
                        int hx, int cy) {
  PlaydateAPI *pd = app->pd;
  int width, height, rowbytes, x, y;
  uint8_t *flat, *data, *mask;
  float along;
  disc_box box;
  if (label->flat == NULL) label->flat = flat_label(app, font, entry);
  if (label->flat == NULL) return;
  pd->graphics->getBitmapData(label->flat, &width, &height, &rowbytes, NULL, &flat);
  along = disc_bent(row->angle, (float)DISC_WORD_AT + (float)width / 2);
  box = disc_turned_box(width, height, along);
  if (label->turned == NULL || label->along != along || label->front != row->front) {
    int box_rowbytes;
    if (label->turned != NULL) pd->graphics->freeBitmap(label->turned);
    /* Made clear, so it has a mask for the pixels the turn leaves undrawn. */
    label->turned = pd->graphics->newBitmap(box.width, box.height, kColorClear);
    if (label->turned == NULL) return;
    pd->graphics->getBitmapData(label->turned, NULL, NULL, &box_rowbytes, &mask, &data);
    disc_turn(flat, width, height, rowbytes, along, row->front, box, data, mask, box_rowbytes);
    label->along = along;
    label->front = row->front;
  }
  disc_point(disc_bent(row->angle, (float)DISC_WORD_AT), (float)DISC_WORD_AT, &x, &y);
  label->angle = row->angle;
  label->x = hx + x + box.x;
  label->y = cy + y + box.y;
  label->shown = true;
  pd->graphics->drawBitmap(label->turned, label->x, label->y, kBitmapUnflipped);
}

/* A sector's dividing line: the ray leaving the hub at `angle`, bent outward, in segments. */
static void draw_ray(PlaydateAPI *pd, int hx, int cy, float angle) {
  int i, x0, y0, x1, y1;
  float step = (float)(DISC_REACH - DISC_HUB_RADIUS) / DISC_RAY_SEGMENTS;
  disc_point(angle, (float)DISC_HUB_RADIUS, &x0, &y0);
  for (i = 1; i <= DISC_RAY_SEGMENTS; i++) {
    float r = (float)DISC_HUB_RADIUS + step * (float)i;
    disc_point(disc_bent(angle, r), r, &x1, &y1);
    pd->graphics->drawLine(hx + x0, cy + y0, hx + x1, cy + y1, 1, kColorBlack);
    x0 = x1;
    y0 = y1;
  }
}

/*
 * The disc between `top` and `bottom`: the hub at the left edge with its marker, the dividing lines
 * of the sectors that hold a word, and every word along its ray in the big font, the front one last.
 * A word turned out of sight lets go of its turned pixels.
 */
static void draw_disc(player_app *app, player_builder *b, int top, int bottom) {
  PlaydateAPI *pd = app->pd;
  int cy = (top + bottom) / 2, hx = DISC_HUB_X, k;
  size_t count, made, i;
  const sentence_entry *entries = sentence_entries(&b->sentence, &count);
  LCDFont *font = app->big_font != NULL ? app->big_font : app->pen.font;
  disc_row rows[DISC_MOST_ROWS];
  if (!labels_stand(app, b, count)) {
    player_pen_say(&app->pen, NO_MEMORY, PLAYER_MARGIN, cy - app->pen.line_height / 2);
    return;
  }
  pd->graphics->setClipRect(0, top, PLAYER_SCREEN_WIDTH, bottom - top);
  pd->graphics->drawEllipse(hx - DISC_HUB_RADIUS, cy - DISC_HUB_RADIUS, 2 * DISC_HUB_RADIUS, 2 * DISC_HUB_RADIUS, 2, 0.0f,
                            0.0f, kColorBlack);
  pd->graphics->fillTriangle(hx + DISC_HUB_RADIUS - 2, cy - 6, hx + DISC_HUB_RADIUS - 2, cy + 6, hx + DISC_HUB_RADIUS + 8, cy,
                             kColorBlack);
  made = disc_rows(count, b->sentence.state.selected, sentence_fraction(&b->sentence), rows);
  for (i = 0; i < made; i++) {
    for (k = -1; k <= 1; k += 2) {
      float edge = rows[i].angle + (float)k * DISC_SECTOR_DEGREES / 2;
      if (edge > -90.0f && edge < 90.0f) draw_ray(pd, hx, cy, edge);
    }
  }
  for (i = 0; i < count; i++) b->labels[i].shown = false;
  for (i = made; i > 0; i--)
    place_label(app, font, &b->labels[rows[i - 1].index], &entries[rows[i - 1].index], &rows[i - 1], hx, cy);
  for (i = 0; i < count; i++) {
    builder_label *label = &b->labels[i];
    if (label->shown || label->turned == NULL) continue;
    pd->graphics->freeBitmap(label->turned);
    label->turned = NULL;
  }
  pd->graphics->clearClipRect();
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
  draw_disc(app, b, header, bottom);
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
  drop_labels(app, b);
  gallery_free(&b->pictures);
  sentence_free(&b->sentence);
  player_free(app->pd, b);
}

const player_screen player_builder_screen = {update, draw, leave};
