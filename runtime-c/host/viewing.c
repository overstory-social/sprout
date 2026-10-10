/* The `sproutc view` command; see viewing.h. */
#include "viewing.h"

#include <stdlib.h>
#include <string.h>

#include "chips.h"
#include "host.h"
#include "state.h"
#include "view.h"
#include "view_json.h"

#define USAGE                                                                                         \
  "sproutc: write `sproutc view <world.sproutworld> --state save.json [--visit KEY] [--poll-steps N]\n" \
  "         [--json]`. --visit names the visit to poll (default `inspector`).\n"

#define EXIT_FAULT 1
#define EXIT_USAGE 2

typedef struct options {
  const char *world, *state, *visit;
  bool json, has_steps;
  uint64_t steps;
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
  o->visit = "inspector";
  if (argc < 1) return "write `sproutc view <world.sproutworld> --state save.json`.";
  o->world = argv[0];
  for (i = 1; i < argc; i++) {
    const char *flag = argv[i];
    if (strcmp(flag, "--json") == 0) {
      o->json = true;
    } else if (strcmp(flag, "--state") == 0 || strcmp(flag, "--visit") == 0 || strcmp(flag, "--poll-steps") == 0) {
      if (i + 1 >= argc) {
        snprintf(words, size, "%s wants a value after it.", flag);
        return words;
      }
      if (strcmp(flag, "--state") == 0) o->state = argv[++i];
      else if (strcmp(flag, "--visit") == 0) o->visit = argv[++i];
      else if (!whole_number(argv[i + 1], &o->steps)) {
        snprintf(words, size, "--poll-steps wants a whole number after it, as in `--poll-steps 200`.");
        return words;
      } else {
        o->has_steps = true;
        i++;
      }
    } else {
      snprintf(words, size, "`%s` is not something `sproutc view` takes.", flag);
      return words;
    }
  }
  if (o->state == NULL) return "write --state, the stored world the visitor stands in.";
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

/* An id as an author writes it in the world's body: its path under the world, or the id itself. */
static void put_path(FILE *out, sprout_str world, sprout_str id) {
  bool minted = memchr(id.bytes, '#', id.length) != NULL;
  if (!minted && id.length > world.length + 1 && memcmp(id.bytes, world.bytes, world.length) == 0 &&
      id.bytes[world.length] == '.')
    fprintf(out, "%.*s", (int)(id.length - world.length - 1), id.bytes + world.length + 1);
  else
    fprintf(out, "%.*s", (int)id.length, id.bytes);
}

static void put_exit(FILE *out, sprout_str world, const sprout_seen_exit *exit) {
  if (exit->direction == NULL) fprintf(out, "link \"%s\" -> ", exit->label);
  else fprintf(out, "exit %s \"%s\" -> ", exit->direction, exit->label);
  put_path(out, world, exit->to);
}

static void put_thing(FILE *out, sprout_str world, const sprout_seen_thing *thing) {
  fprintf(out, "%.*s (", (int)thing->name.length, thing->name.bytes);
  put_path(out, world, thing->id);
  fputc(')', out);
}

static void put_number(FILE *out, double number) { fprintf(out, "%lld", (long long)number); }

static void put_options(FILE *out, const sprout_seen_options *options) {
  size_t i;
  fprintf(out, "  %s: ", options->role);
  if (options->symbol) {
    if (options->option_count == 0) fputs("nothing it hears", out);
    for (i = 0; i < options->option_count; i++) {
      if (i > 0) fputs(", ", out);
      fprintf(out, "%.*s", (int)options->options[i].words.length, options->options[i].words.bytes);
    }
  } else {
    if (options->range_count == 0) fputs("nothing it hears", out);
    for (i = 0; i < options->range_count; i++) {
      if (i > 0) fputs(", ", out);
      put_number(out, options->ranges[i].min);
      if (options->ranges[i].max != options->ranges[i].min) {
        fputs(" to ", out);
        put_number(out, options->ranges[i].max);
      }
    }
  }
  fputc('\n', out);
}

/* Whether a filler is a value role, whose options are written beside the reading instead. */
static bool value_role(const sprout_seen_reading *reading, const sprout_seen_filler *filler) {
  size_t i;
  if (filler->binds != SPROUT_SEEN_UNBOUND) return false;
  for (i = 0; i < reading->options_count; i++)
    if (strcmp(reading->options[i].role, filler->role) == 0) return true;
  return false;
}

static void put_filler(FILE *out, sprout_str world, const sprout_seen_filler *filler) {
  size_t i;
  fprintf(out, "  %s: ", filler->role);
  switch (filler->binds) {
    case SPROUT_SEEN_OBJECT:
      put_thing(out, world, &filler->thing);
      break;
    case SPROUT_SEEN_SET:
      for (i = 0; i < filler->member_count; i++) {
        if (i > 0) fputs(", ", out);
        put_thing(out, world, &filler->members[i]);
      }
      break;
    case SPROUT_SEEN_EXIT:
      put_exit(out, world, &filler->exit);
      break;
    case SPROUT_SEEN_UNBOUND:
      fputs("unbound", out);
      break;
  }
  fputc('\n', out);
}

static void put_reading(FILE *out, sprout_str world, const sprout_seen_reading *reading) {
  size_t i;
  fprintf(out, "  %.*s  (%s)\n", (int)reading->typed.length, reading->typed.bytes, reading->verb);
  for (i = 0; reading->refused && i < reading->refusal_count; i++)
    fprintf(out, "    refused: %.*s\n", (int)reading->refusal[i].length, reading->refusal[i].bytes);
  for (i = 0; i < reading->filler_count; i++) {
    if (value_role(reading, &reading->fillers[i])) continue;
    fputs("  ", out);
    put_filler(out, world, &reading->fillers[i]);
  }
  for (i = 0; i < reading->options_count; i++) {
    fputs("  ", out);
    put_options(out, &reading->options[i]);
  }
}

/* The page `sprout view` prints: one section after another, a blank line between. */
static void put_page(FILE *out, sprout_str world, sprout_str place, const sprout_seen_view *view) {
  size_t i;
  fputs("standing in ", out);
  put_path(out, world, place);
  fputs("\n\ndescription\n", out);
  if (view->description_count == 0) fputs("  (it renders nothing)\n", out);
  for (i = 0; i < view->description_count; i++)
    fprintf(out, "  %.*s\n", (int)view->description[i].length, view->description[i].bytes);
  if (view->effect_count > 0) fputs("\neffects\n", out);
  for (i = 0; i < view->effect_count; i++) {
    const sprout_seen_effect *effect = &view->effects[i];
    fprintf(out, "  %s.%s %.*s reads %.*s\n", effect->extension, effect->statement, (int)effect->payload.length,
            effect->payload.bytes, (int)effect->transcript.length, effect->transcript.bytes);
  }
  fputs("\nways out\n", out);
  if (view->exit_count == 0) fputs("  none\n", out);
  for (i = 0; i < view->exit_count; i++) {
    fputs("  ", out);
    put_exit(out, world, &view->exits[i]);
    fputc('\n', out);
  }
  fputs("\nwho else is here\n", out);
  if (view->occupant_count == 0) fputs("  nobody\n", out);
  for (i = 0; i < view->occupant_count; i++) {
    fputs("  ", out);
    put_thing(out, world, &view->occupants[i]);
    fputc('\n', out);
  }
  fputs("\ncarrying\n", out);
  if (view->carried_count == 0) fputs("  nothing\n", out);
  for (i = 0; i < view->carried_count; i++) {
    fputs("  ", out);
    put_thing(out, world, &view->carried[i]);
    fputc('\n', out);
  }
  fputs("\nwhat they could type\n", out);
  if (view->reading_count == 0) fputs("  nothing\n", out);
  for (i = 0; i < view->reading_count; i++) put_reading(out, world, &view->readings[i]);
}

/* The view's canonical JSON, then the chip tree over it. */
static int put_json(sprout_seen_view *view, FILE *out, FILE *err) {
  sprout_chip_tree tree;
  sprout_arena *arena = sprout_view_arena(view);
  const char *bytes, *chips;
  size_t length, chips_length;
  sprout_json *json;
  if (sprout_view_json(view, &bytes, &length) != SPROUT_OK || sprout_chip_tree_of(arena, view, &tree) != SPROUT_OK ||
      (json = sprout_chip_tree_json(arena, &tree)) == NULL || sprout_json_write(arena, json, &chips, &chips_length) != SPROUT_OK) {
    fprintf(err, "sproutc: the view could not be written out.\n");
    return EXIT_USAGE;
  }
  fprintf(out, "%.*s\n%.*s\n", (int)length, bytes, (int)chips_length, chips);
  return 0;
}

int sproutc_view(int argc, char **argv, FILE *out, FILE *err) {
  options o;
  char words[200];
  const char *why;
  unsigned char *cartridge, *saved;
  size_t cartridge_length = 0, saved_length = 0;
  sproutc_host host;
  sprout_world *world = NULL;
  sprout_state *state = NULL;
  sprout_refusal refusal;
  sprout_status status;
  sprout_seen_view view;
  sprout_str world_id, place = {NULL, 0};
  int code = 0;

  why = options_of(argc, argv, &o, words, sizeof words);
  if (why != NULL) {
    fprintf(err, "%s\n%s", why, USAGE);
    return EXIT_USAGE;
  }
  cartridge = file_bytes(o.world, &cartridge_length);
  saved = file_bytes(o.state, &saved_length);
  if (cartridge == NULL || saved == NULL) {
    fprintf(err, "sproutc: cannot read %s.\n", cartridge == NULL ? o.world : o.state);
    free(cartridge);
    free(saved);
    return EXIT_USAGE;
  }
  sproutc_host_init(&host, out, NULL);
  if (o.has_steps) host.record.budgets.poll_steps = (sprout_limit){true, o.steps};
  status = sprout_load_explained(&host.record, (const char *)cartridge, cartridge_length, &world, &refusal);
  if (status == SPROUT_OK) status = sprout_state_read(&host.record, (const char *)saved, saved_length, &state, &refusal);
  if (status == SPROUT_OK) status = sprout_state_open(state, world, NULL, &refusal);
  if (status != SPROUT_OK) {
    fprintf(err, "sproutc: %s\n", status == SPROUT_BAD_INPUT ? refusal.text : sprout_status_text(status));
    code = EXIT_USAGE;
    goto done;
  }
  world_id = state->world;
  status = sprout_view(world, state, &host.record, o.visit, &view);
  if (status != SPROUT_OK) {
    fprintf(err, "sproutc: %s\n", status == SPROUT_BAD_INPUT ? view.fault.text : sprout_status_text(status));
    code = EXIT_USAGE;
    goto done;
  }
  {
    const sprout_stored_visitor *visitor = sprout_state_find_visitor(state, (sprout_str){o.visit, strlen(o.visit)});
    const sprout_stored_instance *person = visitor == NULL ? NULL : sprout_state_find(state, visitor->instance);
    if (person != NULL && person->has_container) place = person->container;
  }
  if (o.json) code = put_json(&view, out, err);
  else put_page(out, world_id, place, &view);
  if (view.faulted && code == 0) {
    fputc('\n', out);
    fputs("the poll faulted, against ", out);
    put_path(out, world_id, view.fault_object);
    fprintf(out, ", %s: %s\n", view.fault_name, view.fault.text);
    code = EXIT_FAULT;
  }
  sprout_view_free(&view);
done:
  if (state != NULL) sprout_state_free(state);
  if (world != NULL) sprout_world_free(world);
  free(cartridge);
  free(saved);
  sproutc_host_close(&host);
  return code;
}
