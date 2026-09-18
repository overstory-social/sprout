import { SPROUT_BUILTIN_KINDS, SPROUT_RESERVED_MESSAGES, wellKnownFor } from './sprout.js';
import { compileSprout, compileSproutKind, printSprout } from './sprout-lang.js';
import { NO_EXTENSIONS, type ExtensionSet } from './extensions.js';
import {
  UNDERSTORY_CASCADE_DEPTH,
  UNDERSTORY_DEFINITION_BYTES_MAX,
  UNDERSTORY_EVENT_BUDGET,
  UNDERSTORY_FIELDS_PER_OBJECT,
  UNDERSTORY_MAX_INSTANCES,
  UNDERSTORY_NODE_DEPTH_MAX,
  UNDERSTORY_SPAWNS_PER_ACTION,
  UNDERSTORY_VERBS_PER_OBJECT,
} from './definitions.js';

// The exportable skill (#347; sprout.md §7 step 9): a SKILL.md a builder
// can hand to an LLM of their choosing to help them write Sprout. It is
// GENERATED here — from the same constants, well-known properties,
// reserved messages and caps the compiler uses, with a worked example
// that is compiled and printed by the compiler itself before it goes in
// — so it cannot drift from the language. A spec pins the checked-in
// copy to this function. It tells the model, firmly, that the builder
// writes the prose and describes the interaction; the model's job is
// correct Sprout around the builder's words, never the words themselves.

const EXAMPLE_KIND = `kind Torch {
  :names ["torch", "brand"]
  :takeable true
  :on_fire false
  :illuminating false

  describe {
    if (self.get(:on_fire)) { text "A pitch torch, burning steadily." }
    else { text "A pitch torch, cold. It wants a light." }
  }

  use (with: object) {
    grammar "light [self] with [with]"
    grammar "use [with] on [self]"
    if (with.get(:on_fire)) {
      self.set(:on_fire, true)
      self.set(:illuminating, true)
      say "The pitch catches with a soft whump."
    } else {
      say "Nothing about that will light a torch."
    }
  }

  changed :illuminating (value) { broadcast :illuminating(value) }
}
`;

const EXAMPLE_ITEM = `object torch: Torch {
  :name "Old torch"
  :names ["torch", "brand", "old torch"]
}
`;

const EXAMPLE_ROOM = `room cellar {
  :illuminated false
  prose "Pitch dark. You can feel a wall, and cold air moving."

  describe {
    if (self.get(:illuminated)) { text "A vaulted cellar. Barrels along one wall; a stair up." }
    else { text "Pitch dark. You can feel a wall, and cold air moving." }
  }

  on :illuminating (from, value) { self.set(:illuminated, value) }

  accept (item, from) {
    if (item.is(Actor) && !self.get(:illuminated)) { refuse "Too dark to find the stair." }
    else { allow }
  }

  exit "up the stair" to hall
}
`;

/** The worked example, compiled and printed — so the skill's own Sprout is always valid Sprout. */
export function sproutSkillExamples(): { kind: string; item: string; room: string } {
  const kind = compileSproutKind(EXAMPLE_KIND);
  const item = compileSprout(EXAMPLE_ITEM, { zoneKinds: new Map([['Torch', kind.definition!]]) });
  const room = compileSprout(EXAMPLE_ROOM, { rooms: new Map([['hall', 'hall']]) });
  for (const r of [kind, item, room]) {
    if (!r.definition) {
      throw new Error(
        `the skill's example does not compile: ${r.problems.map((p) => p.message).join(' ')}`,
      );
    }
  }
  return {
    kind: printSprout(kind.definition!),
    item: printSprout(item.definition!),
    room: printSprout(room.definition!, { roomIdents: new Map([['hall', 'hall']]) }),
  };
}

/**
 * The SKILL.md, as text, for the language AS CONFIGURED: an extension's
 * well-known properties join the table and its own paragraph joins the
 * text, so a host with pictures teaches pictures and a plain host does
 * not.
 */
