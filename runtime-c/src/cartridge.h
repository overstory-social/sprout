/*
 * The cartridge file (the spec's The compiler > What compiling produces;
 * Language levels): sixteen bytes, then gzip-compressed JSON. The magic
 * `SPRT`, the format version and the language level as little-endian 16-bit
 * numbers, and eight reserved zeros. A runtime refuses a format or a level
 * newer than it reads, naming the number, in the words the TypeScript loader
 * uses. The caps the cartridge records are the publish record: a world runs
 * under the host's caps, which are read at every load.
 */
#ifndef SPROUT_CARTRIDGE_H
#define SPROUT_CARTRIDGE_H

#include "world.h"

#define SPROUT_CARTRIDGE_MAGIC "SPRT"
#define SPROUT_CARTRIDGE_FORMAT 1
#define SPROUT_CARTRIDGE_HEADER_BYTES 16
#define SPROUT_LANGUAGE_LEVEL 1

/*
 * What the sixteen bytes say, or SPROUT_BAD_INPUT with `refusal` worded for
 * whoever ran it: not a cartridge, a format or a level newer than this reads.
 */
sprout_status sprout_cartridge_check_header(const unsigned char *bytes, size_t length, long *format,
                                      long *level, sprout_refusal *refusal);

#endif
