/* Fixed-buffer text building; see text.h. */
#include "text.h"

void text_begin(text_buffer *buffer, char *bytes, size_t size) {
  buffer->bytes = bytes;
  buffer->size = size;
  buffer->length = 0;
  if (size > 0) bytes[0] = '\0';
}

void text_add(text_buffer *buffer, const char *text) {
  if (buffer->size == 0) return;
  while (*text != '\0' && buffer->length + 1 < buffer->size) buffer->bytes[buffer->length++] = *text++;
  buffer->bytes[buffer->length] = '\0';
}

void text_add_number(text_buffer *buffer, uint64_t number) {
  char digits[24];
  size_t count = sizeof digits;
  digits[--count] = '\0';
  do {
    digits[--count] = (char)('0' + (int)(number % 10));
    number /= 10;
  } while (number > 0);
  text_add(buffer, digits + count);
}
