/*
 * Gzip (RFC 1952) over deflate (RFC 1951), enough to read a cartridge's JSON
 * in the desktop host. It reads stored, fixed and dynamic blocks and checks
 * the trailer's length and CRC-32; the output is malloc'd and NUL-terminated.
 * This is the host's, not the runtime's: the library calls nothing from libc.
 */
#ifndef SPROUTC_INFLATE_H
#define SPROUTC_INFLATE_H

#include <stddef.h>

/* Unpacks `length` bytes of gzip into *out (free it); NULL on success, or words for why not. */
const char *sproutc_gunzip(const unsigned char *bytes, size_t length, char **out, size_t *out_length);

/* The CRC-32 gzip's trailer holds, of `length` bytes. */
unsigned long sproutc_crc32(const unsigned char *bytes, size_t length);

#endif
