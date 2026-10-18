/*
 * A cartridge as the desktop host first sees it: its header (load.h) and the
 * `header` section of the preamble that follows (the spec's The compiler >
 * What compiling produces). Loading the rest is the runtime's.
 */
#ifndef SPROUTC_CARTRIDGE_H
#define SPROUTC_CARTRIDGE_H

#include <stdio.h>

#include "sprout.h"

/* What the header's first bytes say; NULL on success, or words for why the file is no cartridge. */
const char *sproutc_cartridge_prefix(const unsigned char *bytes, size_t length, unsigned *format,
                                     unsigned *level);

/*
 * Writes the prefix and the header section to `out`, one fact to a line:
 * format, language level, name, namespace, version, author, license, hash,
 * the files and the libraries. NULL on success, or words for what is wrong.
 */
const char *sproutc_cartridge_describe(FILE *out, const sprout_host *host, const unsigned char *bytes,
                                       size_t length);

#endif
