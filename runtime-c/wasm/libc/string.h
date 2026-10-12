/* The string functions the runtime calls, for a freestanding WebAssembly build (libc.c). */
#ifndef SPROUT_WASM_STRING_H
#define SPROUT_WASM_STRING_H
#include <stddef.h>
void *memcpy(void *to, const void *from, size_t n);
void *memmove(void *to, const void *from, size_t n);
void *memset(void *to, int byte, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);
int strcmp(const char *a, const char *b);
int strncmp(const char *a, const char *b, size_t n);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
#endif
