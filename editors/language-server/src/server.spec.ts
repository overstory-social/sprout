import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import {
  createConnection,
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type ProtocolConnection,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver/node.js';

import { copiedWorld } from './fixtures/worlds.js';
import { serve } from './server.js';

// The server over a pair of streams, driven by a client that speaks the
// protocol and keeps every diagnostic it is sent.

interface Client {
  readonly connection: ProtocolConnection;
  /** The diagnostics each file was last given, by its URI. */
  readonly diagnostics: Map<string, PublishDiagnosticsParams['diagnostics']>;
  /** Resolves once `uri` has been given diagnostics `where` holds of. */
  published(
    uri: string,
    where: (diagnostics: PublishDiagnosticsParams['diagnostics']) => boolean,
  ): Promise<void>;
}

let open: ProtocolConnection[] = [];
afterEach(() => {
  for (const connection of open) connection.dispose();
  open = [];
});

async function started(): Promise<Client> {
  const up = new PassThrough();
  const down = new PassThrough();
  serve(createConnection(new StreamMessageReader(up), new StreamMessageWriter(down)), {
    debounce: 10,
  });
  const connection = createProtocolConnection(
    new StreamMessageReader(down),
    new StreamMessageWriter(up),
  );
  open.push(connection);
  const diagnostics = new Map<string, PublishDiagnosticsParams['diagnostics']>();
  const waiting = new Set<() => void>();
  connection.onNotification(
    'textDocument/publishDiagnostics',
    (params: PublishDiagnosticsParams) => {
      diagnostics.set(params.uri, params.diagnostics);
      for (const wake of waiting) wake();
    },
  );
  connection.listen();
  await connection.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {} });
  await connection.sendNotification('initialized', {});
  return {
    connection,
    diagnostics,
    published: (uri, where) =>
      new Promise((resolve) => {
        const wake = () => {
          const now = diagnostics.get(uri);
          if (now === undefined || !where(now)) return;
          waiting.delete(wake);
          resolve();
        };
        waiting.add(wake);
        wake();
      }),
  };
}

const uriOf = (path: string) => pathToFileURL(path).href;

describe('the language server', () => {
  it('checks the whole world on an edit, then clears what the next edit fixes', async () => {
    const root = copiedWorld('imports');
    const chest = join(root, 'things', 'chest.sprout');
    const text = readFileSync(chest, 'utf8');
    const client = await started();
    await client.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: uriOf(chest),
        languageId: 'sprout',
        version: 1,
        text: text.replace('is Container', 'is Contaner'),
      },
    });
    await client.published(uriOf(chest), (now) => now.length > 0);
    expect(client.diagnostics.get(uriOf(chest))).toEqual([
      {
        range: { start: { line: 2, character: 14 }, end: { line: 2, character: 22 } },
        severity: 1,
        source: 'sprout',
        message:
          'Nothing here is a `Contaner`. Did you mean `Container`?\nWrite `Container`, or declare `Contaner` with `kind Contaner { … }`.',
      },
    ]);
    await client.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: uriOf(chest), version: 2 },
      contentChanges: [{ text }],
    });
    await client.published(uriOf(chest), (now) => now.length === 0);
  });

  it('reads a file closed unsaved from disk again', async () => {
    const root = copiedWorld('imports');
    const chest = join(root, 'things', 'chest.sprout');
    const client = await started();
    await client.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: uriOf(chest), languageId: 'sprout', version: 1, text: 'kind {' },
    });
    await client.published(uriOf(chest), (now) => now.length > 0);
    await client.connection.sendNotification('textDocument/didClose', {
      textDocument: { uri: uriOf(chest) },
    });
    await client.published(uriOf(chest), (now) => now.length === 0);
  });

  it('puts a refusal an edit to one file causes on the file it names', async () => {
    const root = copiedWorld('imports');
    const chest = join(root, 'things', 'chest.sprout');
    const client = await started();
    // Renaming the kind leaves `imports.sprout` importing a name its file no longer declares.
    await client.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: uriOf(chest),
        languageId: 'sprout',
        version: 1,
        text: readFileSync(chest, 'utf8').replace('kind Chest', 'kind Coffer'),
      },
    });
    const main = uriOf(join(root, 'imports.sprout'));
    await client.published(main, (now) => now.length > 0);
    expect(client.diagnostics.get(main)![0]!.message).toContain('Chest');
  });

  it('answers hover, go-to-definition and completion from the world’s declarations', async () => {
    const root = copiedWorld('imports');
    const main = join(root, 'imports.sprout');
    const text = readFileSync(main, 'utf8');
    const client = await started();
    await client.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: uriOf(main), languageId: 'sprout', version: 1, text },
    });
    const lines = text.split('\n');
    const boxLine = lines.findIndex((line) => line.includes('object box is Box'));
    const position = { line: boxLine, character: lines[boxLine]!.indexOf('Box') + 1 };
    const textDocument = { uri: uriOf(main) };

    const hover = await client.connection.sendRequest('textDocument/hover', {
      textDocument,
      position,
    });
    expect(hover).toEqual({
      contents: {
        kind: 'markdown',
        value: '```sprout\nkind Chest is Container\n```\nkind, things/chest.sprout:3',
      },
    });

    const definition = await client.connection.sendRequest('textDocument/definition', {
      textDocument,
      position,
    });
    expect(definition).toEqual([
      {
        uri: uriOf(join(root, 'things', 'chest.sprout')),
        range: { start: { line: 2, character: 5 }, end: { line: 2, character: 10 } },
      },
    ]);

    const placeLine = lines.findIndex((line) => line.includes('sprout.Place'));
    const completion = (await client.connection.sendRequest('textDocument/completion', {
      textDocument,
      position: { line: placeLine, character: lines[placeLine]!.indexOf('Place') },
    })) as { label: string; kind: number }[];
    expect(completion).toContainEqual({ label: 'Place', kind: 7, detail: 'kind' });
  });
});
