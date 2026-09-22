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
`extensions`, `libraries` and `files`. Vendored libraries have no on-disk
layout yet; a folder is read as a world with none.

MIT. Imports the Sprout packages and `node:*` only.
