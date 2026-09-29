import { useEffect, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';

import { CLIENT_COMMANDS, completions, History } from './input.js';
import { furthestBack, rowsOf, shown } from './screen.js';
import type { Session } from './session.js';
import { healthOf, TROUBLED_FOR, visible, type Health, type Line } from './state.js';

// The client on a terminal (Ink), filling the window: the header, then
// the transcript, then the input between two rules, then the place, what
// else it holds and its ways out (the manual's Serving a world ›
// Connecting). The transcript is wrapped to the window and redrawn whole,
// so a record shows while its level is shown, and scrolled back it holds
// still as lines arrive.

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

/** The header's mark for each state of the connection, and its words. */
const HEALTH: Readonly<Record<Health, { color: string; words: string }>> = {
  connecting: { color: 'gray', words: 'connecting' },
  open: { color: 'green', words: 'connected' },
  troubled: { color: '#ff8800', words: 'errors lately' },
  lost: { color: 'red', words: 'disconnected' },
};

/** The rows everything but the transcript takes: the header, the input and its two rules, and the place's two. */
const FIXED_ROWS = 6;

export function App({ session }: { readonly session: Session }) {
  const { exit } = useApp();
  const size = useWindowSize();
  const columns = size.columns || 80;
  const height = size.rows || 24;
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
  // How many rows back from the newest the transcript is scrolled, and how many rows it had then.
  const scroll = useRef({ back: 0, total: 0 }).current;

  const { state } = session;
  const troubledAt = state.troubledAt;
  // The header turns back from troubled when the minute is up, with nothing else arriving to redraw it.
  useEffect(() => {
    if (troubledAt === null) return;
    const left = troubledAt + TROUBLED_FOR - session.now();
    if (left <= 0) return;
    const timer = setTimeout(redraw, left + 1);
    return () => clearTimeout(timer);
  }, [session, troubledAt]);

  const popup = draft.startsWith('/')
    ? CLIENT_COMMANDS.filter((one) => `/${one.name}`.startsWith(draft.split(' ')[0]!))
    : [];
  const transcriptRows = Math.max(
    1,
    height - FIXED_ROWS - (popup.length > 0 ? popup.length + 2 : 0),
  );
  const rows = rowsOf(visible(state.lines, session.shown), columns);
  // Scrolled back, the rows in view stay in view as new ones arrive; at the foot, the newest show.
  if (scroll.back > 0) scroll.back += rows.length - scroll.total;
  scroll.total = rows.length;
  scroll.back = Math.min(scroll.back, furthestBack(rows.length, transcriptRows));

  useInput((input, key) => {
    const now = typing.current;
    const page = Math.max(1, transcriptRows - 1);
    if (key.pageUp || key.pageDown || key.home || key.end) {
      if (key.pageUp) scroll.back += page;
      if (key.pageDown) scroll.back = Math.max(0, scroll.back - page);
      if (key.home) scroll.back = scroll.total;
      if (key.end) scroll.back = 0;
      redraw();
      return;
    }
    if (key.return) {
      history.push(now);
      setDraft('');
      scroll.back = 0;
      void session.type(now).then((goOn) => {
        if (!goOn) exit();
      });
      return;
    }
    if (key.upArrow) return setDraft(history.up(now));
    if (key.downArrow) return setDraft(history.down());
    if (key.tab) {
      const options = completions(now, state.offered);
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

  const health = HEALTH[healthOf(state, session.now())];
  const world =
    state.world === null
      ? ''
      : `  ·  ${state.world}${state.nickname ? ` as ${state.nickname}` : ''}`;
  const inView = shown(rows, transcriptRows, scroll.back);
  const place = state.status?.place ?? (state.closed === null ? 'connecting…' : state.closed);
  return (
    <Box flexDirection="column" width={columns} height={height}>
      <Text wrap="truncate-end">
        <Text color={health.color}>●</Text> {health.words}
        <Text dimColor>{`  ${session.address}`}</Text>
        <Text bold>{world}</Text>
      </Text>
      <Box flexDirection="column" height={transcriptRows} justifyContent="flex-end">
        {inView.map((row, at) => (
          <Text key={at} wrap="truncate" {...STYLE[row.kind]}>
            {row.text === '' ? ' ' : row.text}
          </Text>
        ))}
      </Box>
      {popup.length > 0 && (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          {popup.map((one) => (
            <Text key={one.name}>
              <Text bold>{one.usage}</Text> <Text dimColor>{one.does}</Text>
            </Text>
          ))}
        </Box>
      )}
      <Text dimColor wrap="truncate">
        {rule(columns, scroll.back > 0 ? ` ${scroll.back} more below — PgDn ` : '')}
      </Text>
      <Text wrap="truncate-end">
        <Text color="green">{'> '}</Text>
        {draft}
      </Text>
      <Text dimColor wrap="truncate">
        {rule(columns, '')}
      </Text>
      <Box flexDirection="row" height={2}>
        <Box width={Math.min(place.length + 3, Math.floor(columns / 3))} flexShrink={0}>
          <Text bold wrap="truncate-end">
            {place}
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text wrap="truncate-end">
            <Text dimColor>here </Text>
            {state.status === null || state.status.here.length === 0
              ? '—'
              : state.status.here.join(', ')}
          </Text>
          <Text wrap="truncate-end">
            <Text dimColor>exits </Text>
            {state.status === null || state.status.exits.length === 0
              ? '—'
              : state.status.exits.join(', ')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/** A horizontal rule `columns` wide, with `words` set into it near its start. */
function rule(columns: number, words: string): string {
  const lead = words === '' ? '' : `──${words}`;
  return `${lead}${'─'.repeat(Math.max(0, columns - lead.length))}`;
}

/** What every one of `options` begins with, which tab completes to. */
function commonStart(options: readonly string[]): string {
  let start = options[0]!;
  for (const one of options) {
    while (!one.toLowerCase().startsWith(start.toLowerCase())) start = start.slice(0, -1);
  }
  return start;
}
