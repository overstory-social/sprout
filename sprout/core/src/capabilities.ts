import { z } from 'zod';

import type { PinnedExtension } from '@overstory/sprout/lang';

// What a client says it can render, and what the host agrees to send it
// (the spec's Extensions › Effects are additive; The host contract › Two
// decisions, of different kinds). The five prose kinds are words, which
// every client renders, so only an extension's effects are negotiated:
// a client names the statements it renders, by extension and major, and
// is granted those the world pins and the host supplies at that major.
// Everything else it is sent as its transcript line, so a client that
// declares nothing still reads every effect. The world is never told
// what any client declared.

/** What a client declares, as it arrives from outside: the extension statements whose payloads it renders. */
export const ClientDeclaration = z
  .object({
    renders: z.array(
      z
        .object({
          extension: z.string().min(1),
          major: z.number().int().nonnegative(),
          statements: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();
export type ClientDeclaration = z.infer<typeof ClientDeclaration>;

/** What one client is sent payloads of: each extension's statements, by the extension's name. */
export interface ClientCapabilities {
  readonly payloads: ReadonlyMap<string, ReadonlySet<string>>;
}

/** A client that renders words alone, as a screen reader or a terminal does: every effect reaches it as words. */
export const TEXT_ONLY: ClientCapabilities = { payloads: new Map() };

/** One statement a client is sent the payloads of. */
export interface Granted {
  readonly extension: string;
  readonly major: number;
  readonly statement: string;
}

/** Why a statement a client declared is sent to it as its transcript line instead. */
export type DeclineReason = 'not-pinned' | 'absent' | 'other-major' | 'no-such-statement';

/** One statement a client declared and is not sent the payloads of, with words for whoever builds the client. */
export interface Declined {
  readonly extension: string;
  readonly major: number;
  readonly statement: string;
  readonly reason: DeclineReason;
  readonly words: string;
}

/** What negotiating with one client comes to: what it is sent, and what it asked for and is not. */
export type Negotiation =
  | {
      readonly accepted: true;
      readonly capabilities: ClientCapabilities;
      readonly granted: readonly Granted[];
      readonly declined: readonly Declined[];
    }
  | { readonly accepted: false; readonly words: string };

/**
 * Negotiate with a client that sent `declared`, for a world pinning
 * `extensions` (its catalogue's). A declaration that is not one is
 * refused with words, and the host may go on treating that client as
 * `TEXT_ONLY`.
 */
export function negotiate(
  declared: unknown,
  extensions: ReadonlyMap<string, PinnedExtension>,
): Negotiation {
  const parsed = ClientDeclaration.safeParse(declared);
  if (!parsed.success) {
    return {
      accepted: false,
      words:
        'A client declares what it renders as { renders: [{ extension, major, statements }] }, and this is not that: it is sent every effect as words.',
    };
  }
  const payloads = new Map<string, Set<string>>();
  const granted: Granted[] = [];
  const declined: Declined[] = [];
  for (const { extension, major, statements } of parsed.data.renders) {
    for (const statement of statements) {
      const reason = declineReason(extensions.get(extension), major, statement);
      if (reason === null) {
        if (payloads.get(extension)?.has(statement)) continue;
        const held = payloads.get(extension) ?? new Set<string>();
        payloads.set(extension, held.add(statement));
        granted.push({ extension, major, statement });
      } else {
        const pinned = extensions.get(extension)?.major ?? major;
        const words = declinedWords(reason, extension, major, statement, pinned);
        declined.push({ extension, major, statement, reason, words });
      }
    }
  }
  return { accepted: true, capabilities: { payloads }, granted, declined };
}

/** Whether a client may be sent `extension.statement`'s payloads, and why not. */
function declineReason(
  pinned: PinnedExtension | undefined,
  major: number,
  statement: string,
): DeclineReason | null {
  if (pinned === undefined) return 'not-pinned';
  if (pinned.installed === null) return 'absent';
  if (pinned.major !== major) return 'other-major';
  const known = pinned.installed.statements.some((one) => one.name === statement);
  return known ? null : 'no-such-statement';
}

function declinedWords(
  reason: DeclineReason,
  extension: string,
  major: number,
  statement: string,
  pinned: number,
): string {
  const name = `\`${extension}.${statement}\``;
  switch (reason) {
    case 'not-pinned':
      return `This world does not use the extension \`${extension}\`, so ${name} is never recorded here.`;
    case 'absent':
      return `This host does not provide \`${extension}\`, so this world records nothing of ${name}.`;
    case 'other-major':
      return `This world uses \`${extension}\` at major ${pinned}, not ${major}, so ${name} is sent as its transcript line.`;
    case 'no-such-statement':
      return `The extension \`${extension}\` has no statement \`${statement}\`.`;
  }
}

/** Whether a client with `capabilities` is sent the payload of what `extension`'s `statement` recorded. */
export function rendersPayload(
  capabilities: ClientCapabilities,
  extension: string,
  statement: string,
): boolean {
  return capabilities.payloads.get(extension)?.has(statement) ?? false;
}
