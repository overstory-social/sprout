// `node scripts/write-goldens.mjs <golden>` rewrites one file under corpus/goldens on purpose and
// prints its diff, which is read before it is committed; the gate never runs it. The goldens are
// fixtures the C tests replay (docs/design/sprout-test-harness.md, the golden layer), so each is
// written by what owns its content: the C runtime (`sproutc`, and the WebAssembly engine) for what
// a turn or a poll gives, the host for the turn seed, the compiler for the bench cartridges. A
// golden with no writer here is hand-kept, and the script says so. What a corpus cartridge
// declares is not a committed golden: ctest's setup dumps it from the language each run.
//
// Run `npm run build` and `node scripts/check-runtime-c.mjs` first: the writers use the built CLI,
// the built engine.wasm and the `sproutc` that script builds.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  compileBundle,
  DEFAULT_BLESSED,
  DEFAULT_LIMITS,
  emitCartridge,
  libraryHash,
  loadCartridge,
  MEDIA,
  readCartridge,
  readStoredWorld,
  SEED_MAX,
  SourceFile,
  STANDARD_LIBRARY,
} from '@overstory/sprout/lang';
import { shippedModule, WasmInstance } from '@overstory/sprout-engine-wasm';
import {
  freshStage,
  INSTALLED_EXTENSIONS,
  playStep,
  readScript,
  readWorld,
  turnSeed,
} from '@overstory/sprout-player';

import { format, getFileInfo, resolveConfig } from 'prettier';

import { runtimeCBuild } from './runtime-c-build.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const GOLDENS = join(root, 'corpus/goldens');
const CORPUS = join(root, 'corpus/good');

const { main: cli } = await import(pathToFileURL(join(root, 'cli/dist/cli.js')).href);

/** Every corpus world's name, sorted. */
const corpusWorlds = () => readdirSync(CORPUS).sort();

/** Packs every corpus world through the built CLI into `out`, as the C tests' setup does. */
async function packCorpus(out) {
  let said = '';
  const quiet = { write: (text) => ((said += text), true) };
  for (const name of corpusWorlds()) {
    said = '';
    const code = await cli(['pack', join(CORPUS, name), '-o', join(out, `${name}.sproutworld`)], {
      stdout: quiet,
      stderr: quiet,
      stdin: process.stdin,
    });
    if (code !== 0) throw new Error(`${name} did not pack:\n${said}`);
  }
}

/** The `sproutc` check-runtime-c.mjs builds; the script stops where it is not built. */
function sproutc() {
  const path = join(runtimeCBuild, 'sproutc');
  if (!existsSync(path)) {
    throw new Error(
      `sproutc is not built at ${path}: run \`node scripts/check-runtime-c.mjs\` first.`,
    );
  }
  return path;
}

// ---- stored-worlds.json: each world's initial state and states from its transcripts ----

/** Most states one transcript contributes: its first, its last, and evenly between. */
const PER_TRANSCRIPT = 6;

/** A stored world in the canonical bytes: keys in the schema's order. */
const canonical = (stored) => JSON.stringify(readStoredWorld(stored));

