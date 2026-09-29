import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { arrive, isPresent, leave, say, type Answer, type Session } from './session.js';

// A session as MCP tools, for one connection: `arrive`, `say` and `leave`,
// and nothing else an agent could reach the world or the host through.
// A connection is one visitor: until it arrives it may do nothing else,
// its first arrival binds it to that name, every call after acts as that
// visitor alone, and when the connection closes the visitor leaves. What
// the tools say is written for someone playing: nothing that goes wrong on
// the host's side reaches a visitor in any words but the host's own
// sentence, since an error's text may name a file.

/** How the server introduces itself: the premise, and nothing of how it is made. */
const INSTRUCTIONS =
  'You are a visitor in a place made of words. Arrive with a name, then say what you do, one line ' +
  'at a time, as you would type it: "look", "take the lamp", "go north". Each call answers with ' +
  'what you read.';

/** What a visitor is told where the host, and not the world, failed them. */
export const HOST_FAILED =
  'Something went wrong outside the world, and that may not have happened.';

/** `answer` as a tool's result: what the visitor reads, an error where the call was refused. */
function resultOf(answer: Answer): CallToolResult {
  return {
    content: [{ type: 'text', text: answer.text }],
    ...(answer.refused ? { isError: true } : {}),
  };
}

/** `call`'s answer as a result; where it throws, the host hears why and the visitor the host's sentence. */
function guarded(session: Session, call: () => Answer): CallToolResult {
  try {
    return resultOf(call());
  } catch (error) {
    session.warn(`a call failed: ${error instanceof Error ? error.message : String(error)}`);
    return resultOf({ text: HOST_FAILED, refused: true });
  }
}

/** A server for one connection over `session`, bound to the first name it arrives as. */
export function worldServer(session: Session): McpServer {
  const server = new McpServer(
    { name: 'sprout-world', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );
  let bound: string | null = null;
  /** Refused where this connection has not arrived, or is someone other than `name`. */
  const as = (name: string): Answer | null => {
    if (bound === null) return { text: 'Arrive first.', refused: true };
    if (bound === name.trim()) return null;
    return { text: `You are ${bound} here, and act only as ${bound}.`, refused: true };
  };

  server.registerTool(
    'arrive',
    {
      title: 'Arrive',
      description: 'Come into the world under a name. Answers with what you see as you arrive.',
      inputSchema: { name: z.string().describe('The name you go by here.') },
    },
    ({ name }) =>
      guarded(session, () => {
        if (bound !== null && bound !== name.trim()) {
          return { text: `You are ${bound} here, and act only as ${bound}.`, refused: true };
        }
        const answer = arrive(session, name);
        if (!answer.refused) bound = name.trim();
        return answer;
      }),
  );

  server.registerTool(
    'say',
    {
      title: 'Say',
      description:
        'Do something, as one typed line: "look", "examine the lamp", "go north". Answers with ' +
        'what you read, including anything that happened around you since your last turn.',
      inputSchema: {
        name: z.string().describe('The name you arrived as.'),
        line: z.string().describe('What you type.'),
      },
    },
    ({ name, line }) => guarded(session, () => as(name) ?? say(session, name.trim(), line)),
  );

  server.registerTool(
    'leave',
    {
      title: 'Leave',
      description: 'Leave the world. Answers with what you read as you go.',
      inputSchema: { name: z.string().describe('The name you arrived as.') },
    },
    ({ name }) => guarded(session, () => as(name) ?? leave(session, name.trim())),
  );

  // A connection that goes away takes its visitor with it, as a last `leave` would.
  server.server.onclose = () => {
    if (bound === null || !isPresent(session, bound)) return;
    try {
      leave(session, bound);
    } catch (error) {
      session.warn(
        `${bound} could not leave: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return server;
}
