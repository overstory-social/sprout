# @overstory/sprout-cli

```sh
npx sprout play packages/sprout-examples/pottery-studio
```

The Sprout command line: a microworld archive — a folder of `*.sprout`
files with a `sprout.json` beside them, or a zip of the same — checked,
walked, served, packed. Authoring is text files in whatever editor you
like; this is the rest.

MIT. Imports the Sprout packages (`@overstory/sprout/lang`, `-core`,
`-store-sql`, `-ext-media`), PGlite and `node:*`, and nothing else.

## Commands

| command                                                                 | does                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprout init [dir]`                                                     | A folder with `sprout.json`, one room, and a README line. The first command.                                                                                                                                                                                            |
| `sprout check [dir\|zip] [--json]`                                      | `compileMicroworld` in strict mode; problems by `file:line:column`, or as JSON (the compiler's `Problem`, exactly) for an editor or a CI step; exit 1 on any.                                                                                                           |
| `sprout play [dir\|zip] [--as name] [--fresh] [--store pglite\|memory]` | `check`, then load and walk it at a prompt: the transcript, ↑ history, Tab completion from the room's own grammar, `help`, `quit`. `--as` names you (default `you`).                                                                                                    |
| `sprout serve [dir\|zip] [--port n] [--host h] [--store …]`             | The same microworld on a TCP line protocol, `127.0.0.1:4040` by default. The first line a connection sends is its name; two terminals see each other's arrivals and moves as they happen. A development toy: **no auth, no TLS** — `--host` widens it at your own risk. |
| `sprout pack [dir] -o world.zip`                                        | The folder as one zip, `check`ed first.                                                                                                                                                                                                                                 |
| `sprout skill`                                                          | The `SKILL.md` for the language as this sprout speaks it — with pictures (`use media`) — for an LLM that writes Sprout with you.                                                                                                                                        |

## State

`play` and `serve` keep the microworld's runtime state — where things
are, what is lit, what objects remember about you — in **`.sprout/`
beside the folder** (`.sprout-<name>/` beside a zip), as a PGlite
database through `@overstory/sprout/store-sql`. A session survives the
process: come back tomorrow and the kettle is still on. The archive is
loaded again only when its files changed (core compares the archive's
stamp); state that still fits is kept, and `--fresh` puts every placed
thing back at home. `--store memory` keeps nothing; `--state <dir>`
puts it elsewhere. `check` reads regular files only, never `.sprout/`.

## The transcript

A room prints as its name between `==`, its paragraphs, what you can
see, and the ways on; what the room says prints as it is; someone
else's move is marked `* `; a picture a `show` opens is named
(`[a picture opens: …]`), since a terminal cannot open one. Every typed
line is a `say` turn — `help` lists what this room answers to, `look`
looks again, `quit` leaves.

## Archives

`sprout.json` is `{ "format": 1, "language": <level>, "entry": "<room>",
"extensions": [] }`; the files are read in name order and the
directories are for people (`rooms/`, `objects/`, `kinds/` is a
convention, not a rule). An archive that `use`s an extension this CLI
lacks fails `check` with the extension's name; one whose manifest asks
a newer language level than this sprout speaks fails the same way. A
zip is read by its entries (stored or deflate), and `pack` writes one
that the same files always pack to byte for byte.

## In a program

Every command is a function too — `checkArchive`, `play`, `serve`,
`initArchive`, `packArchive`, `readArchive` — so a test or another tool
drives them without a process; `main(argv, io)` is the command line
itself with its streams handed in.
