import {
  hostSeconds,
  placeOfTeller,
  readerOf,
  standsInPlace,
  toldToPlace,
  type HostSeconds,
  type InstanceId,
  type TurnHost,
  type VisitKey,
  type WorldState,
} from '@overstory/sprout/lang';

import { saidEntry } from './log/said.js';
import { loaded } from './steps.js';
import type { SproutStore } from './store.js';
import { committedState } from './turns.js';

// Conversation between visitors (the spec's Other people › Talking to
// each other; The host contract › Conversation): free text is the host's,
// beside the world and never in it. A line said here runs no turn,
// writes nothing of the world and is not an effect; it reads the state
// only to find who stands with the speaker, and is written to the log
// with who heard it, under the world's lock so the hearers logged are who
// stood there as it landed, and never replayed. The speaker is among the
// hearers, so a line said with nobody else there is said to them alone.
// The host delivers what is said, beside the world's words; its length
// cap, its pace and its moderation are the host's, and every refusal
// carries words the speaker is shown.

/** What the host sets for conversation; null in either leaves it unbounded. */
export interface ConversationRules {
  /** The most characters one thing said may have, counted as it is kept. */
  readonly characters: number | null;
  /** The most things one visitor may say in one world within any `seconds`. */
  readonly pace: { readonly messages: number; readonly seconds: number } | null;
}

/** What the host decides of conversation beyond the world. */
export interface ConversationHost {
  readonly rules: ConversationRules;
  /** Whether the host's moderation lets `visit` say `text`, as it is kept; asked of every line that is words. */
  readonly moderate: (text: string, visit: VisitKey) => boolean | Promise<boolean>;
}

/** One thing a visitor asks to say to the people with them, at the host's instant `at`. */
export interface Saying {
  readonly visit: VisitKey;
  readonly text: string;
  readonly at: HostSeconds;
}

/** What was said, for the host to deliver to each of `to`, beside the world's words and never among them. */
export interface Said {
  readonly said: true;
  readonly from: VisitKey;
  /** The speaker's nickname in this world, the only name anyone here knows them by. */
  readonly nickname: string;
  readonly text: string;
  /** The place it was said in. */
  readonly place: InstanceId;
  /** Everyone standing directly in that place, the speaker among them, in contents order. */
  readonly to: readonly VisitKey[];
  readonly at: HostSeconds;
}

/** Why a thing was not said. */
export type ConversationRefusalReason =
  /** It has no words. */
  | 'empty'
  /** It holds a control or format character, which is no part of a word. */
  | 'not-words'
  /** It is longer than the host's cap. */
  | 'too-long'
  /** The speaker has said as much as the host's pace allows for now. */
  | 'too-fast'
  /** The host's moderation declined it. */
  | 'moderated'
  /** The speaker left their place while moderation was deciding. */
  | 'gone';

/** A thing not said, with the words the speaker is shown; a host may replace them with its own. */
export interface ConversationRefused {
  readonly said: false;
  readonly reason: ConversationRefusalReason;
  readonly words: string;
}

const NOT_WORDS = /[\p{Cc}\p{Cf}]/u;

/** Text as conversation keeps it: its words, separated by single spaces. */
export function keptSaying(text: string): string {
  return text.trim().split(/\s+/).join(' ');
}

/** Why `text` may not be said under `rules`, whoever hears it, or null where it may. */
export function sayingRefusal(rules: ConversationRules, text: string): ConversationRefused | null {
  const kept = keptSaying(text);
  if (kept === '') return refused('empty', 'Say something for the others here to read.');
  if (NOT_WORDS.test(kept)) {
    return refused(
      'not-words',
      'What you say is words and nothing else: say it without hidden or control characters.',
    );
  }
  const length = [...kept].length;
  if (rules.characters !== null && length > rules.characters) {
    return refused(
      'too-long',
      `That is ${length} characters, and one thing said here may have at most ${rules.characters}: say it in fewer.`,
    );
  }
  return null;
}

/** Where a thing is said, and who is there to read it. */
export interface Heard {
  readonly place: InstanceId;
  readonly to: readonly VisitKey[];
}

