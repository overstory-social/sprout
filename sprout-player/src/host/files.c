/* Whole files over the Playdate's filesystem; see files.h. */
#include "files.h"

#include <stdint.h>
#include <string.h>

#include "seeds.h"
#include "stack.h"

#define CHUNK 4096u
#define TEMP_PATH 256u

void *player_alloc(PlaydateAPI *pd, size_t bytes) { return pd->system->realloc(NULL, bytes); }

void player_free(PlaydateAPI *pd, void *block) {
  if (block != NULL) pd->system->realloc(block, 0);
}

static char *read_from(PlaydateAPI *pd, const char *path, size_t *length) {
  SDFile *file = pd->file->open(path, kFileRead | kFileReadData);
  char *bytes;
  size_t held = 0, capacity = CHUNK;
  if (file == NULL) return NULL;
  bytes = (char *)player_alloc(pd, capacity + 1);
  while (bytes != NULL) {
    int got;
    if (capacity - held < CHUNK) {
      char *bigger = (char *)pd->system->realloc(bytes, capacity * 2 + 1);
      if (bigger == NULL) {
        player_free(pd, bytes);
        bytes = NULL;
        break;
      }
      bytes = bigger;
      capacity *= 2;
    }
    got = pd->file->read(file, bytes + held, CHUNK);
    if (got < 0) {
      player_free(pd, bytes);
      bytes = NULL;
      break;
    }
    if (got == 0) break;
    held += (size_t)got;
  }
  pd->file->close(file);
  if (bytes == NULL) return NULL;
  bytes[held] = '\0';
  *length = held;
  return bytes;
}

static bool temp_path_of(const char *path, char *temp) {
  size_t n = strlen(path);
  if (n + 5 > TEMP_PATH) return false;
  memcpy(temp, path, n);
  memcpy(temp + n, ".tmp", 5);
  return true;
}

typedef struct file_call {
  PlaydateAPI *pd;
  const char *path;
  size_t *length;
  const char *bytes;
  size_t count;
  unsigned char *digest;
  void (*found)(const char *name, void *ctx);
  void *found_ctx;
} file_call;

static char *read_file_direct(PlaydateAPI *pd, const char *path, size_t *length) {
  char temp[TEMP_PATH];
  char *bytes = read_from(pd, path, length);
  if (bytes != NULL || !temp_path_of(path, temp)) return bytes;
  return read_from(pd, temp, length);
}

static bool hash_from(PlaydateAPI *pd, const char *path, unsigned char digest[32], size_t *length) {
  SDFile *file = pd->file->open(path, kFileRead | kFileReadData);
  sprout_sha256_context hash;
  char chunk[CHUNK];
  size_t total = 0;
  int got;
  if (file == NULL) return false;
  sprout_sha256_begin(&hash);
  while ((got = pd->file->read(file, chunk, CHUNK)) > 0) {
    sprout_sha256_feed(&hash, chunk, (size_t)got);
    total += (size_t)got;
  }
  pd->file->close(file);
  if (got < 0) return false;
  sprout_sha256_end(&hash, digest);
  *length = total;
  return true;
}

static bool hash_file_direct(PlaydateAPI *pd, const char *path, unsigned char digest[32], size_t *length) {
  char temp[TEMP_PATH];
  if (hash_from(pd, path, digest, length)) return true;
  return temp_path_of(path, temp) && hash_from(pd, temp, digest, length);
}

static bool write_file_direct(PlaydateAPI *pd, const char *path, const char *bytes, size_t length) {
  char temp[TEMP_PATH];
  SDFile *file;
  bool whole;
  if (!temp_path_of(path, temp)) return false;
  file = pd->file->open(temp, kFileWrite);
  if (file == NULL) return false;
  whole = pd->file->write(file, bytes, (unsigned)length) == (int)length;
  whole = pd->file->close(file) == 0 && whole;
  if (!whole) return false;
  pd->file->unlink(path, 0);
  return pd->file->rename(temp, path) == 0;
}

/* ---- the main stack: the firmware's file system is called there (stack.h) ---- */

static void *read_thunk(void *ctx) {
  file_call *c = (file_call *)ctx;
  return read_file_direct(c->pd, c->path, c->length);
}
static void *hash_thunk(void *ctx) {
  file_call *c = (file_call *)ctx;
  return (void *)(intptr_t)hash_file_direct(c->pd, c->path, c->digest, c->length);
}
static void *write_thunk(void *ctx) {
  file_call *c = (file_call *)ctx;
  return (void *)(intptr_t)write_file_direct(c->pd, c->path, c->bytes, c->count);
}

static void *list_thunk(void *ctx) {
  file_call *c = (file_call *)ctx;
  return (void *)(intptr_t)(c->pd->file->listfiles(c->path, c->found, c->found_ctx, 0) == 0);
}

