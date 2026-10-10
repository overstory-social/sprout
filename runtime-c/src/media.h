/*
 * The `media` extension's behaviour in C (the spec's Extensions > What an extension may add): the
 * payload `media.show(image)` or `media.show(image, caption)` records, `{"image": …, "caption": …}`
 * with the caption left out where there is none, and the transcript line a client that cannot draw
 * reads: the caption, or the image's name in brackets. The compiler carries the extension's
 * definition; this reimplements its `run` and `transcript` for a runtime with no TypeScript.
 */
#ifndef SPROUT_MEDIA_H
#define SPROUT_MEDIA_H

#include "expr/expr.h"

/* The major version of `media` this runtime holds. */
#define SPROUT_MEDIA_MAJOR 1

/* Whether this runtime holds the extension `name` at `major`. */
bool sprout_media_holds(const char *name, long major);

/*
 * What `media.<statement>` records for its evaluated arguments: the payload as JSON text and the
 * transcript line, both in the turn's arena. Not a statement `media` declares, or arguments it
 * does not take, is the engine's defect (the checker refuses both).
 */
sprout_eval_status sprout_media_record(const sprout_frame *frame, const char *statement, size_t argument_count,
                                       const sprout_value *arguments, sprout_str *payload, sprout_str *transcript);

#endif
