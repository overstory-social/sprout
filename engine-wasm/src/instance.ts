import { performance } from 'node:perf_hooks';

import type { InstanceId, RuntimeBudgets, VisitKey } from '@overstory/sprout/lang';

import {
  ActedSchema,
  DueWakesSchema,
  HearersSchema,
  LineCommandSchema,
  NicknameSchema,
  PlacesSchema,
  ReadingsSchema,
  SceneSchema,
  StandingSchema,
  ToldSchema,
  ViewSchema,
  read,
  type LineCommand,
  type Told,
} from './shapes.js';

// One instance of the runtime's WebAssembly module (runtime-c/wasm/engine/):
// one world and its live state, driven by calls that each write their
// input into the instance's buffer, run one export, and read its answer
// as JSON, checked against the language's shapes. A status other than 0
// throws, with the words the engine gave. The clock it imports is the
// budget's wall-clock backstop and nothing else; every turn's seed is
// handed in.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The exports the instance is driven by. */
interface Exports {
  readonly memory: WebAssembly.Memory;
  sw_input(bytes: number): number;
  sw_output(): number;
  sw_output_length(): number;
  sw_held_bytes(): number;
  sw_peak_held_bytes(): number;
  sw_memory_bytes(): number;
  sw_log_depth(debug: number): void;
  sw_may_hold(bound: number): void;
  sw_line_end(line: number): void;
  [name: string]: unknown;
}

/** What a turn hands the instance besides what it is about: its seed and its instant, in host seconds. */
export interface At {
  readonly seed: number;
  readonly now: number;
}

/** One instance of the engine, its memory its own. */
export class WasmInstance {
  private readonly x: Exports;

  constructor(module: WebAssembly.Module) {
    const instance = new WebAssembly.Instance(module, { env: { now_ms: () => performance.now() } });
    this.x = instance.exports as unknown as Exports;
  }

  /** Writes `parts` one after another into the input buffer; their lengths. */
  put(parts: readonly Uint8Array[]): number[] {
    const total = parts.reduce((n, part) => n + part.length, 0);
    const at = this.x.sw_input(total);
    if (at === 0) throw new Error(`The WebAssembly engine cannot take ${total} bytes of input.`);
    const bytes = new Uint8Array(this.x.memory.buffer, at, total + 1);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    bytes[total] = 0;
    return parts.map((part) => part.length);
  }

  /** Runs the export `name`, and gives back its answer; a status other than 0 throws with the engine's words. */
  call(name: string, ...args: (number | bigint)[]): string {
    const run = this.x[name];
    if (typeof run !== 'function')
      throw new Error(`The WebAssembly engine has no export \`${name}\`.`);
    const status = (run as (...given: (number | bigint)[]) => number)(...args);
    if (status !== 0) throw new Error(`${name}: status ${status}: ${this.text()}`);
    return this.text();
  }

  /** The answer the last call left. */
  text(): string {
    const at = this.x.sw_output();
    if (at === 0) return '';
    return decoder.decode(new Uint8Array(this.x.memory.buffer, at, this.x.sw_output_length()));
  }

  private strings(...parts: string[]): number[] {
    return this.put(parts.map((part) => encoder.encode(part)));
  }

  /** Loads `cartridge` as the instance's one world, replacing any before it and its state. */
  load(cartridge: Uint8Array): void {
    this.call('sw_load', ...this.put([cartridge]));
  }

  /** Opens `stored`, the JSON of a stored world as the store keeps it, as the live state. */
  open(stored: string): void {
    const [length] = this.strings(stored);
    this.call('sw_open', length!, 0);
  }

  /** Opens a new state for the world `worldId`. */
  openEmpty(worldId: string): void {
    const [length] = this.strings(worldId);
    this.call('sw_open', 0, length!);
  }

  /** The live state, as the store keeps it. */
  save(): string {
    return this.call('sw_save');
  }

  /** The host's budgets, by the spec's names, and the static cap on a list's length. */
  budgets(budgets: RuntimeBudgets, listElements: number): void {
    const [length] = this.strings(JSON.stringify({ ...budgets, listElements }));
    this.call('sw_budgets', length!);
  }

  /** The most instances the host will store in the turns that follow; null for none. */
  mayHold(bound: number | null): void {
    this.x.sw_may_hold(bound ?? -1);
  }

