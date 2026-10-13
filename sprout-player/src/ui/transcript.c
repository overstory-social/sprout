/* The reader's transcript; see transcript.h. */
#include "transcript.h"

#include <string.h>

#include "host/files.h"

void transcript_init(transcript *t, PlaydateAPI *pd, wrap_measure measure, void *measure_ctx, int width, size_t rows) {
  memset(t, 0, sizeof *t);
  t->pd = pd;
  t->measure = measure;
  t->measure_ctx = measure_ctx;
  t->width = width;
  t->rows = rows;
}

static wrapped *paragraph(const transcript *t, size_t index) {
  return (wrapped *)&t->paragraphs[(t->first + index) % TRANSCRIPT_KEEP];
}

void transcript_free(transcript *t) {
  size_t i;
  for (i = 0; i < t->count; i++) player_free(t->pd, paragraph(t, i)->bytes);
  player_free(t->pd, t->status);
  t->count = 0;
  t->status = NULL;
}

const char *transcript_lead(const char *kind) {
  if (strcmp(kind, "typed") == 0) return "> ";
  if (strcmp(kind, "refused") == 0) return "! ";
  if (strcmp(kind, "notice") == 0) return "* ";
  if (strcmp(kind, "client") == 0) return "- ";
  return "";
}

size_t transcript_furthest(const transcript *t) { return t->line_count > t->rows ? t->line_count - t->rows : 0; }

static void clamp(transcript *t) {
  size_t furthest = transcript_furthest(t);
  if (t->offset > furthest) t->offset = furthest;
}

bool transcript_push(transcript *t, const char *kind, const char *text, size_t length) {
  const char *lead = transcript_lead(kind);
  size_t lead_length = strlen(lead);
  char *led = (char *)player_alloc(t->pd, lead_length + length + 1);
  wrapped added;
  bool made;
  if (led == NULL) return false;
  memcpy(led, lead, lead_length);
  memcpy(led + lead_length, text, length);
  led[lead_length + length] = '\0';
  made = wrap_lines(t->pd, led, lead_length + length, t->width, t->measure, t->measure_ctx, &added);
  player_free(t->pd, led);
  if (!made) return false;
  if (t->count == TRANSCRIPT_KEEP) {
    wrapped *oldest = paragraph(t, 0);
    t->line_count -= oldest->line_count;
    player_free(t->pd, oldest->bytes);
    t->first = (t->first + 1) % TRANSCRIPT_KEEP;
    t->count--;
  }
  *paragraph(t, t->count++) = added;
  t->line_count += added.line_count;
  if (t->offset > 0) t->offset += added.line_count;
  clamp(t);
  return true;
}

bool transcript_tell(transcript *t, const told_list *lines) {
  size_t i;
  for (i = 0; i < lines->count; i++)
    if (!transcript_push(t, lines->items[i].kind, lines->items[i].text, lines->items[i].text_length)) return false;
  return true;
}

void transcript_scroll(transcript *t, long lines) {
  if (lines < 0 && (size_t)-lines >= t->offset)
    t->offset = 0;
  else
    t->offset = (size_t)((long)t->offset + lines);
  clamp(t);
}

bool transcript_behind(const transcript *t) { return t->offset > 0; }

size_t transcript_visible(const transcript *t, const char **lines) {
  size_t last = t->line_count - t->offset; /* lines up to and including the last shown, counted from the top */
  size_t first = last > t->rows ? last - t->rows : 0;
  size_t seen = 0, shown = 0, i;
  for (i = 0; i < t->count && seen < last; i++) {
    const wrapped *p = paragraph(t, i);
    const char *line = p->bytes;
    size_t k;
    if (seen + p->line_count <= first) {
      seen += p->line_count;
      continue;
    }
    for (k = 0; k < p->line_count && seen < last; k++, seen++, line = wrap_next(line))
      if (seen >= first) lines[shown++] = line;
  }
  return shown;
}

/* Adds `length` bytes at `text` to `out` when `out` has room, and counts them either way. */
static size_t put(char *out, size_t at, const char *text, size_t length) {
  if (out != NULL) memcpy(out + at, text, length);
  return at + length;
}

/* Writes the status words into `out`, or only measures them where `out` is NULL; their length. */
static size_t status_words(const sprout_seen_view *view, char *out) {
  size_t at = put(out, 0, view->place.name.bytes, view->place.name.length), i;
  if (view->exit_count == 0) return at;
  at = put(out, at, " - exits: ", 10);
  for (i = 0; i < view->exit_count; i++) {
    const sprout_seen_exit *exit = &view->exits[i];
    const char *way = exit->direction != NULL ? exit->direction : exit->label != NULL ? exit->label : "";
    if (i > 0) at = put(out, at, ", ", 2);
    at = put(out, at, way, strlen(way));
  }
  return at;
}

bool transcript_set_status(transcript *t, const sprout_seen_view *view) {
  size_t length = status_words(view, NULL);
  char *words = (char *)player_alloc(t->pd, length + 1);
  if (words == NULL) return false;
  status_words(view, words);
  words[length] = '\0';
  player_free(t->pd, t->status);
  t->status = words;
  return true;
}
