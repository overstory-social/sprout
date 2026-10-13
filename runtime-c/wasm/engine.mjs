// The runtime's WebAssembly engine (engine.c), driven from JavaScript: one world and its live state per
// instance. Each call writes its input into the instance's buffer, runs one export, and reads back the
// answer as JSON. A status other than 0 throws, with the words the engine gave where it gave any. A turn's
// answer is what engine.c's `told` describes: its lines and effects, its fault, whose views it made stale,
// what the store writes, the entry the log keeps, and for a command what became of its line.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class WasmEngine {
  /** An instance of the engine at `wasmFile`, with `cartridge` (bytes) loaded and a new state opened for `worldId`. */
  static async open(wasmFile, cartridge, worldId) {
    const module = await WebAssembly.compile(readFileSync(wasmFile));
    const instance = await WebAssembly.instantiate(module, {
      env: { now_ms: () => performance.now() },
    });
    const engine = new WasmEngine(instance.exports);
    engine.call('sw_load', engine.put([cartridge]));
    const [length] = engine.put([encoder.encode(worldId)]);
    engine.call('sw_open', 0, length);
    return engine;
  }

  constructor(exports) {
    this.x = exports;
  }

  /** Writes `parts` one after another into the input buffer; their lengths. */
  put(parts) {
    const total = parts.reduce((n, part) => n + part.length, 0);
    const at = this.x.sw_input(total);
    if (at === 0) throw new Error(`the engine cannot take ${total} bytes of input`);
    const bytes = new Uint8Array(this.x.memory.buffer, at, total + 1);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    bytes[total] = 0;
    return parts.map((part) => part.length);
  }

  call(name, ...args) {
    const status = this.x[name](...args);
    if (status !== 0) throw new Error(`${name}: status ${status}: ${this.text()}`);
    return this.text();
  }

  text() {
    const at = this.x.sw_output();
    if (at === 0) return '';
    return decoder.decode(new Uint8Array(this.x.memory.buffer, at, this.x.sw_output_length()));
  }

  /** Catch-up as one maintenance turn, as a host runs it before it admits anyone. */
  maintenance(seed, instant) {
    return JSON.parse(this.call('sw_maintenance', BigInt(seed), BigInt(instant)));
  }

  arrive(visit, nickname, seed, instant) {
    const lengths = this.put([encoder.encode(visit), encoder.encode(nickname)]);
    return JSON.parse(this.call('sw_arrive', ...lengths, BigInt(seed), BigInt(instant)));
  }

  depart(visit, seed, instant) {
    const [length] = this.put([encoder.encode(visit)]);
    return JSON.parse(this.call('sw_depart', length, BigInt(seed), BigInt(instant)));
  }

  /** A tick of `place`; `seed` is the step's, which the turn's own is drawn from with the place's path. */
  tick(place, seed, instant) {
    const [length] = this.put([encoder.encode(place)]);
    return JSON.parse(this.call('sw_tick', length, BigInt(seed), BigInt(instant)));
  }

  /**
   * The wake `object` asked for under `serial`, its `nth` this step; `seed` is the step's, which the turn's own
   * is drawn from with the object's path and `nth`.
   */
  wake(object, serial, nth, seed, instant) {
    const [length] = this.put([encoder.encode(object)]);
    return JSON.parse(
      this.call('sw_wake', length, BigInt(serial), BigInt(nth), BigInt(seed), BigInt(instant)),
    );
  }

  /** Every entry from now on at debug depth, with every effect, or at play depth, with their digest. */
  logDepth(depth) {
    this.x.sw_log_depth(depth === 'debug' ? 1 : 0);
  }

  /**
   * One command turn: `command` is `{ text }`, the words typed, which the engine reads in the turn, with `planned`
   * and `reread` for a later turn of a line, as `line` and `lineNext` hand them out; or `{ verb, fillers, typed }`, a
   * reading built from the view's chips, run as it is.
   */
  command(visit, command, seed, instant) {
    const json = JSON.stringify({ visit, ...command });
    const [length] = this.put([encoder.encode(json)]);
    return JSON.parse(this.call('sw_command', length, BigInt(seed), BigInt(instant)));
  }

  /**
   * Begins the line `text` that `visit` typed, and gives the first command it runs. The command turn this engine runs
   * next is taken as that command's; `lineNext` then gives the one after it, or null once the line is over.
   */
  line(visit, text) {
    const [length] = this.put([encoder.encode(JSON.stringify({ visit, text }))]);
    return JSON.parse(this.call('sw_line', length));
  }

  lineNext() {
    return JSON.parse(this.call('sw_line_next'));
  }

  scene(visit) {
    const [length] = this.put([encoder.encode(visit)]);
    return JSON.parse(this.call('sw_scene', length));
  }

  readings(visit, verb) {
    const lengths = this.put([encoder.encode(visit), encoder.encode(verb)]);
    return JSON.parse(this.call('sw_readings', ...lengths));
  }

  /** The stored state, as the store keeps it. */
  save() {
    return this.call('sw_save');
  }

  /** What the page pool holds now and at most, and what the instance's memory has grown to. */
  memory() {
    return {
      held: this.x.sw_held_bytes(),
      peak: this.x.sw_peak_held_bytes(),
      grown: this.x.sw_memory_bytes(),
    };
  }
}