async function storedWorlds(scratch) {
  await packCorpus(scratch);
  const initial = [];
  const played = [];
  for (const name of corpusWorlds()) {
    const bytes = readFileSync(join(scratch, `${name}.sproutworld`));
    const engine = new WasmInstance(shippedModule());
    engine.load(bytes);
    engine.openEmpty(readCartridge(bytes).header.namespace);
    const world = JSON.parse(engine.save());
    initial.push(`${JSON.stringify(name)}:${canonical(world)}`);
    const folder = join(CORPUS, name, 'transcripts');
    if (!existsSync(folder)) continue;
    const bundle = compileBundle(readWorld(join(CORPUS, name)).source, {
      mode: 'publish',
      blessed: DEFAULT_BLESSED,
      extensions: INSTALLED_EXTENSIONS,
    }).bundle;
    for (const transcript of readdirSync(folder).sort()) {
      const script = readScript(readFileSync(join(folder, transcript), 'utf8'), transcript);
      const stage = freshStage(bundle);
      const states = script.steps.map((step, i) => {
        playStep(stage, step, `${transcript}, step ${i + 1}`);
        // The runtime writes a state back in the order it reads one: the C stored tests compare those bytes.
        engine.open(JSON.stringify({ world: world.world, ...stage.stored }));
        return canonical(JSON.parse(engine.save()));
      });
      const distinct = states
        .map((text, step) => ({ text, step }))
        .filter(({ text }, i, all) => i === 0 || text !== all[i - 1].text);
      const chosen = new Set();
      for (let k = 0; k < Math.min(PER_TRANSCRIPT, distinct.length); k++) {
        chosen.add(Math.round((k * (distinct.length - 1)) / Math.max(1, PER_TRANSCRIPT - 1)));
      }
      for (const at of [...chosen].sort((a, b) => a - b)) {
        const { text, step } = distinct[at];
        played.push(
          `{"world":${JSON.stringify(name)},"transcript":${JSON.stringify(transcript)},"step":${step + 1},"stored":${text}}`,
        );
      }
    }
  }
  return `{\n"initial":{\n${initial.join(',\n')}\n},\n"played":[\n${played.join(',\n')}\n]\n}\n`;
}

// ---- stored-reopened.json: stored worlds edited against their world, with what the engine makes of each ----

/** Every fourth corpus world, and the printers' shop: enough worlds to meet every kind of declaration. */
const sampledWorlds = () =>
  corpusWorlds().filter((name, i) => i % 4 === 0 || name === 'printers_shop');

/** A declared default as its stored value is written: an option its text, a list its elements. */
function storedDefault(literal) {
  switch (literal.kind) {
    case 'boolean':
    case 'integer':
    case 'string':
      return literal.value;
    case 'option-literal':
      return literal.name.text;
    case 'list-literal':
      return literal.elements.map(storedDefault);
  }
  throw new Error(`a default of kind ${literal.kind} has no stored form.`);
}

/** A value that is not one of `type`: the wrong JSON type for it. */
const wrongTyped = (type) => (type.type === 'integer' ? true : 1);

/** Some value of `type`, for a list that repeats it. */
function someValue(type) {
  switch (type.type) {
    case 'boolean':
      return true;
    case 'integer':
      return Math.min(Math.max(0, type.min), type.max);
    case 'string':
      return 'x';
    case 'symbol':
      return type.of.options[0];
    case 'list':
      return [];
    default:
      return 'x';
  }
}

/**
 * The edits made to one world's fresh state, each a record or two laid over
 * nothing stored: what the declaration cannot explain, which the engine
 * refuses in words, and what it can, which it saves as the diff form.
 */
