/*
 * `sproutc parse <world.sproutworld> --readings <file> [--each]`: the runtime's parser held to the TypeScript one, line by
 * line (the spec's Parsing; The runtime > Turns). For every command turn the readings file says the TypeScript
 * parser read words for, it opens the stored world the turn began from (the step before's, or the turn's own
 * `before`), and reads the turn's words as its visitor typed them, under the turn's seed and what the turn was
 * handed, through `sprout_parse`; then compares what it read with what the TypeScript parser read (`parsed`), as
 * JSON, field by field. A turn that read no words, a step a line planned, is counted apart.
 *
 * Output: the first difference, if any (with `--each`, a line for every turn compared, `agree: step S, turn T` or
 * `differ: ...`), and a last line `parsed: A agree, D differ, P planned`. Exit 0 when
 * every turn agrees, 1 when one differs, and 2 for a command line, a cartridge or a readings file that cannot be
 * read.
 */
#ifndef SPROUTC_PARSING_H
#define SPROUTC_PARSING_H

#include <stdio.h>

#include "json.h"

/* The command, over `argv` after the program name; the exit code. */
int sproutc_parse(int argc, char **argv, FILE *out, FILE *err);

/* `parsed` as the readings file keeps what the TypeScript parser read (player/src/parsed.ts), in `arena`; NULL when the host refuses a page. */
sprout_json *sproutc_parsed_json(sprout_arena *arena, const sprout_parsed *parsed);

/* Whether two trees are the same JSON: an object's members by name, whatever their order. */
bool sproutc_json_same(const sprout_json *a, const sprout_json *b);

#endif
