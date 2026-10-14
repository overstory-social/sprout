// `node scripts/write-goldens.mjs <golden>` rewrites one file under corpus/goldens on purpose and
// prints its diff, which is read before it is committed; the gate never runs it. The goldens are
// fixtures the C tests replay (docs/design/sprout-test-harness.md, the golden layer), so each is
// written by what owns its content: the C runtime (`sproutc`, and the WebAssembly engine) for what
// a turn or a poll gives, the language for what a cartridge declares, the host for the turn seed.
// A golden with no writer here is hand-kept, and the script says so.
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
  kindName,
  libraryHash,
  loadCartridge,
  MEDIA,
  readCartridge,
  readStoredWorld,
  SEED_MAX,
  SourceFile,
  STANDARD_LIBRARY,
  typeKey,
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

// ---- catalogues.json: what each corpus cartridge declares, read back by the language ----

function defaultOf(literal) {
  switch (literal.kind) {
    case 'boolean':
      return { boolean: literal.value };
    case 'integer':
      return { number: literal.value };
    case 'string':
      return { string: literal.value };
    case 'option-literal':
      return { option: literal.name.text };
    case 'list-literal':
      return { list: literal.elements.map(defaultOf) };
  }
  throw new Error(`a default of kind ${literal.kind} has no form in the dump.`);
}

function kindOf(kind, spawnable) {
  return {
    name: kindName(kind),
    spawnable,
    order: [...kind.order],
    contains: kind.contains,
    containsActors: kind.containsActors,
    roams: kind.roams,
    properties: [...kind.properties.values()].map((property) => ({
      name: property.name,
      type: typeKey(property.type),
      remembered: property.remembered,
      origin: property.origin,
      default: defaultOf(property.declaration.default),
    })),
    passages: [...kind.passages.keys()],
    plays: [...kind.plays].map(([key, plays]) => [key, plays.length]),
  };
}

const phraseText = (phrase) =>
  phrase.parts.map((part) => (part.part === 'slot' ? `{${part.role}}` : part.text)).join('');
const partsText = (parts) =>
  parts.map((part) => ('slot' in part ? `{${part.slot}}` : part.words.join(' '))).join('|');
const verbName = (verb) => `${verb.library}.${verb.name}`;

/** A loaded catalogue as the dump the C catalogue tests compare with; `recorded` is the caps the cartridge was checked against. */
function dumpCatalogue(catalogue, recorded) {
  const spawnable = new Set(catalogue.kinds.keys());
  return {
    world: catalogue.world,
    arrival: catalogue.arrival,
    worldKind: catalogue.worldKind === null ? null : kindName(catalogue.worldKind),
    visitorKind: catalogue.visitorKind === null ? null : kindName(catalogue.visitorKind),
    declared: [...catalogue.declared.values()]
      .sort((a, b) => a.rank - b.rank)
      .map((one) => [
        one.id,
        one.container,
        one.kind === null ? null : kindName(one.kind),
        one.rank,
      ]),
    kinds: catalogue.lookup.all().map((kind) => kindOf(kind, spawnable.has(kindName(kind)))),
    verbs: catalogue.verbs.all().map((verb) => ({
      name: verbName(verb),
      roles: verb.roles.map((role) => [
        role.name,
        role.filler === null
          ? 'none'
          : role.filler.fills === 'kind'
            ? `kind ${kindName(role.filler.kind)}`
            : role.filler.fills,
        role.many,
        role.optional,
        role.carried,
      ]),
      phrases: verb.phrases.map(phraseText),
    })),
    phrases: catalogue.phrases.map((one) => [verbName(one.verb), partsText(one.parts), one.only]),
    intentPhrases: catalogue.intentPhrases.map((one) => [
      `${one.intent.library}.${one.intent.name}`,
      partsText(one.parts),
    ]),
    messages: catalogue.messages
      .all()
      .map((one) => [
        `${one.library}.${one.name}`,
        one.carries === null ? null : typeKey(one.carries),
      ]),
    words: [...catalogue.words],
    extensions: [...catalogue.extensions.values()].map((one) => [one.name, one.major]),
    caps: { ...recorded },
  };
}

async function catalogues(scratch) {
  await packCorpus(scratch);
  const lines = corpusWorlds().map((name) => {
    const bytes = readFileSync(join(scratch, `${name}.sproutworld`));
    const read = readCartridge(bytes);
    const loaded = dumpCatalogue(loadCartridge(bytes, { caps: DEFAULT_LIMITS.caps }), read.caps);
    return `${JSON.stringify(name)}:${JSON.stringify({ level: read.header.level, ...loaded })}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
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
      const stage = freshStage(bundle, 'wasm');
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
  const corpus = corpusWorlds().map((name) => {
    const cartridge = join(scratch, `${name}.sproutworld`);
    const engine = new WasmInstance(shippedModule());
    engine.load(readFileSync(cartridge));
    engine.budgets(DEFAULT_LIMITS.budgets, DEFAULT_LIMITS.caps.listElements);
    engine.openEmpty(readCartridge(readFileSync(cartridge)).header.namespace);
    engine.arrive('inspector', 'Inspector', { seed: 0, now: 0 });
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
  'catalogues.json': catalogues,
  'stored-worlds.json': storedWorlds,
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
