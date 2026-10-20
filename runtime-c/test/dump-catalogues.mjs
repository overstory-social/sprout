// The ctest setup that dumps what every packed corpus cartridge declares, as the language reads it
// back with `loadCartridge`, into `catalogues.json` beside the cartridges (`corpus.h` reads it).
// The C catalogue tests hold the runtime's own load of each cartridge to this dump, so the two
// readers agree on what a cartridge says. It runs after `pack-corpus.mjs`, over the folder named
// on the command line. It never writes an empty or partial dump: a language that is not built, a
// world with no cartridge, or a cartridge the language refuses fails the setup in words.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../../..');
const out = process.argv[2];
if (out === undefined) {
  console.error('usage: node dump-catalogues.mjs <folder of packed cartridges>');
  process.exit(2);
}

// A dump left by an earlier run is never what the tests read.
rmSync(join(out, 'catalogues.json'), { force: true });

const built = join(root, 'sprout/lang/dist/index.js');
if (!existsSync(built)) {
  console.error(`the language is not built at ${built}: run \`npm run build\` first.`);
  process.exit(1);
}
const { DEFAULT_LIMITS, kindName, loadCartridge, readCartridge, typeKey } = await import(
  pathToFileURL(built).href
);

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

const worlds = readdirSync(join(root, 'corpus/good')).sort();
if (worlds.length === 0) {
  console.error('corpus/good holds no worlds: there is nothing to dump.');
  process.exit(1);
}
const lines = [];
for (const name of worlds) {
  const file = join(out, `${name}.sproutworld`);
  if (!existsSync(file)) {
    console.error(`${name} has no cartridge at ${file}: the packing setup did not pack it.`);
    process.exit(1);
  }
  const bytes = readFileSync(file);
  try {
    const read = readCartridge(bytes);
    const loaded = dumpCatalogue(loadCartridge(bytes, { caps: DEFAULT_LIMITS.caps }), read.caps);
    lines.push(
      `${JSON.stringify(name)}:${JSON.stringify({ level: read.header.level, title: read.header.title ?? null, ...loaded })}`,
    );
  } catch (error) {
    console.error(`the language did not read ${name}'s cartridge back: ${error.message}`);
    process.exit(1);
  }
}
writeFileSync(join(out, 'catalogues.json'), `{\n${lines.join(',\n')}\n}\n`);
console.log(`dumped the catalogues of ${lines.length} worlds into ${join(out, 'catalogues.json')}`);
