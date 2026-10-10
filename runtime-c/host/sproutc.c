/* The `sproutc` program; the command itself is play.c. */
#include <stdio.h>

#include "play.h"

int main(int argc, char **argv) { return sproutc_main(argc - 1, argv + 1, stdout, stderr); }
