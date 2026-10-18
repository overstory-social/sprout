/*
 * The cartridge file (the spec's The compiler > What compiling produces;
 * Language levels): twenty-four bytes, a gzip-compressed body, then the
 * assets section (assets.h). The magic `SPRT`, the format version and the
 * language level as little-endian 16-bit numbers, then as 32-bit numbers the
 * body's inflated size, the offset of its table in it, where the assets
 * section begins in the file (where the compressed body ends) and its size.
 * The body is a JSON preamble (what a shelf and the catalogue read) and then,
 * eight-aligned, the table of table.h. A runtime refuses a format or a level
 * newer than it reads, naming the number, in the words the language's
 * cartridge reader uses. The caps the cartridge records are the publish
 * record: a world runs under the host's caps, which are read at every load.
 */
#ifndef SPROUT_LOAD_H
#define SPROUT_LOAD_H

#include "world.h"

#define SPROUT_CARTRIDGE_MAGIC "SPRT"
#define SPROUT_CARTRIDGE_FORMAT 5
#define SPROUT_CARTRIDGE_HEADER_BYTES 24
#define SPROUT_LANGUAGE_LEVEL 1

/* What a cartridge's header says, once checked. */
typedef struct sprout_cartridge_layout {
  long format, level;
  size_t body_bytes, table_at; /* the body's inflated size, and its table's offset in it */
  size_t assets_at, assets_bytes; /* where the assets section begins in the file, and its size */
} sprout_cartridge_layout;

/*
 * What the header says, or SPROUT_BAD_INPUT with `refusal` worded for whoever
 * ran it: not a cartridge, a format or a level other than this reads, or an
 * assets section that begins inside the header.
 */
sprout_status sprout_cartridge_check_header(const unsigned char *bytes, size_t length, sprout_cartridge_layout *layout,
                                            sprout_refusal *refusal);

#endif
