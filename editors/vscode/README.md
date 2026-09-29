# Sprout for VS Code

Colours Sprout worlds: `.sprout` sources and the `.prose` files their
passages live in, with slots coloured inside inline passages and inside
the quoted text of `say`, `tell`, `text` and `refuse`. Brackets pair and
`//` toggles a comment in both. The grammars are TextMate grammars, so
anything else that reads them can use `syntaxes/` as well.

It also runs the Sprout language server
([`editors/language-server`](../language-server)), bundled into it: the
whole world is checked a moment after each edit, each problem shown on the
file it names, and a name can be hovered, gone to and completed. If the
server does not start, the extension says so and files are still
coloured.

## Installing it locally

Build it first, which bundles the client and the language server into
`dist/`:

```sh
npm run build                      # every package, the extension last
```

Then either link the folder into VS Code's extensions and reload the
window:

```sh
ln -s "$PWD/editors/vscode" ~/.vscode/extensions/overstory.sprout-vscode
```

or package it and install the `.vsix`:

```sh
cd editors/vscode
npx @vscode/vsce package --no-dependencies --skip-license
code --install-extension sprout-vscode-0.1.0.vsix
```

## Changing the grammars

The grammars are built by `src/sprout.ts` and `src/prose.ts`, the
reserved words read from the compiler's own list, and written into
`syntaxes/` by

```sh
npm run build -w sprout            # the reserved words come from its build
npm run generate -w editors/vscode
```

The package's spec fails while `syntaxes/` differs from what those
modules build, and it reads every `.sprout` and `.prose` file of the
corpus through the grammars, pinning the scopes of a handful of lines.
