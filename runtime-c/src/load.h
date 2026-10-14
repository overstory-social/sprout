/*
 * The cartridge file (the spec's The compiler > What compiling produces;
 * Language levels): sixteen bytes, then a gzip-compressed body. The magic
 * `SPRT`, the format version and the language level as little-endian 16-bit
 * numbers, then the body's inflated size and the offset of its table in it
 * as 32-bit numbers. The body is a JSON preamble (what a shelf and the
 * catalogue read) and then, eight-aligned, the table of table.h. A runtime
 * refuses a format or a level newer than it reads, naming the number, in the
 * words the language's cartridge reader uses. The caps the cartridge records are the
 * publish record: a world runs under the host's caps, which are read at
 * every load.
 */
#ifndef SPROUT_LOAD_H
#define SPROUT_LOAD_H

#include "world.h"

#define SPROUT_CARTRIDGE_MAGIC "SPRT"
#define SPROUT_CARTRIDGE_FORMAT 4
#define SPROUT_CARTRIDGE_HEADER_BYTES 16
#define SPROUT_LANGUAGE_LEVEL 1

/*
 * What the sixteen bytes say, or SPROUT_BAD_INPUT with `refusal` worded for
 * whoever ran it: not a cartridge, a format or a level newer than this reads.
 * `body_bytes` and `table_at` are the body's inflated size and its table's offset.
 */
sprout_status sprout_cartridge_check_header(const unsigned char *bytes, size_t length, long *format, long *level,
                                            size_t *body_bytes, size_t *table_at, sprout_refusal *refusal);

#endif
