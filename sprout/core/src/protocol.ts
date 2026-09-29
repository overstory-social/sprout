import { z } from 'zod';

import { DIRECTIONS, LEVELS, type Plain as PlainValue } from '@overstory/sprout/lang';

import { ClientDeclaration } from './capabilities.js';

// The wire protocol a host speaks with its clients (docs/design/sprout-
// server.md, The protocol): one WebSocket per client, subprotocol
// `sprout.1`, each frame one JSON object whose `t` names it. Every message
// either way has its schema here, so a host validates what a client sends
// and a client what a host sends; a frame that does not validate is
// answered with `refused`, never dropped. Nothing here reaches a world.

/** The subprotocol, and the version a `hello` names. */
export const PROTOCOL = 'sprout.1';

const seq = z.number().int().nonnegative();
const text = z.string();
const named = z.string().min(1);

// --- client to server ------------------------------------------------------

/** What a client may send. */
export const ClientMessage = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('hello'),
      protocol: z.literal(PROTOCOL),
      client: named,
      /** The person's token, which the host keeps only a hash of. */
      token: z.string().min(16).max(256),
      renders: ClientDeclaration.shape.renders,
    })
    .strict(),
  z.object({ t: z.literal('admit'), world: named, nickname: text }).strict(),
  z.object({ t: z.literal('command'), seq, line: text }).strict(),
  z.object({ t: z.literal('poll'), seq }).strict(),
  z.object({ t: z.literal('chat'), line: text }).strict(),
  z.object({ t: z.literal('levels'), show: z.array(z.enum(LEVELS)) }).strict(),
  z.object({ t: z.literal('leave') }).strict(),
  z.object({ t: z.literal('ping') }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- server to client ------------------------------------------------------

const Plain: z.ZodType<PlainValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(Plain),
    z.record(z.string(), Plain),
  ]),
);

const Recorded = z.object({ extension: named, statement: named }).strict();

const Delivered = {
  from: text,
  actor: text.nullable(),
  to: text,
};

/** One effect as a client is sent it (`core`'s `deliver`): a prose effect's words, an extension's by its transcript line, or an extension's payload. */
const SentEffect = z.union([
  z
    .object({
      as: z.literal('words'),
      kind: z.enum(['said', 'told', 'refused', 'described', 'notice']),
      recorded: z.null(),
      ...Delivered,
      paragraphs: z.array(text),
    })
    .strict(),
  z
    .object({
      as: z.literal('words'),
      kind: z.literal('extension'),
      recorded: Recorded,
      ...Delivered,
      paragraphs: z.array(text),
    })
    .strict(),
  z
    .object({
      as: z.literal('payload'),
      kind: z.literal('extension'),
      recorded: Recorded,
      ...Delivered,
      payload: Plain,
    })
    .strict(),
]);

const Exit = z.object({ direction: z.enum(DIRECTIONS).nullable(), label: text, to: text }).strict();
const Thing = z.object({ id: text, name: text }).strict();

/** A view as a client is sent it (`core`'s `sendView`). */
const SentView = z
  .object({
    description: z.array(text),
    effects: z.array(
      z.discriminatedUnion('as', [
        z
          .object({ extension: named, statement: named, as: z.literal('payload'), payload: Plain })
          .strict(),
        z
          .object({ extension: named, statement: named, as: z.literal('words'), transcript: text })
          .strict(),
      ]),
    ),
    exits: z.array(Exit),
    occupants: z.array(Thing),
    carried: z.array(Thing),
    readings: z.array(
      z
        .object({
          verb: named,
          typed: text,
          refused: z.array(text).nullable(),
          options: z.array(
            z.discriminatedUnion('takes', [
              z
                .object({
                  role: named,
                  takes: z.literal('symbol'),
                  options: z.array(z.object({ value: text, words: text }).strict()),
                })
                .strict(),
              z
                .object({
                  role: named,
                  takes: z.literal('integer'),
                  ranges: z.array(
                    z.object({ min: z.number().int(), max: z.number().int() }).strict(),
                  ),
                })
                .strict(),
            ]),
          ),
        })
        .strict(),
    ),
  })
  .strict();

const Granted = z
  .object({ extension: named, major: z.number().int().nonnegative(), statement: named })
  .strict();
const Declined = Granted.extend({
  reason: z.enum(['not-pinned', 'absent', 'other-major', 'no-such-statement']),
  words: text,
}).strict();

/** Where a frame was refused: at `hello`, at admission, or any frame after. */
export const REFUSED_STAGES = ['hello', 'admit', 'frame'] as const;

/** Why a connection closes. */
export const BYE_REASONS = ['left', 'taken-down', 'stopping', 'unanswered'] as const;

/** What a host may send. */
export const ServerMessage = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('welcome'),
      server: named,
      /** Each world served, and what this client is granted of its extensions' payloads, and declined. */
      worlds: z.array(
        z.object({ world: named, granted: z.array(Granted), declined: z.array(Declined) }).strict(),
      ),
    })
    .strict(),
  z
    .object({ t: z.literal('admitted'), world: named, nickname: named, returning: z.boolean() })
    .strict(),
  z
    .object({
      t: z.literal('refused'),
      stage: z.enum(REFUSED_STAGES),
      /** A short reason a client can act on: `nickname`, `closed`, `malformed`, …. */
      reason: named,
      /** Words a person can read, always. */
      text: named,
    })
    .strict(),
  z
    .object({
      t: z.literal('effects'),
      seq: seq.nullable(),
      /** Whether this is the last of the turns the line with `seq` ran; true for effects nobody asked for. */
      last: z.boolean(),
      effects: z.array(SentEffect),
    })
    .strict(),
  z.object({ t: z.literal('view'), seq: seq.nullable(), view: SentView }).strict(),
  z
    .object({ t: z.literal('status'), place: text, here: z.array(Thing), exits: z.array(Exit) })
    .strict(),
  z.object({ t: z.literal('offered'), lines: z.array(text) }).strict(),
  z
    .object({
      t: z.literal('record'),
      level: z.enum(LEVELS),
      text,
      /** The host's time, in whole seconds; it never reaches a turn. */
      at: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ t: z.literal('chat'), from: named, line: text }).strict(),
  z.object({ t: z.literal('bye'), reason: z.enum(BYE_REASONS), text: named }).strict(),
]);
/** What a host sends, read-only all the way down, so what `deliver` and `sendView` make is sent as it is. */
export type ServerMessage = Frozen<z.infer<typeof ServerMessage>>;

/** `T` with every array and object in it read-only. */
type Frozen<T> = T extends readonly (infer U)[]
  ? readonly Frozen<U>[]
  : T extends object
    ? { readonly [K in keyof T]: Frozen<T[K]> }
    : T;

/** One frame, as text off the wire, as a client message; the words of what is wrong with it where it is none. */
export function clientMessageOf(
  frame: string,
): { readonly message: ClientMessage } | { readonly malformed: string } {
  let json: unknown;
  try {
    json = JSON.parse(frame);
  } catch {
    return { malformed: 'This frame is not JSON.' };
  }
  const parsed = ClientMessage.safeParse(json);
  if (parsed.success) return { message: parsed.data };
  const issue = parsed.error.issues[0]!;
  const where = issue.path.length === 0 ? 'the frame' : `\`${issue.path.join('.')}\``;
  return { malformed: `This frame is not one the protocol reads: ${where}: ${issue.message}.` };
}
