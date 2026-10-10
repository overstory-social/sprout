/* The `sproutc eval` command; see evaluate.h. */
#include "evaluate.h"

#include <stdlib.h>
#include <string.h>

#include "eval.h"
#include "host.h"

#define USAGE                                                                                       \
  "sproutc: write `sproutc eval <world.sproutworld> --state save.json --node N --self ID\n"        \
  "         [--library NAME] [--bind name=ID] [--seed N] [--steps N]`. --node is the number of the\n" \
  "         expression's entry in the cartridge's graph; --self is the object whose body it is.\n"

#define MAX_BINDINGS 16

typedef struct options {
  const char *world, *state, *self, *library;
  long node;
  bool has_seed, has_steps;
  uint64_t seed, steps;
  size_t bind_count;
  const char *bind_name[MAX_BINDINGS];
  const char *bind_id[MAX_BINDINGS];
  char bind_names[MAX_BINDINGS][64];
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
  o->node = -1;
  if (argc < 1) return "write `sproutc eval <world.sproutworld>`.";
  o->world = argv[0];
  for (i = 1; i < argc; i++) {
    const char *flag = argv[i];
    uint64_t number;
    if (i + 1 >= argc) {
      snprintf(words, size, "%s wants a value after it.", flag);
      return words;
    }
    if (strcmp(flag, "--state") == 0) o->state = argv[++i];
    else if (strcmp(flag, "--self") == 0) o->self = argv[++i];
    else if (strcmp(flag, "--library") == 0) o->library = argv[++i];
    else if (strcmp(flag, "--node") == 0 || strcmp(flag, "--seed") == 0 || strcmp(flag, "--steps") == 0) {
      if (!whole_number(argv[i + 1], &number)) {
        snprintf(words, size, "%s wants a whole number after it, as in `%s 5`.", flag, flag);
        return words;
      }
      if (strcmp(flag, "--node") == 0) o->node = (long)number;
      else if (strcmp(flag, "--seed") == 0) o->has_seed = true, o->seed = number;
      else o->has_steps = true, o->steps = number;
      i++;
    } else if (strcmp(flag, "--bind") == 0) {
      const char *equals = strchr(argv[i + 1], '=');
      size_t n = equals == NULL ? 0 : (size_t)(equals - argv[i + 1]);
      if (equals == NULL || n == 0 || n >= sizeof o->bind_names[0] || o->bind_count == MAX_BINDINGS) {
        snprintf(words, size, "--bind wants `name=id` after it, as in `--bind actor=shop#1`.");
        return words;
      }
      memcpy(o->bind_names[o->bind_count], argv[i + 1], n);
      o->bind_name[o->bind_count] = o->bind_names[o->bind_count];
      o->bind_id[o->bind_count++] = equals + 1;
      i++;
    } else {
      snprintf(words, size, "`%s` is not something `sproutc eval` takes.", flag);
      return words;
    }
  }
  if (o->state == NULL || o->self == NULL || o->node < 0) return "write --state, --node and --self.";
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
  bytes[size] = '\0';
  *length = (size_t)size;
  return bytes;
}

/* What an evaluation ended in, printed; the exit code. */
static int report(const sprout_frame *frame, sprout_eval_status status, const sprout_evaluated *result, FILE *out,
                  FILE *err) {
  const char *bytes;
  size_t length;
  switch (status) {
    case SPROUT_EVAL_OK:
      if (sprout_eval_show(frame, result, &bytes, &length) != SPROUT_EVAL_OK) {
        fprintf(err, "sproutc: the result could not be printed.\n");
        return SPROUTC_EXIT_USAGE;
      }
      fprintf(out, "%.*s\nsteps %llu\n", (int)length, bytes, (unsigned long long)frame->meter->steps);
      return 0;
    case SPROUT_EVAL_FAULT:
      fprintf(out, "fault %s: %s\nsteps %llu\n", frame->fault->name, frame->fault->text,
              (unsigned long long)frame->meter->steps);
      return SPROUTC_EXIT_FAULT;
    case SPROUT_EVAL_ENGINE:
      fprintf(err, "sproutc: engine error: %s\n", frame->fault->text);
      return SPROUTC_EXIT_USAGE;
    case SPROUT_EVAL_NO_MEMORY:
      break;
  }
  fprintf(err, "sproutc: the host could not give the evaluation any more memory.\n");
  return SPROUTC_EXIT_USAGE;
}

