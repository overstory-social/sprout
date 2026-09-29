import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { arrive, leave, say, type Answer, type Session } from './session.js';

// A session as MCP tools, for one connection: `arrive`, `say` and `leave`,
// and nothing else an agent could reach the world or the host through.
// A connection is one visitor: its first arrival binds it to the name it
// arrived as, and every call after names that visitor, so several agents
// sharing a world over HTTP each act only as themselves. What the tools
// say is written for someone playing, and names no file, path or command.

/** How the server introduces itself: the premise, and nothing of how it is made. */
const INSTRUCTIONS =
  'You are a visitor in a place made of words. Arrive with a name, then say what you do, one line ' +
  'at a time, as you would type it: "look", "take the lamp", "go north". Each call answers with ' +
  'what you read.';

/** `answer` as a tool's result: what the visitor reads, an error where the call was refused. */
function resultOf(answer: Answer): CallToolResult {
  return {
    content: [{ type: 'text', text: answer.text }],
    ...(answer.refused ? { isError: true } : {}),
  };
}

/** A server for one connection over `session`, bound to the first name it arrives as. */
export function worldServer(session: Session): McpServer {
  const server = new McpServer(
    { name: 'sprout-world', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );
  let bound: string | null = null;
  /** Refused where this connection is someone other than `name`. */
  const as = (name: string): Answer | null =>
    bound === null || bound === name.trim()
      ? null
      : { text: `You are ${bound} here, and act only as ${bound}.`, refused: true };

  server.registerTool(
    'arrive',
    {
      title: 'Arrive',
      description: 'Come into the world under a name. Answers with what you see as you arrive.',
      inputSchema: { name: z.string().describe('The name you go by here.') },
    },
    ({ name }) => {
      const other = as(name);
      if (other !== null) return resultOf(other);
      const answer = arrive(session, name);
      if (!answer.refused) bound = name.trim();
      return resultOf(answer);
    },
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
    ({ name, line }) => resultOf(as(name) ?? say(session, name.trim(), line)),
  );

  server.registerTool(
    'leave',
    {
      title: 'Leave',
      description: 'Leave the world. Answers with what you read as you go.',
      inputSchema: { name: z.string().describe('The name you arrived as.') },
    },
    ({ name }) => resultOf(as(name) ?? leave(session, name.trim())),
  );

  return server;
}
