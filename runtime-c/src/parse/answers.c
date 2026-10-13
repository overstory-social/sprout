/*
 * What the engine says to a line it could not run as a reading (the spec's Parsing > When nothing matches; Verbs >
 * Carried roles, Exits; Prose > Engine lines): the engine's `cannot`, `not_carrying`, `no_way`, `not_here` or
 * `unknown`, found as every engine line is, with `actor` and `here` bound, and `cannot` given the reading as far as
 * it was understood, `not_carrying` the thing in range not carried, `no_way` the direction written out; or the words
 * of an exit that refuses, said by its place with `actor` and `here` bound. No answer names what is out of range.
 * Nothing is rendered here, and nothing is copied: an answer's words and ids are its caller's.
 */
#include <string.h>

#include "parse.h"

static void standing(parse_answer *out, sprout_str actor, sprout_str here) {
  out->bindings[0].name = "actor";
  out->bindings[0].object = true;
  out->bindings[0].text = actor;
  out->bindings[1].name = "here";
  out->bindings[1].object = true;
  out->bindings[1].text = here;
  out->binding_count = 2;
}

void parse_answer_of(const sprout_frame *frame, const char *answer, sprout_str actor, sprout_str here,
                     const sprout_said_binding *given, parse_answer *out) {
  memset(out, 0, sizeof *out);
  out->answer = answer;
  sprout_engine_said(frame, answer, &actor, &here, &out->by, &out->said);
  standing(out, actor, here);
  if (given != NULL) out->bindings[out->binding_count++] = *given;
}

void parse_refused(const sprout_way *way, sprout_str actor, sprout_str here, parse_answer *out) {
  memset(out, 0, sizeof *out);
  out->answer = "refused";
  out->by = way->by;
  out->said = way->said;
  standing(out, actor, here);
}
