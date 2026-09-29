import { useEffect, useReducer, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';

import { CLIENT_COMMANDS, completions, History } from './input.js';
import type { Session } from './session.js';
import { statusWords, visible, type Line } from './state.js';

// The client on a terminal (Ink): the transcript in real scrollback, each
// line styled by what it is and a visitor's words apart from the world's;
// the status line at the bottom, the place then its ways out; and the
// input line under it, with the lines typed before on up and down, tab
// completing from what the world offers, and a popup of the client's own
// commands while a `/` is being typed. A host record is shown as it arrives
// where its level is shown then.

/** How each kind of line is shown. */
const STYLE: Readonly<
  Record<Line['kind'], { color?: string; dimColor?: boolean; italic?: boolean }>
> = {
  said: {},
  told: {},
  described: {},
  refused: { color: 'red' },
  notice: { italic: true },
  extension: { color: 'blue' },
  chat: { color: 'magenta' },
  record: { dimColor: true },
  client: { color: 'yellow' },
  typed: { dimColor: true },
};

export function App({ session }: { readonly session: Session }) {
  const { exit } = useApp();
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => session.onChange(redraw), [session]);
  // The line being typed lives in a ref, so keys that arrive between renders each see the last.
  const typing = useRef('');
  const [draft, show] = useState('');
  const setDraft = (next: string) => {
    typing.current = next;
    show(next);
  };
  const history = useRef(new History()).current;

  useInput((input, key) => {
    const now = typing.current;
    if (key.return) {
      history.push(now);
      setDraft('');
      void session.type(now).then((goOn) => {
        if (!goOn) exit();
      });
      return;
    }
    if (key.upArrow) return setDraft(history.up(now));
    if (key.downArrow) return setDraft(history.down());
    if (key.tab) {
      const options = completions(now, session.state.offered);
      if (options.length > 0) setDraft(commonStart(options));
      return;
    }
    if (key.backspace || key.delete) return setDraft(now.slice(0, -1));
    if (key.ctrl && input === 'c') {
      void session.type('/quit').then(() => exit());
      return;
    }
    if (input !== '' && !key.ctrl && !key.meta) setDraft(now + input);
  });

  // The transcript only grows: each line is shown or not as it arrives, so `/log` changes what comes after it.
  const printed = useRef<{ seen: number; lines: (Line & { at: number })[] }>({
    seen: 0,
    lines: [],
  }).current;
  const all = session.state.lines;
  for (; printed.seen < all.length; printed.seen++) {
    const line = all[printed.seen]!;
    if (visible([line], session.shown).length > 0)
      printed.lines.push({ ...line, at: printed.seen });
  }
  const lines = [...printed.lines];
  const popup = draft.startsWith('/')
    ? CLIENT_COMMANDS.filter((one) => `/${one.name}`.startsWith(draft.split(' ')[0]!))
    : [];
  return (
    <>
      <Static items={lines}>
        {(line) => (
          <Text key={line.at} {...STYLE[line.kind]}>
            {line.text}
          </Text>
        )}
      </Static>
      {popup.length > 0 && (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          {popup.map((one) => (
            <Text key={one.name}>
              <Text bold>{one.usage}</Text> <Text dimColor>{one.does}</Text>
            </Text>
          ))}
        </Box>
      )}
      <Text
        inverse
      >{` ${statusWords(session.state.status) || session.state.closed || 'connecting…'} `}</Text>
      <Text>
        <Text color="green">{'> '}</Text>
        {draft}
      </Text>
    </>
  );
}

/** What every one of `options` begins with, which tab completes to. */
function commonStart(options: readonly string[]): string {
  let start = options[0]!;
  for (const one of options) {
    while (!one.toLowerCase().startsWith(start.toLowerCase())) start = start.slice(0, -1);
  }
  return start;
}