function editsOf(catalogue) {
  const world = catalogue.world;
  const declared = [...catalogue.declared.values()]
    .filter((one) => one.id !== world && one.kind !== null)
    .sort((a, b) => a.rank - b.rank);
  const first = declared[0];
  const fresh = (serial, instances, visitors = [], tombstones = []) => ({
    world,
    serial,
    instances,
    visitors,
    tombstones,
  });
  const holding = declared.find((one) => declared.some((other) => other.container === one.id));
  const plain = declared.flatMap((one) =>
    [...one.kind.properties.values()]
      .filter((property) => !property.remembered)
      .map((property) => ({ id: one.id, property })),
  );
  const edits = [];
  if (holding !== undefined) {
    edits.push(['a destroyed declared object', fresh(0, [], [], [holding.id])]);
  }
  edits.push([
    'a declared object the world does not declare',
    fresh(0, [{ id: `${world}.no_such_object` }]),
  ]);
  if (first !== undefined) {
    edits.push([
      'a property the kind does not hold',
      fresh(0, [{ id: first.id, properties: { no_such_property: 1 } }]),
    ]);
    edits.push([
      'a memory of a property the kind does not remember',
      fresh(0, [{ id: first.id, memory: { [world]: { no_such_property: 1 } } }]),
    ]);
  }
  const nested = declared.find((one) => one.container !== world);
  if (nested !== undefined && catalogue.worldKind?.contains === true) {
    edits.push([
      'a declared object moved into the world',
      fresh(1, [{ id: nested.id, container: world, arrival: 1 }]),
    ]);
  }
  edits.push([
    'a spawn of a kind the world does not declare',
    fresh(1, [
      {
        id: `${world}#1`,
        made: { from: 'spawned', kind: `${world}.NoSuchKind` },
        container: world,
        arrival: 1,
      },
    ]),
  ]);
  const typed = plain[0];
  if (typed !== undefined) {
    edits.push([
      'a value not of its type',
      fresh(0, [
        { id: typed.id, properties: { [typed.property.name]: wrongTyped(typed.property.type) } },
      ]),
    ]);
    edits.push([
      'a property at its default',
      fresh(0, [
        {
          id: typed.id,
          properties: { [typed.property.name]: storedDefault(typed.property.declaration.default) },
        },
      ]),
    ]);
  }
  const ranged = plain.find(
    ({ property }) =>
      property.type.type === 'integer' && property.type.max < Number.MAX_SAFE_INTEGER,
  );
  if (ranged !== undefined) {
    edits.push([
      'an integer past its range',
      fresh(0, [
        { id: ranged.id, properties: { [ranged.property.name]: ranged.property.type.max + 1 } },
      ]),
    ]);
  }
  const listed = plain.find(({ property }) => property.type.type === 'list');
  if (listed !== undefined) {
    const one = someValue(listed.property.type.element);
    edits.push([
      'a list with a repeat',
      fresh(0, [{ id: listed.id, properties: { [listed.property.name]: [one, one] } }]),
    ]);
  }
  if (catalogue.arrival !== null && catalogue.visitorKind !== null) {
    edits.push([
      'a reading of a verb the world does not declare',
      fresh(
        2,
        [{ id: `${world}#1`, made: { from: 'visitor' }, container: catalogue.arrival, arrival: 2 }],
        [
          {
            visit: 'visit:Marta',
            nickname: 'Marta',
            instance: `${world}#1`,
            lastPlace: catalogue.arrival,
            referents: [],
            lastReading: { verb: { library: world, name: 'no_such_verb' }, bindings: [] },
          },
        ],
      ),
    ]);
  }
  return edits;
}

async function storedReopened(scratch) {
  await packCorpus(scratch);
  const entries = [];
  for (const name of sampledWorlds()) {
    const bytes = readFileSync(join(scratch, `${name}.sproutworld`));
    const catalogue = loadCartridge(bytes, { caps: DEFAULT_LIMITS.caps });
    const engine = new WasmInstance(shippedModule());
    engine.load(bytes);
    engine.budgets(DEFAULT_LIMITS.budgets, DEFAULT_LIMITS.caps.listElements);
    for (const [edit, input] of editsOf(catalogue)) {
      const entry = { world: name, edit, input };
      try {
        engine.open(JSON.stringify(input));
        entry.saved = JSON.parse(engine.save());
      } catch (err) {
        const said = /^sw_open: status \d+: (.*)$/s.exec(err.message);
        if (said === null) throw err;
        entry.refused = said[1];
      }
      entries.push(JSON.stringify(entry));
    }
  }
  return `[\n${entries.join(',\n')}\n]\n`;
}

// ---- views.json: the polls, each asked of sproutc ----

/** What `sproutc view --golden` says of `visit` in `state`, with the host's step budget for a poll. */
function polled(cartridge, state, visit, pollSteps, scratch) {
  const file = join(scratch, 'state.json');
  writeFileSync(file, state);
  const said = spawnSync(
    sproutc(),
    [
      'view',
      cartridge,
      '--state',
      file,
      '--visit',
      visit,
      '--poll-steps',
      String(pollSteps),
      '--golden',
    ],
    { encoding: 'utf8' },
  );
  if (said.status !== 0) throw new Error(`sproutc view did not poll ${visit}:\n${said.stderr}`);
  return JSON.parse(said.stdout);
}

