/* The sentence builder screen; see builder.h. */
#include "builder.h"

#include <string.h>

#include "host/files.h"
#include "images.h"
#include "pictures.h"
#include "shelf.h"

static const char NO_MEMORY[] = "The player ran out of memory telling that.";
static const char GO_ON[] = "A to go on";
/* The one line that needs no memory to wrap. */
static char unwrapped[] = "The player ran out of memory.";

/* ---- text in a font ---- */

static int width_in(PlaydateAPI *pd, LCDFont *font, const char *text, size_t length) {
  return pd->graphics->getTextWidth(font, text, player_utf8_count(text, length), kUTF8Encoding, 0);
}

const char *player_builder_fit(PlaydateAPI *pd, LCDFont *font, const char *text, int room, char *out, size_t size) {
  size_t length = strlen(text), lead = strlen(BUILDER_TRIMMED), start = 0;
  if (width_in(pd, font, text, length) <= room) return text;
  if (size <= lead) return "";
  memcpy(out, BUILDER_TRIMMED, lead + 1);
  /* A character at a time off the front, until what is left fits behind the lead. */
  while (start < length) {
    do start++;
    while (start < length && ((unsigned char)text[start] & 0xC0u) == 0x80u);
    if (start >= length || lead + (length - start) + 1 > size) continue;
    memcpy(out + lead, text + start, length - start + 1);
    if (width_in(pd, font, out, lead + length - start) <= room) return out;
  }
  out[lead] = '\0';
  return out;
}

/* ---- words over the disc ---- */

static void drop_words(player_app *app, player_builder *b) {
  if (b->message.bytes == unwrapped)
    b->message.bytes = NULL;
  else
    wrap_free(app->pd, &b->message);
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

/* Tells the reader `words` as a notice; false, as nothing was built. */
static bool tell_reader(player_reader *reader, const char *words) {
  transcript_push(&reader->lines, "notice", words, strlen(words));
  return false;
}

bool player_builder_open(player_app *app, player_reader *reader) {
  const char *words = NULL;
  const sprout_seen_view *view = NULL;
  player_builder *b;
  size_t i;
  player_reader_look(app, reader, &view);
  if (view == NULL) return false;
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
  wheel_hold_font(app);
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
  if (end == SENTENCE_GOES_ON) disc_stop(&b->wheel.disc);
  if (end == SENTENCE_DONE) run(app, b);
}

/* ---- the screen ---- */

static void update(player_app *app, void *ctx, const player_input *input) {
  player_builder *b = (player_builder *)ctx;
  sentence *s = &b->sentence;
  bool numbered, stepped, settled;
  long down, turned;
  if (b->message.bytes != NULL) {
    if (input->pushed & (kButtonA | kButtonB)) {
      drop_words(app, b);
      if (b->closing) close_builder(app, b);
    }
    return;
  }
  turned = disc_crank(&b->wheel.disc, input->crank);
  if (turned != 0) {
    sentence_nudge(s, turned);
    player_cue(app, PLAYER_CUE_TICK);
  }
  settled = disc_update(&b->wheel.disc, input->crank != 0);
  if (settled) player_cue(app, PLAYER_CUE_CLACK);
  if (settled || !b->asked) {
    /* The disc is on screen, drawn the frame it opened: the verb at its front is asked after now, as whenever it settles. */
    b->asked = true;
    sentence_prepare(s);
  } else if (input->crank == 0 && input->pushed == 0 && disc_at_rest(&b->wheel.disc)) {
    /*
     * The crank rests and nothing was pressed: a verb's readings cost a frame, so one of the verbs the wheel
     * shows beside the front is asked after, nearest first, and a frame with input asks after none.
     */
    sentence_prepare_near(s, DISC_SIDE);
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
    if (sentence_back(s)) {
      disc_stop(&b->wheel.disc);
      sentence_prepare(s);
    }
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

/* Entry `index` of the sentence's level as the wheel says it. */
static wheel_word entry_word(const void *ctx, size_t index) {
  size_t count;
  const sentence_entry *entry = &sentence_entries((const sentence *)ctx, &count)[index];
  wheel_word word;
  word.text = entry->label;
  word.greyed = entry->greyed;
  return word;
}

static void draw_disc(player_app *app, player_builder *b, int top, int bottom) {
  size_t count;
  sentence_entries(&b->sentence, &count);
  wheel_draw(app, &b->wheel, count, b->sentence.state.selected, entry_word, &b->sentence, b->sentence.made, top, bottom);
}

/* The sentence line over the disc and the panel under it are the frame's: its font and its line height. */
static void draw(player_app *app, void *ctx) {
  player_builder *b = (player_builder *)ctx;
  PlaydateAPI *pd = app->pd;
  const player_pen *pen = &app->pen;
  int frame_height = pen->frame_height, header = frame_height + 4, bottom = PLAYER_SCREEN_HEIGHT - (frame_height * 3 + 8);
  size_t count, i;
  const sentence_entry *entry;
  const char *words, *line;
  wrapped panel;
  if (b->message.bytes != NULL) {
    draw_lines(app, &b->message, 40);
    player_pen_frame_say(pen, GO_ON, PLAYER_MARGIN, PLAYER_SCREEN_HEIGHT - frame_height - 2);
    return;
  }
  line = player_builder_fit(pd, pen->frame, sentence_phrase(&b->sentence), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, b->line,
                            sizeof b->line);
  player_pen_frame_say(pen, line, PLAYER_MARGIN, 0);
  pd->graphics->drawLine(0, header - 1, PLAYER_SCREEN_WIDTH, header - 1, 1, kColorBlack);
  draw_disc(app, b, header, bottom);
  pd->graphics->drawLine(0, bottom, PLAYER_SCREEN_WIDTH, bottom, 1, kColorBlack);
  entry = &sentence_entries(&b->sentence, &count)[b->sentence.state.selected];
  words = entry->reason != NULL ? entry->reason : BUILDER_KEYS;
  if (wrap_lines(pd, words, strlen(words), PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_frame_width, &app->pen, &panel)) {
    line = panel.bytes;
    for (i = 0; i < panel.line_count; i++, line = wrap_next(line)) player_pen_frame_say(pen, line, PLAYER_MARGIN, bottom + 2 + (int)i * frame_height);
    wrap_free(pd, &panel);
  } else {
    player_pen_frame_say(pen, NO_MEMORY, PLAYER_MARGIN, bottom + 2);
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
  wheel_free(app, &b->wheel);
  gallery_free(&b->pictures);
  sentence_free(&b->sentence);
  player_free(app->pd, b);
}

/* The reader it holds follows the body, and so do the words over the disc; the phrase and the hint are the frame's, laid out each draw. */
static void refit(player_app *app, void *ctx) {
  player_builder *b = (player_builder *)ctx;
  player_reader_screen.refit(app, b->reader);
  if (b->message.bytes != unwrapped)
    wrap_again(app->pd, &b->message, PLAYER_SCREEN_WIDTH - 2 * PLAYER_MARGIN, player_pen_width, &app->pen);
}

const player_screen player_builder_screen = {update, draw, leave, refit};