char *player_read_file(PlaydateAPI *pd, const char *path, size_t *length) {
  file_call c = {pd, path, length, NULL, 0, NULL, NULL, NULL};
  return (char *)player_on_main_stack(read_thunk, &c);
}

bool player_hash_file(PlaydateAPI *pd, const char *path, unsigned char digest[32], size_t *length) {
  file_call c = {pd, path, length, NULL, 0, digest, NULL, NULL};
  return (bool)(intptr_t)player_on_main_stack(hash_thunk, &c);
}

bool player_write_file(PlaydateAPI *pd, const char *path, const char *bytes, size_t length) {
  file_call c = {pd, path, NULL, bytes, length, NULL, NULL, NULL};
  return (bool)(intptr_t)player_on_main_stack(write_thunk, &c);
}

bool player_list_files(PlaydateAPI *pd, const char *path, void (*found)(const char *name, void *ctx), void *ctx) {
  file_call c = {pd, path, NULL, NULL, 0, NULL, found, ctx};
  return (bool)(intptr_t)player_on_main_stack(list_thunk, &c);
}

/* ---- a file written a piece at a time ---- */

typedef struct piece_call {
  PlaydateAPI *pd;
  const char *path, *to;
  SDFile *file;
  const void *bytes;
  size_t length;
} piece_call;

/* Makes each folder `path` is in, outermost first; a folder that is there already is left as it is. */
static void make_folders(PlaydateAPI *pd, const char *path) {
  char folder[TEMP_PATH];
  size_t i;
  for (i = 0; path[i] != '\0' && i < sizeof folder; i++) {
    if (path[i] == '/' && i > 0) {
      folder[i] = '\0';
      pd->file->mkdir(folder);
    }
    folder[i] = path[i];
  }
}

static void *create_thunk(void *ctx) {
  piece_call *c = (piece_call *)ctx;
  make_folders(c->pd, c->path);
  return c->pd->file->open(c->path, kFileWrite);
}

static void *append_thunk(void *ctx) {
  piece_call *c = (piece_call *)ctx;
  return (void *)(intptr_t)(c->pd->file->write(c->file, c->bytes, (unsigned)c->length) == (int)c->length);
}

static void *close_thunk(void *ctx) {
  piece_call *c = (piece_call *)ctx;
  return (void *)(intptr_t)(c->pd->file->close(c->file) == 0);
}

static void *move_thunk(void *ctx) {
  piece_call *c = (piece_call *)ctx;
  c->pd->file->unlink(c->to, 0);
  return (void *)(intptr_t)(c->pd->file->rename(c->path, c->to) == 0);
}

static void *remove_thunk(void *ctx) {
  piece_call *c = (piece_call *)ctx;
  c->pd->file->unlink(c->path, 1);
  return NULL;
}

SDFile *player_file_create(PlaydateAPI *pd, const char *path) {
  piece_call c = {pd, path, NULL, NULL, NULL, 0};
  return (SDFile *)player_on_main_stack(create_thunk, &c);
}

bool player_file_append(PlaydateAPI *pd, SDFile *file, const void *bytes, size_t length) {
  piece_call c = {pd, NULL, NULL, file, bytes, length};
  return (bool)(intptr_t)player_on_main_stack(append_thunk, &c);
}

bool player_file_close(PlaydateAPI *pd, SDFile *file) {
  piece_call c = {pd, NULL, NULL, file, NULL, 0};
  return (bool)(intptr_t)player_on_main_stack(close_thunk, &c);
}

bool player_file_move(PlaydateAPI *pd, const char *from, const char *to) {
  piece_call c = {pd, from, to, NULL, NULL, 0};
  return (bool)(intptr_t)player_on_main_stack(move_thunk, &c);
}

void player_file_remove(PlaydateAPI *pd, const char *path) {
  piece_call c = {pd, path, NULL, NULL, NULL, 0};
  player_on_main_stack(remove_thunk, &c);
}

/* ---- what is there ---- */

static void *exists_thunk(void *ctx) {
  file_call *c = (file_call *)ctx;
  SDFile *file = c->pd->file->open(c->path, kFileRead | kFileReadData);
  if (file == NULL) return (void *)(intptr_t) false;
  c->pd->file->close(file);
  return (void *)(intptr_t) true;
}

static void *bitmap_thunk(void *ctx) {
  file_call *c = (file_call *)ctx;
  const char *error = NULL;
  return c->pd->graphics->loadBitmap(c->path, &error);
}

bool player_file_exists(PlaydateAPI *pd, const char *path) {
  file_call c = {pd, path, NULL, NULL, 0, NULL, NULL, NULL};
  return (bool)(intptr_t)player_on_main_stack(exists_thunk, &c);
}

LCDBitmap *player_load_bitmap(PlaydateAPI *pd, const char *path) {
  file_call c = {pd, path, NULL, NULL, 0, NULL, NULL, NULL};
  return (LCDBitmap *)player_on_main_stack(bitmap_thunk, &c);
}