/** The views golden: the bench cases polled again over the states they hold, and a visitor arriving in every corpus world. */
async function views(scratch) {
  const held = JSON.parse(readFileSync(join(GOLDENS, 'views.json'), 'utf8'));
  const bench = join(GOLDENS, 'views.sproutworld');
  const cases = held.cases.map((one) => ({
    ...one,
    expect: polled(bench, one.state, one.visit, one.limits.pollSteps, scratch),
  }));
  await packCorpus(scratch);
  // An arrival is polled under the host's own figures, which `sproutc` and the engine both start from.
  const limits = held.corpus[0].limits;
  // A world that refuses the arrival, as `capacity-arrival` does on purpose, has no visitor to poll.
  const corpus = corpusWorlds().flatMap((name) => {
    const cartridge = join(scratch, `${name}.sproutworld`);
    const engine = new WasmInstance(shippedModule());
    engine.load(readFileSync(cartridge));
    engine.budgets(DEFAULT_LIMITS.budgets, DEFAULT_LIMITS.caps.listElements);
    engine.openEmpty(readCartridge(readFileSync(cartridge)).header.namespace);
    if (engine.arrive('inspector', 'Inspector', { seed: 0, now: 0 }).result === 'refused')
      return [];
    const state = engine.save();
    return {
      world: name,
      state,
      visit: 'inspector',
      limits,
      expect: polled(cartridge, state, 'inspector', limits.pollSteps, scratch),
    };
  });
  const lines = (list) => `[\n${list.map((one) => JSON.stringify(one)).join(',\n')}\n]`;
  return `{"cases":${lines(cases)},"corpus":${lines(corpus)}}\n`;
}

// ---- seeds.json: the turn seed the host gives a tick or a wake ----

function seeds() {
  const cases = [
    [0, 'yard.kiln', 0],
    [0, 'yard.kiln', 1],
    [1, 'yard.kiln', 0],
    [0, 'yard.oven', 0],
    [7, 'ü', 1],
    [SEED_MAX, 'reach.boat', 3],
    [123456789, 'a.b.c.d.e.f', 40],
    [42, 'x'.repeat(200), 2],
    [0, '', 0],
  ].map(([seed, path, nth]) => ({ seed, path, nth, turn: turnSeed(seed, path, nth) }));
  return `${JSON.stringify({ rule: 'sha256("<seed> <path> <nth>") first 32 bits', cases }, null, 2)}\n`;
}

// ---- the bench cartridges, compiled again from the worlds under corpus/goldens/benches ----

/** An extension the exec bench pins and no host installs: it compiles there, and the cartridge loads without it. */
const SLIDES = {
  name: 'slides',
  major: 1,
  types: [],
  statements: [
    {
      name: 'show',
      parameters: [{ name: 'deck', type: 'string' }],
      describe: false,
      run: ({ arguments: [deck] }) => ({ deck }),
      effect: { safeParse: () => ({ success: true }) },
      transcript: () => 'a slide',
    },
  ],
  skill: '',
};

/** Every object a bundle's graph reaches, once. */
function eachObject(start, visit) {
  const seen = new Set();
  const pending = [start];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next !== 'object' || next === null || seen.has(next)) continue;
    seen.add(next);
    if (next instanceof Map) {
      for (const [key, value] of next) pending.push(key, value);
    } else if (next instanceof Set || Array.isArray(next)) {
      for (const one of next) pending.push(one);
    } else {
      visit(next);
      for (const value of Object.values(next)) pending.push(value);
    }
  }
}

/**
 * Two exec cases run a body the checker refuses, so the bench rewrites them after it compiles: a write
 * through a bound name other than `self` (`set(:count, 7)` on `bystander`), and a `text` outside a describe.
 */