export function sproutSkill(ext: ExtensionSet = NO_EXTENSIONS): string {
  const ex = sproutSkillExamples();
  const rows = new Map<string, string>();
  for (const role of ['room', 'item'] as const) {
    for (const [name, f] of wellKnownFor({ role, inherit: 'Container' }, ext)) {
      if (rows.has(name)) continue;
      const applies =
        name === 'illuminated'
          ? 'rooms'
          : name === 'open' || name === 'capacity'
            ? 'containers (rooms, and kinds that inherit Container)'
            : ext.wellKnownFor('room').some((w) => w.name === name)
              ? 'rooms, items and kinds'
              : 'items';
      const def = f.default === null ? 'none' : String(f.default);
      rows.set(name, `| \`:${name}\` | ${f.type} | ${def} | ${applies} |`);
    }
  }
  const wellKnown = [...rows.values()].join('\n');
  const reserved = [...SPROUT_RESERVED_MESSAGES].map((m) => `\`${m}\``).join(', ');
  const extensions = ext.extensions
    .map((e) => {
      const statements = Object.entries(e.statements ?? {}).map(([k, spec]) => {
        const args = spec.args
          .map((a) => {
            const shape =
              a.kind === 'target'
                ? '<target>'
                : a.kind === 'symbol'
                  ? ':property'
                  : a.kind === 'string'
                    ? '"…"'
                    : '(expr)';
            return a.optional ? `[${shape}]` : shape;
          })
          .join(' ');
        const where = spec.inDescribe ? 'anywhere but a guard' : 'not `describe`, not a guard';
        return `- \`${k}${args ? ` ${args}` : ''}\` — ${where}.`;
      });
      const types = (e.valueTypes ?? []).map(
        (t) =>
          `- \`:name ${t.literal.keyword}${t.literal.takes === 'none' ? '' : t.literal.takes === 'string' ? ' "…"' : ' ["…"]'}\` — a ${t.name} property.`,
      );
      return [
        `### \`use ${e.name}\``,
        '',
        e.skill ?? `The ${e.name} extension.`,
        ...(types.length > 0 ? ['', ...types] : []),
        ...(statements.length > 0 ? ['', ...statements] : []),
      ].join('\n');
    })
    .join('\n\n');
  return `---
name: sprout
description: Write Sprout, the language of Overstory's Understory — rooms, items and kinds with properties, messages, handlers and guards — around the builder's own prose. Use when someone is building an understory and wants help with the syntax, the shape of a kind, or why the compiler refused something.
---

# Sprout

Sprout is the small language that makes an Understory move: what a room, an item or a kind holds, shows and does when a visitor types "light the torch with the flint". This skill is generated from the compiler's own definitions (its well-known properties, its reserved names, its caps, and a worked example the compiler compiled and printed itself), so what it says is what the compiler accepts.

## Your job, and the builder's

**The builder writes the prose and describes the interaction. You write Sprout around their words.** Every \`say\`, \`text\`, \`prose\` and \`refuse\` string is theirs: ask for it, quote it back, keep it exactly. Never invent a room's description, an item's line, or a refusal's wording. If they say "the lamp should light when you use the flint on it, and say something about the smell of oil", the sentence about the smell of oil is for them to write; the \`use (with: object)\` message and its guard are for you.

When the compiler refuses something, read its message: it names the line and column, and it says what the language can and cannot do. Fix the Sprout; do not change their words to make it fit.

## The shape

One object per source. A source starts with one of:

- \`room <name> { … }\` — a room. Rooms have \`exit "label" to <room_name>\` lines; room names are the identifier of the room's name (\`the_kitchen\`).
- \`object <name> { … }\` or \`object <name>: <Kind> { … }\` — an item, on its own or an instance of a kind. An instance may set property values, \`:name\`, \`:names\`, \`prose\` and \`describe\` — not messages or handlers; those belong to the kind.
- \`kind <Name> { … }\` or \`kind <Name>: <Parent> { … }\` — behaviour and defaults, never placed. Kind names are capitalised; object and room names are lower_case.

Inside the braces, in any order:

- \`:name "Display name"\` (optional; the name is humanised from the identifier otherwise), \`:names ["torch", "brand"]\` (what a visitor may call it), \`prose "…"\` (what \`describe\` falls back to).
- Properties: \`:lit false\`, \`:fuel 3 min 0 max 10\` (an integer clamps), \`:state one_of [wet, fired] default wet\` (a symbol from a set), \`:label "Sold out"\` (a short text). An extension the host installs may add more (below).
- \`:remembers [seen: false, cups: 0 min 0 max 99]\` — what the object remembers about each visitor, read with \`actor.recall(:seen)\`, written with \`actor.remember(:seen, true)\`.
- \`describe { … }\` — the object's prose right now, with \`text "…"\` lines (paragraphs). Describe READS — anything in range — and never writes or sends: no \`set\`, \`adjust\`, \`remember\`, \`send\`, \`broadcast\`, \`move\`, \`spawn\` or \`destroy\` in it (only \`if\`, \`text\`, \`each\`, and an extension's statement marked for describe).
- Messages: \`name { … }\`, \`name (with: object) { … }\` (an argument is always an object), \`name when (expr) { … }\` (offered only while it holds), \`name (with: object) abstract\` (on a kind: children must define it). \`grammar "light [self] with [with]"\` lines inside the body are what a visitor may type; without any, the name itself is the line.
- Handlers: \`on :message (from, value) { … }\` runs when a message arrives; \`changed :property (value, was) { … }\` runs when self's property changed. \`_\` leaves a parameter unnamed.
- Containers: \`pass :message (expr)\` / \`pass any (expr)\` on a container kind decides whether a broadcast carries through it (rooms pass inward, never out; a container passes while \`:open\`).
- Consent guards: \`depart (to) { … }\` on the thing moving, \`release (item, to) { … }\` on where it is, \`accept (item, from) { … }\` on where it goes — bodies may only test, \`allow\` or \`refuse "…"\`.

## Statements

\`if (expr) { … } else if (expr) { … } else { … }\`; \`self.set(:p, expr)\`; \`self.adjust(:p, expr)\`; \`say "…"\` (to the actor); \`text "…"\` (describe only); \`broadcast :m\` or \`broadcast :m(expr)\` (to everything in range, through containers); \`send <target> :m\` or \`send <target> :m(expr)\` (to one object); \`actor.remember(:p, expr)\`; \`move <what> to <target>\` (a proposal: the three guards are asked); \`spawn Kind in <target>\`; \`destroy self\`; \`each x in <target> { … }\` (a container's direct contents); \`allow\` / \`refuse "…"\` (guards only).

**Only \`self\` may be written.** To change the room, \`send room :message\` and let the room's handler decide. Targets are \`self\`, \`room\`, \`container\`, \`actor\`, an argument or parameter, or a named object in range.

## Expressions

Literals (\`true\`, \`false\`, integers, \`"strings"\`, \`none\`), symbols (\`:wet\`), \`target.get(:p)\`, \`actor.recall(:p)\`, \`target.is(Kind)\` (also \`Actor\`, \`Room\`, \`Container\`), \`target.count\`, a parameter's value by name, \`! && || == != < <= > >= + -\`, parentheses. Integers only; no strings are joined — say what you mean in the string.

## Well-known properties

Every object has these without declaring them, with these defaults; declaring one with another type is refused where it applies.

| property | type | default | applies to |
|---|---|---|---|
${wellKnown}

## Extensions

A source may begin with \`use <name>\` lines naming extensions the host installed; each adds value types, well-known properties and statements. An extension's statement records something for the host to act on after the action (a picture to open) and never changes the world itself. A source that uses an extension the host lacks does not compile.

${extensions || '_This host has installed none._'}

## Reserved names

The engine sends these; they are never verbs a visitor types, and a message may not be named after one: ${reserved}. Built-in kinds: ${SPROUT_BUILTIN_KINDS.map((k) => `\`${k}\``).join(', ')} (\`Actor\` cannot be inherited). Keywords cannot be message names.

## What the compiler refuses

A write to anything but \`self\`; a property self does not declare (well-known ones excepted); a value of the wrong type; \`adjust\` on a non-integer; \`text\` outside \`describe\`, and \`say\` or anything that writes or sends inside it; \`allow\`/\`refuse\` outside a guard, or anything else inside one; a grammar slot that is not \`[self]\` or an argument; an abstract message on anything placed; behaviour on an instance of a kind; \`pass\` off a container; a kind inheriting itself or one that does not exist; more than ${UNDERSTORY_FIELDS_PER_OBJECT} properties or ${UNDERSTORY_VERBS_PER_OBJECT} messages per object; nesting deeper than ${UNDERSTORY_NODE_DEPTH_MAX} (an \`else if\` chain counts as one); a source over ${UNDERSTORY_DEFINITION_BYTES_MAX / 1024} KB.

At runtime, an action **faults** and is rolled back past ${UNDERSTORY_CASCADE_DEPTH} events deep or ${UNDERSTORY_EVENT_BUDGET} events in one action (two objects answering each other forever), more than ${UNDERSTORY_SPAWNS_PER_ACTION} spawns in one action, or ${UNDERSTORY_MAX_INSTANCES} live things in a zone.

## A worked example

A kind, an item of it, and a room — compiled and printed by the compiler.

\`\`\`sprout
${ex.kind}\`\`\`

\`\`\`sprout
${ex.item}\`\`\`

\`\`\`sprout
${ex.room}\`\`\`

A visitor in the cellar holding the old torch and a lit candle types \`light the torch with the candle\`: the torch's \`use\` runs, its \`:illuminating\` changes, the hook broadcasts, the cellar sets \`:illuminated\`, and the visitor reads the torch's line and the cellar's new description — one block of text.
`;
}
