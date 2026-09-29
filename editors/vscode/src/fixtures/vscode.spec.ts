import { describe, expect, it } from 'vitest';

import { calls, window, workspace } from './vscode.ts';

describe('the stand-in for vscode', () => {
  it('keeps each call it is given, in order', async () => {
    calls.length = 0;
    workspace.createFileSystemWatcher('**/*.sprout');
    await window.showErrorMessage('words');
    expect(calls).toEqual([
      { what: 'createFileSystemWatcher', args: ['**/*.sprout'] },
      { what: 'showErrorMessage', args: ['words'] },
    ]);
  });
});
