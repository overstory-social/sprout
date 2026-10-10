/* The `sproutc play` command; see play.h. */
#include "play.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cartridge.h"
#include "evaluate.h"
#include "state.h"
#include "host.h"
#include "readings.h"
#include "script.h"
#include "viewing.h"

#define USAGE                                                                                          \
  "sproutc: write `sproutc play <world.sproutworld> [--state save.json] [--script script.json]\n"     \
  "         [--readings file] [--trace file] [--clock N]`. --clock N moves the fake clock on N\n"     \
  "         milliseconds at each read; --readings names the file `node scripts/resolve-script.mjs`\n" \
  "         wrote for the script; --trace names the file one line of the stored world and the log is\n" \
  "         written to after each step.\n"

typedef struct options {
  const char *world, *state, *script, *readings, *trace;
  uint64_t clock;
} options;

static bool whole_number(const char *text, uint64_t *out) {
  char *end;
  if (text[0] < '0' || text[0] > '9') return false;
  *out = strtoull(text, &end, 10);
  return *end == '\0';
}

/* NULL on success, or words for what is wrong with the command line. */
static const char *options_of(int argc, char **argv, options *o, char *words, size_t size) {
  int i;
  memset(o, 0, sizeof *o);
  if (argc < 2 || strcmp(argv[0], "play") != 0) return "write `sproutc play <world.sproutworld>`.";
  o->world = argv[1];
  for (i = 2; i < argc; i++) {
    const char *flag = argv[i];
    const char **slot = strcmp(flag, "--state") == 0     ? &o->state
                        : strcmp(flag, "--script") == 0   ? &o->script
                        : strcmp(flag, "--readings") == 0 ? &o->readings
                        : strcmp(flag, "--trace") == 0    ? &o->trace
                                                          : NULL;
    if (strcmp(flag, "--clock") == 0) {
      if (i + 1 >= argc || !whole_number(argv[i + 1], &o->clock)) {
        snprintf(words, size, "--clock wants a whole number of milliseconds after it, as in `--clock 5`.");
        return words;
      }
      i++;
    } else if (slot != NULL) {
      if (i + 1 >= argc) {
        snprintf(words, size, "%s wants a file after it.", flag);
        return words;
      }
      *slot = argv[++i];
    } else {
      snprintf(words, size, "`%s` is not something `sproutc play` takes.", flag);
      return words;
    }
  }
  return NULL;
}

static unsigned char *file_bytes(const char *path, size_t *length) {
  FILE *file = fopen(path, "rb");
  long size;
  unsigned char *bytes;
  if (file == NULL) return NULL;
  fseek(file, 0, SEEK_END);
  size = ftell(file);
  fseek(file, 0, SEEK_SET);
  bytes = (unsigned char *)malloc((size_t)size + 1);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size) {
    free(bytes);
    fclose(file);
    return NULL;
  }
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

/* `order.json` is read beside as `order.readings.json`. */
static const char *readings_path(const options *o, char *path, size_t size) {
  size_t n;
  if (o->readings != NULL) return o->readings;
  n = strlen(o->script);
  if (n > 5 && strcmp(o->script + n - 5, ".json") == 0) n -= 5;
  snprintf(path, size, "%.*s.readings.json", (int)n, o->script);
  return path;
}

/*
 * Reads the stored world the host holds, or starts a new world's, and opens it against the loaded world as
 * a load does; NULL on success, or words for why not.
 */
