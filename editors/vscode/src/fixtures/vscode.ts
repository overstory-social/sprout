// A stand-in for the `vscode` module, which exists only inside VS Code:
// what the extension's client calls of it, each call kept for a spec to
// read. The package's vitest config resolves `vscode` here.

/** Every call made, in order. */
export const calls: { readonly what: string; readonly args: readonly unknown[] }[] = [];

export const workspace = {
  createFileSystemWatcher: (glob: string) => {
    const watcher = { glob, dispose: () => undefined };
    calls.push({ what: 'createFileSystemWatcher', args: [glob] });
    return watcher;
  },
};

export const window = {
  showErrorMessage: async (words: string) => {
    calls.push({ what: 'showErrorMessage', args: [words] });
    return undefined;
  },
};
