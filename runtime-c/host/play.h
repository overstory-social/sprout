/*
 * `sproutc play <world.sproutworld> [--state save.json] [--script script.json]
 * [--readings file] [--clock N]`: prints the cartridge's header and manifest,
 * loads it, and, given a script, plays the script's readings (see readings.h)
 * through the runtime's public API on the desktop host (host.h).
 *
 * Output: the header and manifest, then, with a script, a line `--- play`
 * and a block per step: `## step <index>: <typed line>` and under it each
 * line the runtime emitted, `<recipient>: <text>`. A call the runtime has
 * not built yet ends the play with `!! <words>` and exit code 3; any
 * other failure exits 1 with its words on the error stream.
 */
#ifndef SPROUTC_PLAY_H
#define SPROUTC_PLAY_H

#include <stdio.h>

#define SPROUTC_EXIT_NOT_YET 3

/* The command, over `argv` after the program name; the exit code. */
int sproutc_main(int argc, char **argv, FILE *out, FILE *err);

#endif
