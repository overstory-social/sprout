#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "world.h"

static void *a(void *c, size_t n) { (void)c; return malloc(n); }
static void r(void *c, void *b, size_t n) { (void)c; (void)n; free(b); }

int main(int argc, char **argv) {
  FILE *f = fopen(argv[1], "rb");
  static char buf[1 << 24];
  size_t n = fread(buf, 1, sizeof buf, f);
  sprout_host host;
  sprout_world *w;
  size_t i, j;
  memset(&host, 0, sizeof host);
  host.page_bytes = 65536;
  host.alloc = a;
  host.release = r;
  if (sprout_load(&host, buf, n, &w) != SPROUT_OK) return 1;
  for (i = 0; i < w->kind_count && i < 3; i++) {
    const sprout_kind_def *k = w->kinds[i];
    for (j = 0; j < k->passage_count && j < 2; j++) {
      const sprout_node *node = k->passages[j].node;
      size_t t;
      printf("%s passage %s keys:", k->name, k->passages[j].name);
      for (t = 0; t < node->count; t++) printf(" %s(%d)", node->keys[t], node->items[t]->kind);
      printf("\n");
      {
        const sprout_node *at = sprout_node_get(node, "at");
        if (at) printf("  at kind %d file %ld line %ld col %ld\n", at->kind, at->file, at->line, at->column);
        {
          const sprout_node *body = sprout_node_get(node, "body");
          const sprout_node *prose = sprout_node_get(body, "prose");
          const sprout_node *pat = prose ? sprout_node_get(prose, "at") : NULL;
          if (pat) printf("  prose at kind %d file %ld line %ld col %ld\n", pat->kind, pat->file, pat->line, pat->column);
          if (prose) {
            size_t q;
            printf("  prose keys:");
            for (q = 0; q < prose->count; q++) printf(" %s", prose->keys[q]);
            printf("\n");
          }
        }
      }
    }
  }
  printf("files: %zu\n", w->graph.file_count);
  for (i = 0; i < w->graph.file_count; i++) printf("  %s\n", w->graph.files[i]);
  return 0;
}
