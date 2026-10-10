/*
 * `sproutc eval <world.sproutworld> --state save.json --node N --self ID
 * [--library NAME] [--bind name=ID]... [--seed N] [--steps N]`: evaluates
 * the expression held by entry N of the cartridge's graph, as the body of the
 * object ID, against a stored world, and prints the result in its canonical
 * form (see sprout_eval_show) on the first line and `steps N` on the second.
 * A fault prints `fault <Name>: <words>` and `steps N`, and exits 1; a
 * command line or an engine error exits 2 with its words on the error stream.
 */
#ifndef SPROUTC_EVALUATE_H
#define SPROUTC_EVALUATE_H

#include <stdio.h>

#define SPROUTC_EXIT_FAULT 1
#define SPROUTC_EXIT_USAGE 2

/* The command, over `argv` after the program name; the exit code. */
int sproutc_evaluate(int argc, char **argv, FILE *out, FILE *err);

#endif
