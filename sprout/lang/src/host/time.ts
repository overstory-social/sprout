// Time as a host gives it (the spec's Time; The host contract › Time):
// whole host seconds from 0. A world reads time only as the `elapsed` a
// tick or a wake is handed, the seconds between two instants the host
// supplied; nothing reads a clock.

/** An instant, in whole host seconds: what the host says the time is, and what state stores. */
export type HostSeconds = number;

/** `instant`, checked as the host must give one: a whole number of seconds, not before 0. */
export function hostSeconds(instant: number, what: string): HostSeconds {
  if (!Number.isSafeInteger(instant) || instant < 0) {
    throw new Error(`${what} is \`${instant}\`, and the host gives time in whole seconds from 0.`);
  }
  return instant;
}
