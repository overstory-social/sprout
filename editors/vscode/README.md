# Sprout for VS Code

Colours Sprout worlds: `.sprout` sources and the `.prose` files their
passages live in, with slots coloured inside inline passages and inside
the quoted text of `say`, `tell`, `text` and `refuse`. Brackets pair and
`//` toggles a comment in both. It is TextMate grammars only, so anything
else that reads TextMate grammars can use `syntaxes/` as well.

## Installing it locally

From a checkout, either link the folder into VS Code's extensions and
reload the window:

```sh
ln -s "$PWD/editors/vscode" ~/.vscode/extensions/overstory.sprout-vscode
```

or package it and install the `.vsix`:

```sh
cd editors/vscode
npx @vscode/vsce package --allow-missing-repository --skip-license
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