  /** Every entry from now on at debug depth, with every effect, or at play depth, with their digest. */
  logDepth(depth: 'play' | 'debug'): void {
    this.x.sw_log_depth(depth === 'debug' ? 1 : 0);
  }

  private told(name: string, ...args: (number | bigint)[]): Told {
    return read(ToldSchema, this.call(name, ...args), `a turn (${name})`);
  }

  /** Catch-up as one maintenance turn. */
  maintenance(at: At): Told {
    return this.told('sw_maintenance', BigInt(at.seed), BigInt(at.now));
  }

  arrive(visit: VisitKey, nickname: string, at: At): Told {
    return this.told(
      'sw_arrive',
      ...this.strings(visit, nickname),
      BigInt(at.seed),
      BigInt(at.now),
    );
  }

  depart(visit: VisitKey, at: At): Told {
    return this.told('sw_depart', ...this.strings(visit), BigInt(at.seed), BigInt(at.now));
  }

  tick(place: InstanceId, at: At): Told {
    return this.told('sw_tick', ...this.strings(place), BigInt(at.seed), BigInt(at.now));
  }

  wake(object: InstanceId, serial: number, at: At): Told {
    return this.told(
      'sw_wake',
      ...this.strings(object),
      BigInt(serial),
      BigInt(at.seed),
      BigInt(at.now),
    );
  }

  /**
   * One command turn: `command` is `{ visit, text }`, the words typed, which the engine reads in the turn; a
   * command a line handed out, as it was handed out; or `{ visit, verb, fillers, typed }`, a reading built from
   * the view's chips, run as it is.
   */
  command(command: object, at: At): Told {
    return this.told(
      'sw_command',
      ...this.strings(JSON.stringify(command)),
      BigInt(at.seed),
      BigInt(at.now),
    );
  }

  /** Begins the line `text` that `visit` typed, and gives the first command it runs, or null where it runs none. */
  line(visit: VisitKey, text: string): LineCommand | null {
    const answer = this.call('sw_line', ...this.strings(JSON.stringify({ visit, text })));
    return read(LineCommandSchema.nullable(), answer, 'a line');
  }

  /** The command the line numbered `line` runs next, once the one before it ran; null once it is over. */
  lineNext(line: number): LineCommand | null {
    return read(LineCommandSchema.nullable(), this.call('sw_line_next', line), 'a line');
  }

  /** Lets go of a line the host runs no more of. */
  lineEnd(line: number): void {
    this.x.sw_line_end(line);
  }

  view(visit: VisitKey) {
    return read(ViewSchema, this.call('sw_view', ...this.strings(visit)), 'a view');
  }

  scene(visit: VisitKey) {
    return read(SceneSchema, this.call('sw_scene', ...this.strings(visit)), 'a scene');
  }

  readings(visit: VisitKey, verb: string) {
    return read(ReadingsSchema, this.call('sw_readings', ...this.strings(visit, verb)), 'readings');
  }

  nickname(visit: VisitKey, nickname: string) {
    return read(
      NicknameSchema,
      this.call('sw_nickname', ...this.strings(visit, nickname)),
      'a nickname',
    );
  }

  occupied() {
    return read(PlacesSchema, this.call('sw_occupied'), 'the occupied places');
  }

  dueWakes(now: number) {
    return read(DueWakesSchema, this.call('sw_due_wakes', BigInt(now)), 'the wakes due');
  }

  hearers(visit: VisitKey) {
    return read(HearersSchema, this.call('sw_hearers', ...this.strings(visit)), 'who hears');
  }

  standing(visit: VisitKey) {
    return read(
      StandingSchema,
      this.call('sw_standing', ...this.strings(visit)),
      'where one stands',
    );
  }

  /** The engine's `acted` for the line `actor` typed, as `reader` reads it. */
  acted(reader: VisitKey, actor: VisitKey, typed: string) {
    return read(
      ActedSchema,
      this.call('sw_acted', ...this.strings(reader, actor, typed)),
      'what someone did',
    );
  }

  /** What the page pool holds now and at most, and what the instance's memory has grown to. */
  memory(): { held: number; peak: number; grown: number } {
    return {
      held: this.x.sw_held_bytes(),
      peak: this.x.sw_peak_held_bytes(),
      grown: this.x.sw_memory_bytes(),
    };
  }
}
