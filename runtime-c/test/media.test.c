/*
 * Tests for src/media.c (the spec's Extensions > What an extension may add): the payload
 * `media.show` records and the transcript line a client that cannot draw reads, as the compiler's
 * definition of `media` gives them. The runtime holds `media` at major 1 and nothing else.
 */
#include "eval_fixture.h"
#include "media.h"

/* `media.show` over the given text arguments, recorded in a turn of the bench. */
static sprout_eval_status shown(bench_turn *t, const char *image, const char *caption, sprout_str *payload,
                                sprout_str *transcript) {
  sprout_value arguments[2];
  CHECK(sprout_string(&t->turn, image, strlen(image), &arguments[0]));
  if (caption != NULL) CHECK(sprout_string(&t->turn, caption, strlen(caption), &arguments[1]));
  return sprout_media_record(&t->frame, "show", caption == NULL ? 1 : 2, arguments, payload, transcript);
}

static void the_runtime_holds_media_at_major_one_and_nothing_else(void) {
  CHECK(sprout_media_holds("media", 1));
  CHECK(!sprout_media_holds("media", 2));
  CHECK(!sprout_media_holds("slides", 1));
}

static void an_image_alone_records_its_name_and_reads_as_its_name_in_brackets(void) {
  bench b;
  bench_turn t;
  sprout_str payload, transcript;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(shown(&t, "cellar.png", NULL, &payload, &transcript), SPROUT_EVAL_OK);
  CHECK_BYTES(payload.bytes, payload.length, "{\"image\":\"cellar.png\"}");
  CHECK_BYTES(transcript.bytes, transcript.length, "[cellar.png]");
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_caption_is_recorded_after_the_name_and_is_what_a_text_client_reads(void) {
  bench b;
  bench_turn t;
  sprout_str payload, transcript;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(shown(&t, "pictures/cabinet.png", "an oak \"cabinet\"", &payload, &transcript), SPROUT_EVAL_OK);
  CHECK_BYTES(payload.bytes, payload.length, "{\"image\":\"pictures/cabinet.png\",\"caption\":\"an oak \\\"cabinet\\\"\"}");
  CHECK_BYTES(transcript.bytes, transcript.length, "an oak \"cabinet\"");
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_caption_with_no_words_is_left_out_as_the_compiled_definition_leaves_it(void) {
  bench b;
  bench_turn t;
  sprout_str payload, transcript;
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(shown(&t, "cellar.png", "", &payload, &transcript), SPROUT_EVAL_OK);
  CHECK_BYTES(payload.bytes, payload.length, "{\"image\":\"cellar.png\"}");
  CHECK_BYTES(transcript.bytes, transcript.length, "[cellar.png]");
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

static void a_statement_media_does_not_declare_or_arguments_it_does_not_take_are_the_engines_defect(void) {
  bench b;
  bench_turn t;
  sprout_str payload, transcript;
  sprout_value number = sprout_number(3);
  bench_open(&b);
  bench_turn_for(&b, &t, "get reads the property");
  CHECK_INT(sprout_media_record(&t.frame, "play", 1, &number, &payload, &transcript), SPROUT_EVAL_ENGINE);
  CHECK_INT(sprout_media_record(&t.frame, "show", 1, &number, &payload, &transcript), SPROUT_EVAL_ENGINE);
  CHECK_INT(sprout_media_record(&t.frame, "show", 0, &number, &payload, &transcript), SPROUT_EVAL_ENGINE);
  bench_turn_close(&t);
  bench_close(&b);
  CHECK_INT(b.heap.pages, 0);
}

int main(void) {
  RUN(the_runtime_holds_media_at_major_one_and_nothing_else);
  RUN(an_image_alone_records_its_name_and_reads_as_its_name_in_brackets);
  RUN(a_caption_is_recorded_after_the_name_and_is_what_a_text_client_reads);
  RUN(a_caption_with_no_words_is_left_out_as_the_compiled_definition_leaves_it);
  RUN(a_statement_media_does_not_declare_or_arguments_it_does_not_take_are_the_engines_defect);
  return REPORT();
}
