# @overstory/sprout-cli

```sh
npx sprout init shed
npx sprout check shed
```

The Sprout command line on a microworld folder: `sprout.json` beside the
world's `.sprout` and `.prose` files. `play` and `serve` return when the
runtime does (B34, B37).

| command                            | does                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sprout init [dir] [--author name]` | A folder with a manifest, a world and a README line; what it writes passes `check`.                                                  |
| `sprout check [dir] [--json]`      | Compile strictly, as publishing would. Problems by `file:line:column` with what to write instead, or as JSON for an editor. Exit 1 on any. |

The manifest is the spec's (*The world model › The manifest*): `name`,
optional `namespace`, `version`, `author`, `license`, `level`,
`extensions`, `libraries` and `files`. The CLI carries the standard
library, `sprout`, and sends it whenever the manifest names it; `init` pins
it by version and hash, and `check` blesses that hash, so its source costs
the author nothing. A pin at another hash is refused as a library that is
not the source the manifest recorded. Where a vendored copy of any library
lives in a world folder is not yet specified, so no other library is read
from one.

MIT. Imports the Sprout packages and `node:*` only.
