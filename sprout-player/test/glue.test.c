#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bridge.h"
#include "fake_playdate.h"

int main(void) {
  static fake_playdate fake;
  char dir[] = "/tmp/claude-0/glue-XXXXXX";
  mkdtemp(dir);
  fake_init(&fake, dir, PLAYER_CARTRIDGES);
  player_register(&fake.api);
  printf("%s\n", fake_call(&fake, "sprout.inspect", "chip-tree.sproutworld"));
  printf("%s\n", fake_call(&fake, "sprout.open", "chip-tree.sproutworld"));
  printf("%s\n", fake_call(&fake, "sprout.load", NULL));
  printf("%s\n", fake_call(&fake, "sprout.admit", "Marta"));
  printf("%s\n", fake_call(&fake, "sprout.view", NULL));
  return 0;
}
