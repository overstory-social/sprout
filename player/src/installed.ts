import { MEDIA, type Extension } from '@overstory/sprout/lang';

// The extensions a host built from this package installs (the spec's The
// host contract › Two decisions: installing one is the host's safety
// decision). `media` is installed at major 1: a text client shows its
// transcript line, and a client that draws reads its payload.

/** The extensions the CLI, the player, the server and the language server install. */
export const INSTALLED_EXTENSIONS: readonly Extension[] = [MEDIA];
