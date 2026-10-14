// The engine the corpus checks run the CLI on: the one `--engine ts|wasm` names, or the CLI's own default,
// the WebAssembly engine where it is built and the TypeScript one, said in one line, where it is not. Each
// check passes it to every command it runs and names it in its last line.

import { chooseEngine } from '@overstory/sprout-player';

/** The engine `argv` names or the default, said once where the default is not the WebAssembly engine. */
export function corpusEngine(argv) {
  const at = argv.indexOf('--engine');
  const chosen = chooseEngine(at === -1 ? undefined : argv[at + 1]);
  if (chosen.note !== null) console.log(chosen.note);
  return chosen.name;
}
