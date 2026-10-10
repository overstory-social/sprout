// How the sanitized C runs are launched: a harness concern the spec does not name (see the test
// harness doc's C section). AddressSanitizer maps its shadow memory at fixed addresses, which a
// kernel with high-entropy address-space randomisation can occupy first, so the sanitized
// binaries fail at random there. Where `setarch` exists, `setarch <machine> -R` turns the
// randomisation off for the command it runs; elsewhere the run goes on as it is and the line says
// what to do.

/** What the host offers. */
export interface Host {
  readonly platform: string;
  /** The machine name `uname -m` prints. */
  readonly machine: string;
  readonly hasSetarch: boolean;
}

/** The words that go before a sanitized command, and the one line that tells which case holds. */
export interface Launcher {
  readonly prefix: readonly string[];
  readonly line: string;
}

/** Chooses how to launch a sanitized command on `host`; only Linux has the problem. */
export function sanitizedLauncher(host: Host): Launcher {
  if (host.platform !== 'linux') return { prefix: [], line: '' };
  if (host.hasSetarch && host.machine !== '') {
    return {
      prefix: ['setarch', host.machine, '-R'],
      line: `runtime-c (sanitized): running under \`setarch ${host.machine} -R\` (address-space randomisation off, which AddressSanitizer needs on kernels with high-entropy randomisation)`,
    };
  }
  return {
    prefix: [],
    line: 'runtime-c (sanitized): `setarch` is not on the PATH or the machine name is unknown, so the sanitized run keeps address-space randomisation on and can fail at random on kernels with high-entropy randomisation; run `setarch -R npm run e2e` there',
  };
}
