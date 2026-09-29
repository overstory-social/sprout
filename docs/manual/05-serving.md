# Serving a world

`sprout play` runs a world for one person at one terminal. To share a world
with other people, run it on a **server** and have each person connect with
the **terminal client**. Each connection is one visitor, and several
connections to one server are how several people share a world.

## Starting a server

A server reads a config file in TOML. The smallest one names a world's
folder:

```toml
listen = "127.0.0.1:4700"

[[worlds]]
path = "./shed"
```

```sh
sprout server start --config server.toml
```

(`sprout-server start --config server.toml` does the same. `sprout server`
needs `@overstory/sprout-server` installed.)

The server compiles each world strictly, as `sprout check` does. A world
that is refused is logged and not served, and the rest start. The server
writes its log to the terminal, one line to a record. Add
`--log-format json` for JSON. Stop it with Ctrl-C: everyone connected is
told the server is stopping.

Everything else in the config is optional:

| key | what it sets | if you leave it out |
| --- | --- | --- |
| `listen` | the address and port | `127.0.0.1:4700` |
| `log_level` | the lowest level the server logs: `error`, `warning`, `info` or `debug` | `info` |
| `tick_seconds` | how often each place with someone in it is ticked | 5 |
| `wakes_while_empty` | whether wakes run while nobody is in a world | `false` |
| `[limits]` | any cap or budget from the reference's Limits, by its name: `steps = 20000` | the figures in the reference |

A problem with the config is named by its line and key, and the server does
not start.

### Changing a world while it runs

With `--watch`, the server watches each world's folder. When you save a
change, it compiles the world again. If the world compiles, it starts
again from the beginning: everyone connected comes back in where visitors
arrive, carrying nothing. If it does not compile, the server logs why and
the running world carries on as it was.

Without `--watch`, a world changes only when the server restarts. A
restart on the same files carries on where the world left off; a restart
on changed files starts it from the beginning.

## Connecting

```sh
sprout client connect 127.0.0.1:4700 --as Marta
```

(`sprout client` needs `@overstory/sprout-tui` installed.)

Leave out `--as` and the client asks for your nickname. If the server
serves several worlds, choose one with `--world printers_shop`. The first
time you connect to a server, the client makes you a token and keeps it in
`~/.config/sprout/tokens.json`. The same token brings you back as the same
visitor, under your nickname while it is still free.

The client fills the terminal window, top to bottom:

- **The header** shows the connection, then the world and your nickname.
  The dot is green while connected, orange for a minute after an error
  reaches the client, and red once the connection is lost.
- **The transcript** is what the world says, the newest line at the
  bottom, in a style for each kind of line. What other visitors say to you
  is set apart in its own colour. PgUp and PgDn scroll it, and Home and End
  go to its start and to the newest line. While you are scrolled back, new
  lines do not move what you are reading, and the rule under the
  transcript says how much is below.
- **The input line**, between two rules, is where you type.
- **The place** is at the foot: where you are on the left, and beside it
  what else is here and the ways out.

When you quit, the terminal is as it was before you connected.

Type as you would in `sprout play`. Up and down bring back lines you typed
before, and Tab completes from what you could type here now.

A line starting with `/` is for the client itself. A list pops up as you
type the `/`:

| command | what it does |
| --- | --- |
| `/say hello` | say something to everyone standing with you |
| `/log info` | show or hide the server's records at a level: `warning`, `info`, `debug` |
| `/reconnect` | connect again, as the visitor you were |
| `/help` | list these commands |
| `/quit` | leave the world and close the client |

Normal play shows the world's words and errors; `/log` shows more, such as
each step an intent takes (`info`) or a line that was drawn from a tie
(`warning`).

### Plain mode

`--plain`, or a pipe, gives plain lines in and out, with no screen: each
line the world says, once, and the status in brackets when it changes. Use
it with a screen reader, or to script a session:

```sh
printf 'look\ntake key\n' | sprout client connect 127.0.0.1:4700 --as Marta --plain
```
