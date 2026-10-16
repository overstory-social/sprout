/*
 * A PlaydateAPI with only the functions the app calls, so the session, the host adapter and the
 * screens are exercised without the SDK's runtime: a clock a test sets, a Data folder and an app folder on the
 * desktop's disk, and a screen: graphics that draw into a 400 by 240 one-bit frame, as the
 * Simulator's is, with the text drawn kept as runs, and buttons and a crank a test sets. Three
 * fonts load: the system font, `glyph` pixels a character (FAKE_GLYPH unless a test says
 * otherwise) and FAKE_LINE tall, and the sentence builder's big and small fonts from the pdx's
 * fonts/; a character is drawn as a block. A pattern fill paints what its mask lets through, aligned
 * to the screen as the device's is. Bitmaps load from PNG files, the size their header declares, and
 * are drawn as a black block of that size, each draw recorded. Bitmaps made with newBitmap hold real
 * pixels, kept as the device keeps them (a set data bit white, a set mask bit drawn, rows padded to
 * four bytes), and can be drawn into through pushContext, the text drawn into one kept as its own
 * runs; drawn with drawBitmap they are copied onto the screen through their mask and the clip rect,
 * each placement recorded. Lines go any way, and an ellipse is stroked whole; the file calls that change the Data folder are logged; synths keep what they were set to and
 * record each note played. The network serves canned answers: each address a test gives is answered
 * with its status, headers and body, a piece a frame, behind the permission the test says the person
 * gives; an address it does not know is answered 404. The system menu holds up to three items, as the device's does, which a test can choose. The SDK's headers are the declarations;
 * nothing of the SDK is linked. It is built from fake_playdate/, a module for each of the API's areas.
 */
#ifndef FAKE_PLAYDATE_H
#define FAKE_PLAYDATE_H

#include "pd_api.h"

#define FAKE_RUNS 128
#define FAKE_GLYPH 7
#define FAKE_LINE 18
#define FAKE_BIG_GLYPH 12
#define FAKE_BIG_LINE 30
#define FAKE_SMALL_GLYPH 5
#define FAKE_SMALL_LINE 12
#define FAKE_SYNTHS 16
#define FAKE_NOTES 256
#define FAKE_BITMAPS 32
#define FAKE_DRAWS 32
#define FAKE_MADE 64
#define FAKE_MADE_RUNS 4
#define FAKE_PLACED 32
#define FAKE_CONTEXTS 8
#define FAKE_ANSWERS 16
#define FAKE_CONNECTIONS 8
#define FAKE_MENU_ITEMS 3

/* The fonts the fake loads; a run says which it was drawn in. */
typedef enum fake_font { FAKE_FONT_NONE, FAKE_FONT_SYSTEM, FAKE_FONT_BIG, FAKE_FONT_SMALL } fake_font;

/* One drawText call: its text, where its top left was, and its font. */
typedef struct fake_run {
  char text[512];
  int x, y;
  fake_font font;
} fake_run;

/* A synth newSynth made: what it was set to, and whether it is freed. */
typedef struct fake_synth {
  int live;
  SoundWaveform wave;
  float attack, decay, sustain, release;
} fake_synth;

/* One playNote: the synth it played on, that synth's waveform then, and the note. */
typedef struct fake_note {
  int synth;
  SoundWaveform wave;
  float pitch, volume, length;
} fake_note;

/* A bitmap loadBitmap made: the path it was loaded from, its size, and whether it is freed. */
typedef struct fake_bitmap {
  int live;
  char path[512];
  int width, height;
} fake_bitmap;

/* One drawBitmap or drawScaledBitmap since the frame was cleared: which bitmap, where, at what scale. */
typedef struct fake_draw {
  int bitmap;
  int x, y;
  float scale;
} fake_draw;

/* A bitmap newBitmap made: its pixels as the device holds them (no mask unless it was made clear), and the text drawn into it. */
typedef struct fake_made {
  int live;
  int width, height, rowbytes;
  uint8_t *data, *mask;
  fake_run runs[FAKE_MADE_RUNS];
  int run_count;
} fake_made;

/* One drawBitmap of a made bitmap since the frame was cleared: which, where, and the clip rect it was drawn under. */
typedef struct fake_placed {
  int made;
  int x, y;
  int clipped, clip_x, clip_y, clip_width, clip_height;
} fake_placed;

/* What the fake server answers at one address. */
typedef struct fake_answer {
  char url[512];        /* the whole address, as `https://server/path` (a port only where it is not the scheme's) */
  int status;
  const char *location; /* a Location header, or NULL */
  const char *body;     /* held, not copied */
  size_t length;
  int silent;           /* never sends a byte nor finishes, as a server that has stopped answering */
} fake_answer;

/* A connection the game made: its address, what it asked, how much of the answer it has had. */
typedef struct fake_connection {
  int live;
  char server[256], path[512];
  int port, ssl;
  void *userdata;
  HTTPHeaderCallback *on_header;
  HTTPConnectionCallback *on_complete, *on_closed;
  const fake_answer *answer; /* NULL until `get` */
  fake_answer missing;       /* the 404 for an address no answer names */
  size_t sent, read;         /* bytes made available, and read */
  int complete;
} fake_connection;

/* An item of the system menu: its title, empty while the slot holds none, its callback and its userdata. */
typedef struct fake_menu_item {
  char title[64];
  PDMenuItemCallbackFunction *callback;
  void *ctx;
} fake_menu_item;

