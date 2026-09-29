#!/usr/bin/env node
// The `sprout-language-server` command, over stdio (`--stdio`) or the
// transport an editor names on its command line. Built by `tsc` into dist/.
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';

import { serve } from '../dist/server.js';

serve(createConnection(ProposedFeatures.all));
