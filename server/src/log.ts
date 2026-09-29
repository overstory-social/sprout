import type { Level } from '@overstory/sprout/lang';

// The server's own log (docs/design/sprout-server.md, Config): one record
// to a line on its output, as text or as JSON, at or above the level the
// config sets. What a client is sent of the log is the connection's to
// choose, by its own `levels`; this is the server's.

/** How the server writes a record. */
export type LogFormat = 'text' | 'json';

/** The levels a server writes, most severe first; prose is a visitor's, and never the server's. */
const SEVERITY: readonly Exclude<Level, 'prose'>[] = ['error', 'warning', 'info', 'debug'];

/** The server's log: a record, at a level, at a host instant, about a world or none. */
export interface ServerLog {
  write(level: Exclude<Level, 'prose'>, text: string, world?: string): void;
}

/** A log writing each line `write` is given, at `lowest` and more severe, in `format`, stamped by `now`. */
export function serverLog(
  lowest: Exclude<Level, 'prose'>,
  format: LogFormat,
  now: () => number,
  write: (line: string) => void,
): ServerLog {
  const shown = SEVERITY.slice(0, SEVERITY.indexOf(lowest) + 1);
  return {
    write(level, text, world) {
      if (!shown.includes(level)) return;
      const at = now();
      write(
        format === 'json'
          ? JSON.stringify({ at, level, ...(world === undefined ? {} : { world }), text })
          : `${at} ${level}${world === undefined ? '' : ` ${world}`}: ${text}`,
      );
    },
  };
}