function rewriteExec(node) {
  const receiver = node.receiver;
  if (
    node.kind === 'call' &&
    Array.isArray(node.arguments) &&
    node.arguments[1]?.value === 7 &&
    receiver?.kind === 'binding'
  ) {
    receiver.name.text = 'bystander';
  }
  if (node.kind === 'tell' && node.said?.value === 'Text stands in.') node.kind = 'text';
}

/** What each bench needs beyond its folder: the extensions installed where it compiles, and a rewrite after. */
const BENCHES = {
  eval: {},
  exec: { installed: [MEDIA, SLIDES], rewrite: rewriteExec },
  nicknames: {},
  prose: {},
  readings: {},
  views: {},
};

/**
 * The bench `name` compiled from its folder. It pins the standard library this build carries, and
 * where that is a new one the folder's manifest is rewritten to pin it too, so the folder still packs.
 */
async function benchCartridge(name) {
  const folder = join(GOLDENS, 'benches', name);
  const { installed = [], rewrite } = BENCHES[name];
  const manifestPath = join(folder, 'sprout.json');
  const pinned = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifest = {
    ...pinned,
    libraries: pinned.libraries.map((pin) =>
      pin.name === STANDARD_LIBRARY.name ? { ...pin, sha: libraryHash(STANDARD_LIBRARY) } : pin,
    ),
  };
  if (JSON.stringify(manifest) !== JSON.stringify(pinned)) {
    await writeFormatted(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const { bundle, diagnostics } = compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(manifest, null, 2)),
      manifest,
      files: manifest.files.map(
        (file) => new SourceFile(file, readFileSync(join(folder, file), 'utf8')),
      ),
      libraries: [STANDARD_LIBRARY],
    },
    { mode: 'publish', limits: DEFAULT_LIMITS, extensions: installed },
  );
  if (bundle === null) throw new Error(diagnostics.map((one) => one.message).join('\n'));
  if (rewrite !== undefined) eachObject(bundle, rewrite);
  return emitCartridge(bundle);
}

/** Writes `text` to `file`, as prettier writes it unless prettier ignores the file. */
async function writeFormatted(file, text) {
  const { ignored } = await getFileInfo(file, { ignorePath: join(root, '.prettierignore') });
  writeFileSync(
    file,
    ignored ? text : await format(text, { ...(await resolveConfig(file)), filepath: file }),
  );
}

// ---- the command ----

const WRITERS = {
  'stored-worlds.json': storedWorlds,
  'stored-reopened.json': storedReopened,
  'views.json': views,
  'seeds.json': seeds,
  ...Object.fromEntries(
    Object.keys(BENCHES).map((name) => [`${name}.sproutworld`, () => benchCartridge(name)]),
  ),
};

const name = process.argv[2];
if (name === undefined || !(name in WRITERS)) {
  const known = name !== undefined && name !== '' && existsSync(join(GOLDENS, name));
  console.error(
    known
      ? `${name} is hand-kept: no writer makes it. Edit it by hand, and read the diff before committing it.`
      : `write \`node scripts/write-goldens.mjs <golden>\`, one of: ${Object.keys(WRITERS).join(', ')}.`,
  );
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'sprout-goldens-'));
try {
  const made = await WRITERS[name](scratch);
  const file = join(GOLDENS, name);
  if (typeof made === 'string') await writeFormatted(file, made);
  else writeFileSync(file, made);
  // A bench cartridge is bytes: its diff is the stat, and the bench's own manifest where it moved.
  const touched = name.endsWith('.sproutworld') ? [file, join(GOLDENS, 'benches')] : [file];
  const stat = spawnSync('git', ['--no-pager', 'diff', '--stat', '--', ...touched], {
    cwd: root,
    encoding: 'utf8',
  });
  process.stdout.write(stat.stdout === '' ? `${name}: unchanged\n` : stat.stdout);
  if (stat.stdout !== '') {
    const text = name.endsWith('.sproutworld') ? touched.slice(1) : touched;
    spawnSync('git', ['--no-pager', 'diff', '--', ...text], { cwd: root, stdio: 'inherit' });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
