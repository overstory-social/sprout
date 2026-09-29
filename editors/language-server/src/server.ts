import { relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupKind,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type Location,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

import type { DeclaredAs } from './declarations.js';
import { completionsAt, definitionsOf, hoverOf, wordAt, type Word } from './lookup.js';
import { checkWorld, rangeOf, worldFolderOf, type CheckedWorld } from './world.js';

// The language server over one connection: each world folder an open file
// sits in is checked whole a moment after the last edit to any of its
// files, and its diagnostics replace the ones it last had, file by file;
// a file that has none any more is cleared. Hover, go-to-definition and
// completion read the declarations of the world's last check.

/** How the server is run. */
export interface ServeOptions {
  /** How long after the last edit a world is checked, in milliseconds. */
  readonly debounce?: number;
}

/** What the server keeps for one world folder. */
interface World {
  checked: CheckedWorld | null;
  /** The files its last check put diagnostics on. */
  published: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const COMPLETION_KIND: Readonly<Record<DeclaredAs | 'keyword', CompletionItemKind>> = {
  world: CompletionItemKind.Module,
  kind: CompletionItemKind.Class,
  object: CompletionItemKind.Variable,
  enum: CompletionItemKind.Enum,
  option: CompletionItemKind.EnumMember,
  verb: CompletionItemKind.Function,
  intent: CompletionItemKind.Function,
  message: CompletionItemKind.Event,
  property: CompletionItemKind.Property,
  memory: CompletionItemKind.Property,
  passage: CompletionItemKind.Text,
  keyword: CompletionItemKind.Keyword,
};

/** Serve the language on `connection`, and start listening. */
export function serve(connection: Connection, options: ServeOptions = {}): void {
  const debounce = options.debounce ?? 250;
  const documents = new TextDocuments(TextDocument);
  const worlds = new Map<string, World>();

  const worldOf = (root: string): World => {
    let world = worlds.get(root);
    if (world === undefined) {
      world = { checked: null, published: new Set(), timer: null };
      worlds.set(root, world);
    }
    return world;
  };

  const check = (root: string): CheckedWorld => {
    const world = worldOf(root);
    if (world.timer !== null) clearTimeout(world.timer);
    world.timer = null;
    const unsaved = new Map(
      documents.all().flatMap((doc) => {
        const path = pathOf(doc.uri);
        return path === null ? [] : [[path, doc.getText()] as const];
      }),
    );
    const checked = checkWorld(root, unsaved);
    world.checked = checked;
    const byFile = new Map<string, typeof checked.diagnostics>();
    for (const one of checked.diagnostics)
      byFile.set(one.path, [...(byFile.get(one.path) ?? []), one]);
    for (const path of world.published)
      if (!byFile.has(path)) void connection.sendDiagnostics({ uri: uriOf(path), diagnostics: [] });
    for (const [path, placed] of byFile)
      void connection.sendDiagnostics({
        uri: uriOf(path),
        diagnostics: placed.map((one) => ({
          range: { start: one.start, end: one.end },
          severity:
            one.severity === 'refusal' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          source: 'sprout',
          message: one.message,
        })),
      });
    world.published = new Set(byFile.keys());
    return checked;
  };

  const schedule = (uri: string): void => {
    const path = pathOf(uri);
    const root = path === null ? null : worldFolderOf(path);
    if (root === null) return;
    const world = worldOf(root);
    if (world.timer !== null) clearTimeout(world.timer);
    world.timer = setTimeout(() => check(root), debounce);
  };

  /** The world a document is in, checked, the name it has there, and the word at `position`. */
  const at = (
    uri: string,
    position: { line: number; character: number },
  ): { checked: CheckedWorld; file: string; word: Word | null; text: string } | null => {
    const doc = documents.get(uri);
    const path = pathOf(uri);
    const root = path === null ? null : worldFolderOf(path);
    if (doc === undefined || path === null || root === null) return null;
    const checked = worldOf(root).checked ?? check(root);
    const text = doc.getText();
    const offset = doc.offsetAt(position);
    const file = relative(checked.root, path).split('\\').join('/');
    return { checked, file, word: wordAt(text, offset), text: text.slice(0, offset) };
  };

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true,
      completionProvider: { triggerCharacters: ['.', ':'] },
    },
    serverInfo: { name: 'sprout-language-server' },
  }));
  documents.onDidOpen(({ document }) => schedule(document.uri));
  documents.onDidChangeContent(({ document }) => schedule(document.uri));
  documents.onDidClose(({ document }) => schedule(document.uri));
  connection.onDidChangeWatchedFiles(({ changes }) => {
    for (const change of changes) schedule(change.uri);
  });

  connection.onHover(({ textDocument, position }) => {
    const found = at(textDocument.uri, position);
    if (found === null || found.word === null) return null;
    const value = hoverOf(found.checked.index, found.file, found.word);
    return value === null ? null : { contents: { kind: MarkupKind.Markdown, value } };
  });

  connection.onDefinition(({ textDocument, position }): Location[] => {
    const found = at(textDocument.uri, position);
    if (found === null || found.word === null) return [];
    return definitionsOf(found.checked.index, found.file, found.word).map((one) => ({
      uri: uriOf(`${found.checked.root}/${one.at.source.name}`),
      range: rangeOf(one.at),
    }));
  });

  connection.onCompletion(({ textDocument, position }) => {
    const found = at(textDocument.uri, position);
    if (found === null) return [];
    const prefix = found.text.slice(found.text.lastIndexOf('\n') + 1);
    return completionsAt(found.checked.index, found.file, prefix).map((one) => ({
      label: one.label,
      kind: COMPLETION_KIND[one.as],
      detail: one.detail,
    }));
  });

  connection.onShutdown(() => {
    for (const world of worlds.values()) if (world.timer !== null) clearTimeout(world.timer);
  });

  documents.listen(connection);
  connection.listen();
}

/** The path a `file:` URI names, or null for any other. */
function pathOf(uri: string): string | null {
  return uri.startsWith('file:') ? fileURLToPath(uri) : null;
}

function uriOf(path: string): string {
  return pathToFileURL(path).href;
}
