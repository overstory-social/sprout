import { describe, expect, it } from 'vitest';

import { sanitizedLauncher } from './aslr.js';

describe('sanitizedLauncher', () => {
  it('runs a sanitized command under setarch for the machine, naming it in the line', () => {
    const launcher = sanitizedLauncher({ platform: 'linux', machine: 'aarch64', hasSetarch: true });
    expect(launcher.prefix).toEqual(['setarch', 'aarch64', '-R']);
    expect(launcher.line).toContain('setarch aarch64 -R');
    expect(launcher.line.split('\n')).toHaveLength(1);
  });

  it('leaves the command alone and prints the remedy where setarch is missing', () => {
    const launcher = sanitizedLauncher({ platform: 'linux', machine: 'x86_64', hasSetarch: false });
    expect(launcher.prefix).toEqual([]);
    expect(launcher.line).toContain('setarch -R npm run e2e');
    expect(launcher.line.split('\n')).toHaveLength(1);
  });

  it('does nothing and says nothing off Linux, even when setarch exists', () => {
    const launcher = sanitizedLauncher({ platform: 'darwin', machine: 'arm64', hasSetarch: true });
    expect(launcher).toEqual({ prefix: [], line: '' });
  });
});
