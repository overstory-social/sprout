/*
 * Building a sentence into a fixed buffer without stdio: the device's libc is not relied on for
 * formatting. Every function truncates rather than overruns and keeps the buffer NUL-terminated.
 */
#ifndef PLAYER_TEXT_H
#define PLAYER_TEXT_H

#include <stddef.h>
#include <stdint.h>

typedef struct text_buffer {
  char *bytes;
  size_t size;
  size_t length;
} text_buffer;

void text_begin(text_buffer *buffer, char *bytes, size_t size);
void text_add(text_buffer *buffer, const char *text);
void text_add_number(text_buffer *buffer, uint64_t number);

#endif