static char problem[400];
static const char *open_state(sproutc_host *host, const sprout_world *world, sprout_state **state, sprout_opened *report) {
  const char *bytes = NULL;
  size_t length = 0;
  sprout_refusal refusal;
  sprout_status status;
  *state = NULL;
  /* A store with nothing in it yet is a new world's: an empty one, reconciled below. */
  if (!host->record.read(host->record.ctx, "world", &bytes, &length))
    status = sprout_state_empty(&host->record, world->header.name, state);
  else
    status = sprout_state_read(&host->record, bytes, length, state, &refusal);
  if (status == SPROUT_OK) status = sprout_state_open(*state, world, report, &refusal);
  if (status != SPROUT_OK) {
    snprintf(problem, sizeof problem, "%s: %s", host->state == NULL ? "the store" : host->state,
             status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
    sprout_state_free(*state);
    *state = NULL;
    return problem;
  }
  return NULL;
}

/* Writes the state to the stored world; NULL on success, or words for why not. */
static const char *save_state(sproutc_host *host, sprout_state *state) {
  const char *written;
  size_t length;
  sprout_status status = sprout_state_write(state, &written, &length);
  if (status != SPROUT_OK) {
    snprintf(problem, sizeof problem, "%s: %s", host->state, sprout_status_text(status));
    return problem;
  }
  if (!host->record.write(host->record.ctx, "world", written, length)) {
    snprintf(problem, sizeof problem, "cannot write the stored world to %s.", host->state);
    return problem;
  }
  return NULL;
}

/* Reads the stored world, opens it, and writes it back; a save the runtime wrote comes back byte for byte. */
static const char *rewrite_state(sproutc_host *host, const sprout_world *world, FILE *out) {
  sprout_state *state;
  sprout_opened report;
  const char *why = open_state(host, world, &state, &report);
  if (why != NULL) return why;
  fprintf(out, "state: %zu instances, %zu visitors, %zu dormant, %zu dropped\n", state->instance_count,
          state->visitor_count, report.dormant_count, report.dropped_count);
  why = save_state(host, state);
  sprout_state_free(state);
  return why;
}

/* Plays the script over a state read from the store, or a new world's, and saves it where the store is. */
static int play(sproutc_host *host, sprout_world *world, const options *o, sproutc_readings *readings, FILE *out,
                FILE *err) {
  sprout_state *state;
  sprout_opened report;
  FILE *trace = NULL;
  const char *why = open_state(host, world, &state, &report);
  int code;
  if (why != NULL) {
    fprintf(err, "sproutc: %s\n", why);
    return 1;
  }
  if (o->trace != NULL) {
    trace = fopen(o->trace, "wb");
    if (trace == NULL) {
      fprintf(err, "sproutc: cannot write %s.\n", o->trace);
      sprout_state_free(state);
      return 1;
    }
  }
  code = sproutc_play_script(host, world, state, readings, out, err, trace);
  if (trace != NULL) fclose(trace);
  if (code == 0 && host->state != NULL) {
    why = save_state(host, state);
    if (why != NULL) {
      fprintf(err, "sproutc: %s\n", why);
      code = 1;
    }
  }
  sprout_state_free(state);
  return code;
}

int sproutc_main(int argc, char **argv, FILE *out, FILE *err) {
  options o;
  char words[200], path[1024];
  const char *why;
  unsigned char *bytes;
  size_t length = 0;
  sproutc_host host;
  sprout_world *world = NULL;
  sprout_status loaded;
  sprout_refusal refusal;
  sproutc_readings readings;
  int code = 0;

  if (argc > 0 && strcmp(argv[0], "eval") == 0) return sproutc_evaluate(argc - 1, argv + 1, out, err);
  if (argc > 0 && strcmp(argv[0], "view") == 0) return sproutc_view(argc - 1, argv + 1, out, err);
  why = options_of(argc, argv, &o, words, sizeof words);
  if (why != NULL) {
    fprintf(err, "%s\n%s", why, USAGE);
    return 2;
  }
  bytes = file_bytes(o.world, &length);
  if (bytes == NULL) {
    fprintf(err, "sproutc: cannot read %s.\n", o.world);
    return 1;
  }
  sproutc_host_init(&host, out, o.state);
  host.step_ms = o.clock;
  fprintf(out, "cartridge: %s\n", o.world);
  why = sproutc_cartridge_describe(out, &host.record, bytes, length);
  if (why != NULL) {
    fprintf(err, "sproutc: %s: %s\n", o.world, why);
    free(bytes);
    sproutc_host_close(&host);
    return 1;
  }
  loaded = sprout_load_explained(&host.record, (const char *)bytes, length, &world, &refusal);
  if (loaded != SPROUT_OK) {
    fprintf(err, "sproutc: %s: %s\n", o.world, loaded == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(loaded));
    free(bytes);
    sproutc_host_close(&host);
    return 1;
  }
  if (o.state != NULL && o.script == NULL) {
    why = rewrite_state(&host, world, out);
    if (why != NULL) {
      fprintf(err, "sproutc: %s\n", why);
      sprout_world_free(world);
      free(bytes);
      sproutc_host_close(&host);
      return 1;
    }
  }
  if (o.script != NULL) {
    why = sproutc_readings_open(&readings, &host.record, readings_path(&o, path, sizeof path));
    if (why != NULL) {
      fprintf(err, "sproutc: %s\n", why);
      code = 1;
    } else {
      code = play(&host, world, &o, &readings, out, err);
      sproutc_readings_close(&readings);
    }
  }
  sprout_world_free(world);
  free(bytes);
  sproutc_host_close(&host);
  return code;
}
