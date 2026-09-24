# @overstory/sprout-cli

```sh
npx sprout init shed
npx sprout check shed
npx sprout parse shed "look"
npx sprout view shed
```

The Sprout command line on a microworld folder: `sprout.json` beside the
world's `.sprout` and `.prose` files. `play` and `serve` are not built.

| command                                            | does                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprout init [dir] [--author name]`                | A folder with a manifest, a world and a README line; what it writes passes `check`.                                                                                                                                                                                                                                                                 |
| `sprout check [dir] [--json]`                      | Compile strictly, as publishing would. Problems by `file:line:column` with what to write instead, or as JSON for an editor. Exit 1 on any.                                                                                                                                                                                                          |
| `sprout parse [dir]`                               | Every phrase the world accepts, under its verb and roles, in the order the parser tries them; the first that reads wins.                                                                                                                                                                                                                            |
| `sprout parse dir "line" [--at place] [--as name]` | What a visitor standing at `place` (by default where visitors arrive) makes of the line: the reading, what fills each role, and whether its consent pass refuses, in the refuser's words; or the world's `unknown`, `not_here` or `which`, with the line that means each candidate. The reading is never run. Exit 1 where reading the line faults. |
| `sprout view [dir] [--at place] [--as name]`       | What a poll gives that visitor: the place's description, the ways out, who else is there, what they carry, and every reading they could type with its refusal and its value roles' options. Exit 1 where the poll faults, after the fault the host would log.                                                                                       |

The manifest is the spec's (_The world model › The manifest_): `name`,
optional `namespace`, `version`, `author`, `license`, `level`,
`extensions`, `libraries` and `files`. The CLI carries the standard
library, `sprout`, and sends it whenever the manifest names it; `init` pins
it by version and hash, and `check` blesses that hash, so its source costs
the author nothing. A pin at another hash is refused as a library that is
not the source the manifest recorded. Where a vendored copy of any library
lives in a world folder is not yet specified, so no other library is read
from one.

The inspectors stand one visitor in the world as it loads, under the
host's default limits: they come in by an arrival turn, and `--at`
brings them in to that place as a returning visitor comes back to where
they last stood, so a place whose `accept` refuses them is said to. A
place is written as the world's body names it, `shop.loft`; a refused
world prints what `check` prints.

MIT. Imports the Sprout packages and `node:*` only.
