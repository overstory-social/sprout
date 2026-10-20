/*
 * One world open on the device: the cartridge loaded, its stored state, and the single visit
 * the device holds for it (the spec's The host contract; on a device a visit is one per world,
 * keyed by nothing but the world, since there is one person). Each call hands back the
 * runtime's own structs, or a small answer of the session's that points into them; what a call
 * gives lives until the next call on the session.
 *
 * Time is host seconds, clamped so it never goes below the last the save recorded
 * (host/pd_host.h). After every committed turn the log tail is written at once and the state is
 * owed: `player_save_step` writes it a slice a frame, and every call that runs a turn, loads or
 * closes writes what is owed first, so the state never changes under the writer. One input is one
 * save: the later steps of a line of turns write nothing of the state before they run, so the line
 * owes it once when it ends. A tick's save waits instead (PLAYER_SAVE_WAIT_SECONDS). `saved` false
 * says a write failed, and the UI stops play and says so.
 */
#ifndef PLAYER_SESSION_H
#define PLAYER_SESSION_H

#include "pd_api.h"
#include "sprout.h"
#include "told.h"

/* The one visit the device holds in a world. */
#define PLAYER_VISIT "visit:player"

typedef struct player_session player_session;

player_session *player_session_new(PlaydateAPI *pd);
void player_session_free(player_session *session);

/* A cartridge asked about, opened, or being read on; `ok` false with `reason` saying why. */
typedef struct player_opening {
  bool ok;
  bool done;               /* step: the world is open */
  size_t read, counted;    /* step: bytes of the body inflated so far, of all there are */
  const char *name, *hash; /* the world's name and bundle hash: inspect and open when ok, step once done */
  const char *title;       /* with the name: the title its manifest gives, or NULL where it gives none */
  size_t word_count;
  const char *const *words; /* step once done: the words the world reads, which no nickname may be */
  const char *reason;
} player_opening;

/* Whether the cartridge at `path` can be shelved; cheap however large the world. */
player_opening player_inspect(player_session *session, const char *path);

/* Begins opening the world at `path`: its header read and checked against the app's caps. */
player_opening player_open(player_session *session, const char *path);

/* Reads on a little of the world being opened; the name, hash and words once done. */
player_opening player_step(player_session *session);

/* The save read, or the world started: who the device's visitor was, and who else stands in it. */
typedef struct player_loaded {
  bool ok;
  bool fresh;                 /* no save was read: the world starts anew */
  bool recovered;             /* the last session ended with the visitor in the world, who has left now, quietly */
  const sprout_str *nickname; /* the visitor the save remembers, or NULL */
  size_t present_count;
  const sprout_str *present; /* the nicknames of the others who stand in the world */
  uint64_t last;             /* the greatest host seconds the save recorded */
  const char *words;         /* "" or why the save was set aside; when not `ok`, why nothing was loaded */
} player_loaded;

player_loaded player_load(player_session *session);

/*
 * What the turns of one call told. `ok` false: nothing was run, `words` says why, and `lines` is
 * empty. Each call sets the flag that is its own.
 */
typedef struct player_told {
  bool ok;
  bool admitted;             /* admit: the visitor arrived */
  bool committed;            /* turn: the command committed */
  bool goes_on;              /* turn: a line of turns goes on past it, as nothing refused its actor */
  bool ran;                  /* tick: some turn did more than idle */
  bool changed;              /* the state changed: its save is owed or waiting, and the view kept is stale */
  bool saved;
  sprout_turn_result result; /* turn: how it ended; SPROUT_RESULT_REFUSED where it was not run */
  const char *words;         /* admit: "" or why the nickname was refused; turn: NULL or what kept it from running */
  told_list lines;
} player_told;

/* Catch-up, which tells nothing, and then the visitor's arrival under `nickname`. */
player_told player_admit(player_session *session, const char *nickname);

/*
 * The visitor's view: the scene, kept with the chip tree's root until the state changes, the next load or
 * the close. A view asked while the kept one stands is the kept one, with no poll; a turn that commits or
 * changes the state makes the next view poll again. NULL when there is nothing to see, with `*words` saying why.
 */