/** The place `visit` stands in and everyone directly in it, the speaker among them; null where they stand in no place, being away or displaced. */
export function hearers(state: WorldState, visit: VisitKey): Heard | null {
  const reader = readerOf(state);
  const visitor = reader.visitor(visit);
  if (visitor === undefined || !standsInPlace(reader, visitor.instance)) return null;
  const place = placeOfTeller(reader, visitor.instance);
  if (place === null) return null;
  const visits = new Map([...state.visitors.values()].map((one) => [one.instance, one.visit]));
  const to = toldToPlace(reader, visitor.instance, [])
    .map((id) => visits.get(id))
    .filter((one): one is VisitKey => one !== undefined);
  return { place, to };
}

/** Throw where `visit` has no one to talk to because the host asked wrongly: they never came, or are away. */
function mustBePresent(state: WorldState, visit: VisitKey): void {
  const visitor = state.visitors.get(visit);
  if (visitor === undefined) throw new Error(`\`${visit}\` has never visited this world.`);
  if ((state.instances.get(visitor.instance)?.container ?? null) === null) {
    throw new Error(`\`${visit}\` is not in this world, so has nobody to talk to.`);
  }
}

/** Each visitor's recent sayings, per world, so the host's pace can be kept; held only in memory. */
export class ConversationPace {
  private readonly times = new Map<string, Map<VisitKey, HostSeconds[]>>();

  /**
   * Whether `visit` may say something in `microworldId` at `at` under
   * `pace`; where it may, the saying is counted.
   */
  admit(
    microworldId: string,
    visit: VisitKey,
    at: HostSeconds,
    pace: ConversationRules['pace'],
  ): boolean {
    if (pace === null) return true;
    let world = this.times.get(microworldId);
    if (world === undefined) {
      world = new Map();
      this.times.set(microworldId, world);
    }
    const recent = (world.get(visit) ?? []).filter((t) => t > at - pace.seconds);
    const admitted = recent.length < pace.messages;
    if (admitted) recent.push(at);
    if (recent.length > 0) world.set(visit, recent);
    else world.delete(visit);
    return admitted;
  }

  /** Drop everything counted of `visit`, in every world, as forgetting them must. */
  forget(visit: VisitKey): void {
    for (const world of this.times.values()) world.delete(visit);
  }
}

/**
 * Say `saying` in `microworldId` to the people standing with its visitor:
 * the text checked against the host's rules, then the host's pace, then
 * its moderation, and who hears it read under the world's lock once
 * moderation answers, since people may have come and gone meanwhile, and
 * logged there. Asking for one who is away, or who never came, is the
 * host's defect.
 */
export async function runConversation(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  conversation: ConversationHost,
  pace: ConversationPace,
  saying: Saying,
): Promise<Said | ConversationRefused> {
  const at = hostSeconds(saying.at, 'the instant a thing is said');
  const { rules } = conversation;
  const bad = sayingRefusal(rules, saying.text);
  if (bad !== null) return bad;
  const text = keptSaying(saying.text);
  mustBePresent(await committedState(store, microworldId, host), saying.visit);
  if (!pace.admit(microworldId, saying.visit, at, rules.pace)) {
    const { messages, seconds } = rules.pace!;
    return refused(
      'too-fast',
      `You may say ${messages === 1 ? 'one thing' : `${messages} things`} every ${seconds === 1 ? 'second' : `${seconds} seconds`} here: wait a moment and say it again.`,
    );
  }
  if (!(await conversation.moderate(text, saying.visit))) {
    return refused('moderated', 'That cannot be said here.');
  }
  return store.transaction(microworldId, async (tx) => {
    const state = loaded(await tx.state(), host);
    const heard = hearers(state, saying.visit);
    if (heard === null) return GONE;
    const said: Said = {
      said: true,
      from: saying.visit,
      nickname: state.visitors.get(saying.visit)!.nickname,
      text,
      place: heard.place,
      to: heard.to,
      at,
    };
    await tx.appendLog(saidEntry(said));
    return said;
  });
}

function refused(reason: ConversationRefusalReason, words: string): ConversationRefused {
  return { said: false, reason, words };
}

const GONE = refused('gone', 'You left before that was said: say it again where you are now.');
