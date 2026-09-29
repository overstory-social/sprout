import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calls } from './fixtures/vscode.ts';

// The client's library reaches for VS Code itself, so it is replaced by
// one that keeps what it was made with and what was asked of it.
const made = vi.hoisted(() => ({
  clients: [] as { args: unknown[]; started: number; stopped: number }[],
  fails: null as Error | null,
}));
vi.mock('vscode-languageclient/node.js', () => ({
  TransportKind: { stdio: 0 },
  LanguageClient: class {
    readonly kept: { args: unknown[]; started: number; stopped: number };
    constructor(...args: unknown[]) {
      this.kept = { args, started: 0, stopped: 0 };
      made.clients.push(this.kept);
    }
    async start() {
      this.kept.started += 1;
      if (made.fails !== null) throw made.fails;
    }
    async stop() {
      this.kept.stopped += 1;
    }
  },
}));

const { activate, deactivate } = await import('./extension.ts');

const context = () => ({ extensionPath: '/ext', subscriptions: [] as unknown[] });

beforeEach(() => {
  calls.length = 0;
  made.clients.length = 0;
  made.fails = null;
});

describe('the extension', () => {
  it('starts the server bundled beside it over stdio, given every Sprout file and manifest', async () => {
    const ctx = context();
    await activate(ctx as never);
    const [client] = made.clients;
    const module = join('/ext', 'dist', 'server.cjs');
    expect(client!.args.slice(0, 3)).toEqual([
      'sprout',
      'Sprout',
      { run: { module, transport: 0 }, debug: { module, transport: 0 } },
    ]);
    const options = client!.args[3] as {
      documentSelector: unknown[];
      synchronize: { fileEvents: { glob: string } };
    };
    expect(options.documentSelector).toEqual([
      { scheme: 'file', language: 'sprout' },
      { scheme: 'file', language: 'sprout-prose' },
      { scheme: 'file', pattern: '**/sprout.json' },
    ]);
    // A change on disk to any file the world is read from reaches the server.
    expect(options.synchronize.fileEvents.glob).toBe('**/{*.sprout,*.prose,sprout.json}');
    expect(ctx.subscriptions).toEqual([options.synchronize.fileEvents]);
    expect(client!.started).toBe(1);
    expect(calls.filter((one) => one.what === 'showErrorMessage')).toEqual([]);
  });

  it('says so when the server does not start, and leaves the colouring', async () => {
    made.fails = new Error('no node');
    await activate(context() as never);
    expect(calls.filter((one) => one.what === 'showErrorMessage')).toEqual([
      {
        what: 'showErrorMessage',
        args: [
          'The Sprout language server did not start (no node): files are coloured, and not checked.',
        ],
      },
    ]);
  });

  it('stops the server it started', async () => {
    await activate(context() as never);
    await deactivate();
    expect(made.clients[0]!.stopped).toBe(1);
  });
});