typedef struct fake_playdate {
  PlaydateAPI api;
  struct playdate_sys sys;
  struct playdate_file file;
  struct playdate_graphics gfx;
  struct playdate_sound sound;
  struct playdate_sound_synth synth;
  /* the clock: seconds since 2000 and the millisecond counter */
  unsigned seconds, milliseconds, counter;
  /* where kFileWrite and kFileReadData go, and where kFileRead looks */
  char data[512], app[512];
  int pages;
  size_t largest; /* the largest single block asked of the allocator */
  /* when set, every file opened for writing fails to open, as on a full disk */
  int fail_writes;
  /* when set, every read of an open file fails, as of a card gone bad */
  int fail_reads;
  /* the reads of open files made, and the most bytes one asked for; a test empties them to watch from a moment on */
  size_t reads, read_largest;
  /* the writes to open files made, and the bytes they wrote; a test empties them the same way */
  size_t writes, written;
  /* the screen: the frame (a set bit is black), the text drawn since it was cleared, the font loaded */
  uint8_t frame[LCD_ROWS * LCD_ROWSIZE];
  fake_run runs[FAKE_RUNS];
  int run_count;
  fake_font font_set; /* the font set; drawing in none is a fault */
  int glyph;          /* the width of a system font character, FAKE_GLYPH unless a test widens it */
  int big_glyph, small_glyph; /* the same for the builder's fonts, FAKE_BIG_GLYPH and FAKE_SMALL_GLYPH unless a test says */
  /* the sounds: the synths made and the notes played */
  fake_synth synths[FAKE_SYNTHS];
  int synth_count;
  fake_note notes[FAKE_NOTES];
  int note_count;
  /* the bitmaps loaded, how many are held now, and those drawn since the frame was cleared */
  fake_bitmap bitmaps[FAKE_BITMAPS];
  int bitmap_count, bitmaps_live;
  fake_draw draws[FAKE_DRAWS];
  int draw_count;
  /* the bitmaps made, how many are held now, those placed since the frame was cleared, the contexts pushed
     (a made bitmap's index, or -1 for the screen), and the clip rect on the screen */
  fake_made made[FAKE_MADE];
  int made_live, made_total;
  fake_placed placed[FAKE_PLACED];
  int placed_count;
  int contexts[FAKE_CONTEXTS];
  int context_count;
  int clipped, clip_x, clip_y, clip_width, clip_height;
  /* the ellipses and triangles drawn since the frame was cleared */
  int ellipses, triangles;
  /* the network: whether there is one, the Wi-Fi, what the person answers when asked (an access
     reply, and for kAccessAsk the answer given at the next frame), how many bytes a frame brings,
     the answers, the connections made, and what was asked */
  WifiStatus wifi;
  int wifi_enabled;
  enum accessReply access;
  int allow_when_asked;
  int asked_pending;
  AccessRequestCallback *ask_callback;
  void *ask_userdata;
  char asked_purpose[256];
  int asks;
  size_t piece;
  fake_answer answers[FAKE_ANSWERS];
  int answer_count;
  fake_connection connections[FAKE_CONNECTIONS];
  int connection_count, connections_live;
  struct playdate_network network;
  struct playdate_http http;
  /* the input the next frame reads, and the update callback the game set */
  PDButtons buttons_held, buttons_pushed;
  float crank;
  int docked;
  PDCallbackFunction *update;
  void *update_ctx;
  /* the Data folder's opens for writing, unlinks and renames, in order, one a line: "write <path>",
     "unlink <path>", "rename <from> <to>"; a test empties it to watch from a moment on */
  char file_log[8192];
  /* the system menu's items, in the order added: a title is empty while its slot holds none */
  fake_menu_item menu[FAKE_MENU_ITEMS];
} fake_playdate;

/* A fake over the two folders. */
void fake_init(fake_playdate *fake, const char *data, const char *app);

/* Whether the pixel at (x, y) is black. */
int fake_pixel(const fake_playdate *fake, int x, int y);

/* The run of text drawn at the top left (x, y), or NULL. */
const fake_run *fake_run_at(const fake_playdate *fake, int x, int y);

/* The made bitmap `bitmap` is, or -1 where it is not one. */
int fake_made_index(const fake_playdate *fake, const LCDBitmap *bitmap);

/* The pixel at (x, y) of made bitmap `made`: kColorBlack, kColorWhite, or kColorClear where its mask leaves it out or it is outside. */
LCDSolidColor fake_made_pixel(const fake_playdate *fake, int made, int x, int y);

/* The width of a character and the height of a line in `font`. */
int fake_glyph(const fake_playdate *fake, fake_font font);
int fake_line(fake_font font);

/* The fake server answers `url` with `status` and `body` (held, not copied); the answer, for a test to change further. */
fake_answer *fake_serve(fake_playdate *fake, const char *url, int status, const char *body, size_t length);

/* Moves the network on as the time between two frames does: the person's answer, and a piece of each answer under way. */
void fake_network_step(fake_playdate *fake);

/* Chooses the system menu's item titled `title`, as the person does from the menu; whether there is one. */
int fake_menu(fake_playdate *fake, const char *title);

/* Whether the system menu holds an item titled `title`, and how many it holds. */
int fake_menu_holds(const fake_playdate *fake, const char *title);
int fake_menu_count(const fake_playdate *fake);

/* Runs one frame through the update callback the game set, with `pushed` pressed and the crank turned `crank` degrees. */
int fake_frame(fake_playdate *fake, PDButtons pushed, float crank);

#endif
