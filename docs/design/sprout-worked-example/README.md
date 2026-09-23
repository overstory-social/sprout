# The worked example — the current Sprout, in one microworld

**This is the file to read when assessing the language for
expressiveness** (Eric, 2026-09-18). One complex microworld, an
archive of five files, that uses every construct the language has
today. `packages/sprout/src/worked-example.spec.ts` compiles it
strictly on every gate run and fails if any statement kind or construct
stops appearing, so it is always what the compiler accepts — never a
sketch that drifted. When the language grows, this grows with it, and
the "proposed, not built" list below shrinks.

The microworld is a pottery: a yard (the door), a shed where cups are
thrown, a kiln shed where they are fired. Read it in this order.

| file               | what it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprout.json`      | the manifest: format, language level, the entry room, the extensions the files `use`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `kinds.sprout`     | kinds and inheritance (`Cup: Vessel`, `Lantern: Usable`), an **abstract** message, every property type (`boolean`, `integer min/max`, `one_of … default`, a `string`, a `media` value), a `remembers` block, `describe` with an `if / else if / else` chain, messages with **arguments**, several **`grammar`** lines and a **`when`** guard, `adjust`, **hooks** (`changed :lit`) that `broadcast`, **handlers** (`on :gust`, `on :fired`, `on :spawned`, `on :used` → `destroy self`), a container kind with **`pass`** rules and a **`release`** guard; a **`depart`** guard on `Vessel` (a raw pot refuses to be lifted) |
| `yard.sprout`      | `use media`; a room with `:image` and `show` in `describe`; a `remembers` block on a room with `actor.remember` / `actor.recall`; exits; `on :entered` as arrival prose; a message on the room itself that `broadcast`s; an instance of a kind (`lantern: Lantern`) setting only initial values; `:scenery`                                                                                                                                                                                                                                                                                                                  |
| `shed.sprout`      | placement in the head, **nested** (`lump_a: Lump in bin`, `bin: Container in shed`); `spawn Cup in room`; a message that `send`s to its argument (`send from :used`); `bin.count` read from the room's `describe` — a named object in range; `each … in self` inside `describe`                                                                                                                                                                                                                                                                                                                                       |
| `kiln_shed.sprout` | a container object with `accept` (refusing an actor) and `release` (while hot) guards and `allow` / `refuse`; `each pot in self { send pot :fired }`; **`move pot to shelf`** from a body — a proposal the shelf's guards answer; `send with :struck` to an argument by parameter name; a `changed` hook on a kind speaking when a bowl comes out glazed                                                                                                                                                                                                                                                              |

Every statement kind appears: `if`, `set`, `adjust`, `remember`, `say`,
`text`, `broadcast`, `send`, `each`, `move`, `spawn`, `destroy`,
`allow`, `refuse`, and an extension statement (`show`).

## Two things about names, for the record

Names are two different things, and the example keeps them apart:

- **What a player types** — `take the pot`, `grab the cup`, `dip the
bowl in the tenmoku` — resolves through `:names` (plus the display
  name, the kind's name, and an enum value as an adjective: "the dry
  bowl"). Three cups in three rooms need nothing special for that.
- **What code names** — `send kiln :stoke`, `exit "up" to hall`,
  `object coin in chest`, `bin.count` — is the **identifier**, the word
  after `object` / `room`. A microworld has one namespace for rooms and
  objects at compile time (the compiler must know which `bench` a file
  means), and spawned instances have ids of their own (`spawn-<n>`) and
  are addressed as a kind, never by identifier. At **run** time a name
  already resolves among the objects in reach of the sender's room, so
  two `bench`es in two rooms would never be confused at play; the
  constraint is the compile-time one. Eric decided (2026-09-18, on
  #525's thread) that the product's save refuses a repeated identifier in the zone,
  which is what the microworld compile requires anyway.

## Proposed, not built (Eric, 2026-09-18, in conversation; no issue yet)

Recorded here so the binding semantics get designed once, crisply,
rather than case by case. None of this is in the language; the example
above compiles without it.

1. **Rooms as scopes.** Think of a room as a stack frame or a closure:
   `bench` in the porch and `bench` in the shed are two variables each
   bound to an instance in its own scope, and since a body cannot read
   or write across rooms, the same word twice is fine. This would lift
   the compile-time single namespace to per-room; an `exit … to <room>`
   and a `send` across rooms would need a qualified form (`shed.bench`,
   say). Open: what `in <container>` names when the container is in
   another room; how the CLI's `check` reports a name that resolves in
   two scopes.
2. **A dynamic query.** `ofkind Bench` (an expression over what is in
   range, or the whole microworld) yielding a **collection** that a body
   can message: `each b in ofkind Bench { send b :creak }`. Today `each`
   walks one container's direct contents and `send` reaches one object;
   spawned instances are reachable only that way. Open: range
   (in-reach vs. everywhere — the latter breaks the "containers are the
   bus" rule), determinism (delivery order is declaration then spawn
   order, which a collection would inherit), budget (a collection is
   bounded by the instance cap, so a fault is impossible but cost is
   not).
3. **Spawn with overrides.** `spawn Bench { :name "a previously
invisible bench" :hidden true } in shed` — today `spawn Kind in
<target>` makes an instance at the kind's defaults and the birth
   line is the kind's `on :spawned`. Open: which members an override
   may carry (the same set an instance may: initial values, name(s),
   prose, describe?), and whether the override is a literal or may read
   the frame.
4. **Explicit binding.** `object bench: Bench { … } in porch` already
   binds a name to an instance at load; a runtime `let`/assignment
   (`collection benches = ofkind Bench`) would be the first mutable
   variable in the language, which today has none outside object state.
   Open: scope (a body? a room? the microworld?), persistence (does a
   binding survive the turn? if so it is state and belongs on an
   object).

## Gaps the example ran into

- **An instance cannot set an enum's initial value without restating
  the options.** `object bowl: Bowl in shelf { :state one_of [raw, …]
default dry }` is the only spelling; a bare `:state :dry` (a symbol
  literal as a property value) is not parsed. A one-line grammar
  addition; noted rather than done so the language changes in one
  place.
- **`destroy` is self-only, so ending another object is a two-step**:
  the wheel `send`s `:used` to the lump, and the lump's handler says
  `destroy self`. That is the design (§2.8: an object ends itself), and
  the example shows the idiom.
