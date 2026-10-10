/*
 * `sproutc play <world.sproutworld> [--state save.json] [--script script.json]
 * [--readings file] [--trace file] [--clock N]`: prints the cartridge's header
 * and manifest, loads it, and, given a script, plays the script's readings (see
 * readings.h) through the runtime's public API on the desktop host (host.h).
 *
 * Output: the header and manifest, then, with a script, a line `--- play`
 * and a block per step: `## step <index>: <typed line>` and under it each
 * line a reader read, `<nickname> (<kind>): <text>`. A call the runtime
 * refuses ends the play with `!! <words>` and exit code 1; any other
 * failure exits 1 with its words on the error stream. With `--trace file`
 * each step also writes one line there (see script.h).
 */
#ifndef SPROUTC_PLAY_H
#define SPROUTC_PLAY_H

#include <stdio.h>

/* The command, over `argv` after the program name; the exit code. */
int sproutc_main(int argc, char **argv, FILE *out, FILE *err);

#endif
