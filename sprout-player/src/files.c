/* Whole files over the Playdate's filesystem; see files.h. */
#include "files.h"

#include <string.h>

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

char *player_read_file(PlaydateAPI *pd, const char *path, size_t *length) {
  char temp[TEMP_PATH];
  char *bytes = read_from(pd, path, length);
  if (bytes != NULL || !temp_path_of(path, temp)) return bytes;
  return read_from(pd, temp, length);
}

bool player_write_file(PlaydateAPI *pd, const char *path, const char *bytes, size_t length) {
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
