/*
 * `sproutc view <world.sproutworld> --state save.json [--visit KEY] [--poll-steps N] [--json | --scene |
 * --verb NAME]`: polls the view of a visitor in a stored world (the spec's The runtime > The view) and prints
 * it as `sprout view` does: the place the visitor stands in, its description, the ways out, who else is there,
 * what they carry, and every reading they could type with its refusal, what fills each of its roles and the
 * options of each value role. `--visit` names the visit (default `inspector`); `--json` prints the view's
 * canonical JSON and the chip tree over it instead. `--scene` polls the scene, the page with the verbs it
 * lists in place of the readings, and `--verb` one verb's readings, as `sprout view --scene` and `--verb` do.
 * A poll that faults is shown as the visitor would see it, then the fault, and exits 1; a command line or a
 * stored world that cannot be read, or a verb the world does not have, exits 2.
 */
#ifndef SPROUTC_VIEWING_H
#define SPROUTC_VIEWING_H

#include <stdio.h>

/* The command, over `argv` after the program name; the exit code. */
int sproutc_view(int argc, char **argv, FILE *out, FILE *err);

#endif
