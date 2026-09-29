# @overstory/sprout-mcp

A Sprout microworld as tools for an agent: one world, freshly loaded,
played as a visitor and only as a visitor over the
[Model Context Protocol](https://modelcontextprotocol.io). It is what
`sprout mcp dir` runs, where it is installed beside
[`@overstory/sprout-cli`](../cli/README.md).

```sh
npm install @overstory/sprout-cli @overstory/sprout-mcp
npx sprout mcp shed --seed 7 --record run.json --turn-cap 150 --advance-per-turn 30s
```

The agent is given three tools, and nothing else to reach the world or
the host through:

| tool              | does                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `arrive(name)`    | comes into the world under a name, and answers with what that visitor reads                                                         |
| `say(name, line)` | types one line as that visitor, and answers with what they read, including anything that happened around them since their last call |
| `leave(name)`     | leaves, and answers with what they read as they go                                                                                  |

What a visitor reads is what a person playing reads: the prose written to
them, one paragraph to a line, and a fault by its name beside the world's
words for it. Nothing an agent is given names a file, a path, a
declaration or a fault's detail, so a playtester is blind by construction.

The host's side is set on the command line and never shown to the agent:

| flag                     | sets                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--seed n`               | the seed every turn starts from (0 otherwise)                                                                                                 |
| `--record file.json`     | writes the session as a script after every step, each step expecting all it made, faults in full; it plays back as written with `sprout play` |
| `--turn-cap n`           | how many lines each visitor may type                                                                                                          |
| `--advance-per-turn 30s` | after each line, a tick of every occupied place and then time moved on, so ticks and wakes happen without a clock                             |
| `--http host:port`       | serves over Streamable HTTP at `/mcp` instead of stdio, so several agents can share one world                                                 |

Over stdio there is one connection and one visitor. Over HTTP every client
that connects is a connection of its own onto the same world, bound to the
name it arrives as: it acts as nobody else, and reads what other visitors'
turns write to it on its next call. A connection may do nothing but arrive
until it has, and when it closes its visitor leaves, as a last `leave`
would, so the name is free to come back. Bound to loopback (the default,
`127.0.0.1`), the host answers only requests addressed to a loopback name,
so a web page cannot reach the world by rebinding a name of its own; bound
anywhere else, guarding it is the operator's.

Nothing that goes wrong on the host's side reaches an agent in any words
but one sentence of the host's; the host hears it in full on stderr. A file
`--record` cannot write refuses the session before anyone plays.

MIT. Imports `@overstory/sprout/lang`, `@overstory/sprout-player`, the MCP
SDK, `zod` and `node:*`.