const sprout_seen_view *player_view(player_session *session, const char **words);

/* Whether anything under a choice can be done: not known until its verb's readings are asked for. */
typedef enum player_greyed { PLAYER_GREYED_UNKNOWN, PLAYER_GREYED_NO, PLAYER_GREYED_YES } player_greyed;

typedef struct player_chip {
  const char *verb;                 /* at the root: the verb, by its qualified name */
  const sprout_seen_filler *filler; /* below it: what fills the next role */
  player_greyed greyed;
  const char *reason; /* why nothing under it can be done, or NULL */
} player_chip;

/* One level of the chip tree; `ok` false with `reason` saying why there is none. */
typedef struct player_chip_level {
  bool ok;
  const char *reason;
  size_t choice_count;
  const player_chip *choices;
  const sprout_seen_reading *leaf; /* the reading that ends here, or NULL */
  const player_chip *verb; /* right under a verb: the verb, greyed as the root could not say before; else NULL */
} player_chip_level;

/*
 * The level of the last view's chip tree that `picks` names: 1-based, the verb's index then each
 * choice's, none for the verbs. A verb's readings are asked of the runtime when a path first
 * reaches it; a pick of 0, or past the end of its level, names nothing.
 */
player_chip_level player_chips(player_session *session, const size_t *picks, size_t pick_count);

/*
 * A command turn from a reading the sentence builder made, performed by the visitor (the session
 * fills in the actor); `text` is the line it stands for, logged, or NULL. `continues` says it is a
 * later step of the line the call before began (the spec's Parsing › Sequences): what the steps
 * before it owe is left owed, not written first.
 */
player_told player_turn(player_session *session, const sprout_reading *reading, const char *text, bool continues);

/* A reading the UI could not make: `why` is told as a notice, as a turn's answer, and nothing runs. */
player_told player_misread(player_session *session, const char *why);

/* The wakes that have fallen due, then a tick of each place a visitor stands in. */
player_told player_tick(player_session *session);

/* An answer that is ok, or the words for the person; `words` is "" when ok. */
typedef struct player_result {
  bool ok;
  const char *words;
} player_result;

/* Writes the save now, whole. */
player_result player_save(player_session *session);

/* How many bytes of the state the app writes a frame. */
#define PLAYER_SAVE_SLICE (16u * 1024u)

/*
 * How long a tick's save waits: a tick that changed the state owes a save, begun only once this
 * many seconds have passed since the last save began, or at once on pause, sleep, leaving the
 * world or the visitor's next turn (the design's Saves). A visitor's own turn saves at once.
 */
#define PLAYER_SAVE_WAIT_SECONDS 30u

/*
 * One step of the save owed: the state's bytes made, or up to `bytes` more of them written; the
 * last renames the written file over the save. A tick's save that has waited its time begins
 * here. Not ok, with the words, when a write failed. It releases nothing an earlier call handed back.
 */
player_result player_save_step(player_session *session, size_t bytes);

/* Writes all of the save that is owed or under way, now: before the app pauses, locks or sleeps. */
player_result player_save_settle(player_session *session);

/* Whether any of the state is yet to be written, a tick's save that waits included. */
bool player_saving(const player_session *session);

/* The open world begun again; `ok` false with `reason` saying why it could not be. */
typedef struct player_restart {
  bool ok;
  const char *reason;
  const char *name;           /* the world's name */
  const char *title;          /* the title its manifest gives, or NULL where it gives none */
  size_t word_count;
  const char *const *words;   /* the words the world reads, which no nickname may be */
  const sprout_str *nickname; /* the name the visitor had, which the device offers first again, or NULL */
} player_restart;

/*
 * Starts the open world over: its state and log are removed from `saves/`, with any `.tmp` a
 * write cut short left beside them, and the state is let go while the world stays read, so the
 * next `player_load` finds no save and the world starts anew. Nothing is told and no turn runs.
 */
player_restart player_start_over(player_session *session);

/* The visitor leaves, the save is written, and the world is released; never refused. */
player_told player_close(player_session *session);

#endif