int sproutc_evaluate(int argc, char **argv, FILE *out, FILE *err) {
  options o;
  char words[200];
  const char *why;
  unsigned char *cartridge, *saved;
  size_t cartridge_length = 0, saved_length = 0, i;
  sproutc_host host;
  sprout_world *world = NULL;
  sprout_state *state = NULL;
  sprout_refusal refusal;
  sprout_status status;
  sprout_arena turn;
  sprout_draft draft;
  sprout_meter meter;
  sprout_draws draws;
  sprout_eval_fault fault;
  sprout_frame frame;
  sprout_evaluated result;
  int code;

  why = options_of(argc, argv, &o, words, sizeof words);
  if (why != NULL) {
    fprintf(err, "%s\n%s", why, USAGE);
    return SPROUTC_EXIT_USAGE;
  }
  cartridge = file_bytes(o.world, &cartridge_length);
  saved = file_bytes(o.state, &saved_length);
  if (cartridge == NULL || saved == NULL) {
    fprintf(err, "sproutc: cannot read %s.\n", cartridge == NULL ? o.world : o.state);
    free(cartridge);
    free(saved);
    return SPROUTC_EXIT_USAGE;
  }
  sproutc_host_init(&host, out, NULL);
  if (o.has_steps) host.record.budgets.steps = (sprout_limit){true, o.steps};
  status = sprout_load_explained(&host.record, (const char *)cartridge, cartridge_length, &world, &refusal);
  if (status == SPROUT_OK) status = sprout_state_read(&host.record, (const char *)saved, saved_length, &state, &refusal);
  if (status == SPROUT_OK) status = sprout_state_open(state, world, NULL, &refusal);
  if (status != SPROUT_OK) {
    fprintf(err, "sproutc: %s\n", status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
    code = SPROUTC_EXIT_USAGE;
    goto done;
  }
  if (o.node < 0 || (size_t)o.node >= world->graph.count) {
    fprintf(err, "sproutc: the cartridge's graph has %zu entries, and there is no entry %ld.\n", world->graph.count,
            o.node);
    code = SPROUTC_EXIT_USAGE;
    goto done;
  }
  if (sprout_arena_init(&turn, &host.record) != SPROUT_OK || sprout_draft_open(&draft, &turn, world, state) != SPROUT_DRAFT_OK) {
    fprintf(err, "sproutc: the host could not give the turn a page.\n");
    code = SPROUTC_EXIT_USAGE;
    goto done;
  }
  sprout_meter_begin(&meter, &host.record, SPROUT_TURN_COMMAND);
  memset(&frame, 0, sizeof frame);
  memset(&fault, 0, sizeof fault);
  frame.world = world;
  frame.draft = &draft;
  frame.turn = &turn;
  frame.meter = &meter;
  frame.self = (sprout_str){o.self, strlen(o.self)};
  frame.library = o.library != NULL ? o.library : world->header.name;
  frame.fault = &fault;
  if (o.has_seed) {
    if (sprout_draws_begin(&draws, o.seed) != SPROUT_OK) {
      fprintf(err, "sproutc: a seed is a whole number from 0 to 4294967295.\n");
      code = SPROUTC_EXIT_USAGE;
      goto done;
    }
    frame.draws = &draws;
  }
  for (i = 0; i < o.bind_count; i++) {
    const sprout_binding *bound = sprout_bind(&frame, o.bind_name[i], sprout_evaluated_object((sprout_str){o.bind_id[i], strlen(o.bind_id[i])}));
    if (bound == NULL) {
      fprintf(err, "sproutc: the host could not give the turn a page.\n");
      code = SPROUTC_EXIT_USAGE;
      goto done;
    }
    frame.bindings = bound;
  }
  code = report(&frame, sprout_eval(&frame, &world->graph.entries[o.node], &result), &result, out, err);
  sprout_arena_reset(&turn);
done:
  if (state != NULL) sprout_state_free(state);
  if (world != NULL) sprout_world_free(world);
  sproutc_host_close(&host);
  free(cartridge);
  free(saved);
  return code;
}
