/* The fake's files: the Data folder and the app folder on the desktop's disk, and the log of the calls that change the Data folder; see fake_playdate.h. */
#include "fake.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static void joined(char *out, size_t size, const char *folder, const char *path) {
  snprintf(out, size, "%s/%s", folder, path);
}

/* Adds a line to the file log, while there is room for it. */
static void log_file(const char *verb, const char *a, const char *b) {
  size_t used = strlen(fake_current->file_log);
  snprintf(fake_current->file_log + used, sizeof fake_current->file_log - used, "%s %s%s%s\n", verb, a, b != NULL ? " " : "",
           b != NULL ? b : "");
}

SDFile *fake_open(const char *path, FileOptions mode) {
  char full[1100];
  FILE *file = NULL;
  if (mode & kFileWrite) {
    if (fake_current->fail_writes) return NULL;
    log_file("write", path, NULL);
    joined(full, sizeof full, fake_current->data, path);
    return fopen(full, "wb");
  }
  if (mode & kFileReadData) {
    joined(full, sizeof full, fake_current->data, path);
    file = fopen(full, "rb");
  }
  if (file == NULL && (mode & kFileRead)) {
    joined(full, sizeof full, fake_current->app, path);
    file = fopen(full, "rb");
  }
  return file;
}

int fake_close(SDFile *file) { return fclose((FILE *)file); }

int fake_read(SDFile *file, void *buffer, unsigned length) {
  fake_current->reads++;
  if (length > fake_current->read_largest) fake_current->read_largest = length;
  if (fake_current->fail_reads) return -1;
  return (int)fread(buffer, 1, length, (FILE *)file);
}

static int fake_seek(SDFile *file, int pos, int whence) {
  fake_current->seeks++;
  return fseek((FILE *)file, pos, whence);
}

static int fake_write(SDFile *file, const void *buffer, unsigned length) {
  return (int)fwrite(buffer, 1, length, (FILE *)file);
}

static int fake_mkdir(const char *path) {
  char full[1100];
  joined(full, sizeof full, fake_current->data, path);
  return mkdir(full, 0777);
}

static int fake_unlink(const char *path, int recursive) {
  char full[1100], command[1200];
  log_file("unlink", path, NULL);
  joined(full, sizeof full, fake_current->data, path);
  if (unlink(full) == 0) return 0;
  if (!recursive || strchr(full, '\'') != NULL) return -1;
  snprintf(command, sizeof command, "rm -rf '%s' 2>/dev/null", full);
  return system(command) == 0 ? 0 : -1;
}

static int fake_rename(const char *from, const char *to) {
  char a[1100], b[1100];
  log_file("rename", from, to);
  joined(a, sizeof a, fake_current->data, from);
  joined(b, sizeof b, fake_current->data, to);
  return rename(a, b);
}

static int fake_listfiles(const char *path, void (*callback)(const char *path, void *userdata), void *userdata,
                          int showhidden) {
  char full[1100], line[1200];
  const char *folders[2];
  int i, listed = 0;
  (void)showhidden;
  folders[0] = fake_current->app;
  folders[1] = fake_current->data;
  for (i = 0; i < 2; i++) {
    FILE *names;
    snprintf(full, sizeof full, "ls -1Ap '%s/%s' 2>/dev/null", folders[i], path);
    names = popen(full, "r");
    if (names == NULL) continue;
    while (fgets(line, sizeof line, names) != NULL) {
      line[strcspn(line, "\n")] = '\0';
      if (line[0] == '\0' || line[0] == '.') continue;
      callback(line, userdata);
      listed = 1;
    }
    if (pclose(names) == 0) listed = 1;
  }
  return listed ? 0 : -1;
}

void fake_install_files(fake_playdate *fake) {
  fake->file.open = fake_open;
  fake->file.close = fake_close;
  fake->file.read = fake_read;
  fake->file.seek = fake_seek;
  fake->file.write = fake_write;
  fake->file.mkdir = fake_mkdir;
  fake->file.unlink = fake_unlink;
  fake->file.rename = fake_rename;
  fake->file.listfiles = fake_listfiles;
}
