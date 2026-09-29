import { join } from 'node:path';

import { window, workspace, type ExtensionContext } from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js';

// The extension's client for the Sprout language server: it starts the
// server bundled beside it, gives it every `.sprout` and `.prose` file and
// manifest open in the editor, and tells it when one changes on disk. The
// grammars colour a file whether or not the server starts; a server that
// fails to start says so.

let client: LanguageClient | null = null;

/** What the server is given: the two languages and the manifest, from files on disk. */
const CLIENT_OPTIONS: LanguageClientOptions = {
  documentSelector: [
    { scheme: 'file', language: 'sprout' },
    { scheme: 'file', language: 'sprout-prose' },
    { scheme: 'file', pattern: '**/sprout.json' },
  ],
};

/** Start the language server bundled at `dist/server.cjs`. */
export async function activate(context: ExtensionContext): Promise<void> {
  const module = join(context.extensionPath, 'dist', 'server.cjs');
  const server: ServerOptions = {
    run: { module, transport: TransportKind.stdio },
    debug: { module, transport: TransportKind.stdio },
  };
  const watcher = workspace.createFileSystemWatcher('**/{*.sprout,*.prose,sprout.json}');
  context.subscriptions.push(watcher);
  client = new LanguageClient('sprout', 'Sprout', server, {
    ...CLIENT_OPTIONS,
    synchronize: { fileEvents: watcher },
  });
  try {
    await client.start();
  } catch (error) {
    const words = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(
      `The Sprout language server did not start (${words}): files are coloured, and not checked.`,
    );
  }
}

/** Stop the language server. */
export async function deactivate(): Promise<void> {
  await client?.stop();
  client = null;
}
