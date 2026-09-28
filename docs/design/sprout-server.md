# Sprout — the server and its protocol

2026-09-27

`sprout-server` is the reference host: a headless process that runs worlds
for clients to connect to. The design spec's _The host contract_ says what
any host owes a world; this document is the concrete choices this one
makes: its command, its config, its wire protocol, how it knows a person,
and how it reloads. Where the two disagree, the spec wins. The terminal
client (`sprout client connect`) is its first client.

## Commands

```sh
sprout server start --config server.toml [--watch] [--log-format text|json]
sprout client connect localhost:4700 [--world printers_shop] [--as Marta]
```

- `server start` runs until it is stopped. It loads every world the config
  names, publishing each strictly; a world that is refused is logged and
  not served, and the rest start.
- `client connect` opens one connection, which is one visitor. Several
  clients on one server are how several people share a world.
- `--world` chooses among the server's worlds; with one world it may be
  left out. `--as` is the nickname to ask for.
- There is no admin interface in the first cut. What the server does is
  automatic (ticks, wakes, catch-up), and what happened is in its log.

## Config

TOML, read with `smol-toml` and checked by a zod schema. The schema's
defaults are the spec's _Limits_, so the figures live in one place; a key
left out takes the spec's default. An error names the line and the key.

```toml
listen = "127.0.0.1:4700"
log_level = "info"            # error | warning | info | debug
tick_seconds = 5
wakes_while_empty = false

[store]
kind = "sqlite"               # memory | sqlite | postgres
path = "./sprout.db"          # sqlite; postgres takes url_env instead

[[worlds]]
path = "./worlds/printers_shop"

[limits]                      # any cap or budget in the spec's Limits
steps = 50000
output = 8000

[extensions]
media = { major = 1, module = "./ext/media.js" }

blessed_libraries = ["sha256:…"]
```

| key | what it sets | default |
| --- | --- | --- |
| `listen` | the address and port | `127.0.0.1:4700` |
| `log_level` | the lowest level the server logs | `info` |
| `tick_seconds` | how often each occupied place is ticked | 5 |
| `wakes_while_empty` | whether wakes run while nobody is in a world, which the spec leaves to the host | `false` |
| `[store]` | where state and the log are kept | `memory` |
| `[[worlds]]` | each world served, by folder | none; at least one is required |
| `[limits]` | each static cap and runtime budget | the spec's figure |
| `[extensions]` | each extension installed, by name, major and module | none |
| `blessed_libraries` | library hashes exempt from the source caps | the standard library's |

A secret is never written in the config. Where one is needed, as a
Postgres password, the key names an environment variable (`url_env`).
Installing an extension runs its module unsandboxed on the server, which
is the safety decision the spec says it is.

## Time

The real clock drives the host's side of time, and nothing a turn reads:

- Every `tick_seconds`, each occupied place is ticked in the host's order,
  through `core`'s ticker.
- A wake runs when it falls due while someone is in its world; while
  nobody is, it waits for the next arrival's catch-up, unless
  `wakes_while_empty` says otherwise.
- The host draws each write turn's seed at random and logs it beside the
  turn, so replay reproduces it.

## Who a visitor is

The spec keys a visit to "the host's own opaque id for the person". Here
that id is a token:

- On first contact with a server the client makes a random token and
  keeps it in `~/.config/sprout/tokens.json`, keyed by the server's
  address. It sends the token in `hello`.
- The server keeps only a hash of the token, as the person's id. A person
  who comes back with the same token finds their visit again, and their
  nickname while it is still free.
- There are no accounts. A token is as private as the file that holds it,
  which is enough for a local or trusted server and nothing more.

## Reloading

With `--watch`, the server watches each world's folder. On a change it
compiles the world strictly, as publishing does:

- If it compiles, it is published: the running world moves to the new
  bundle, the publish is logged with the bundle's hash, and visitors carry
  on.
- If it is refused, the refusal is logged and the running world is left as
  it was.

Without `--watch`, a world changes only when the server restarts.

## The protocol

One WebSocket per client, subprotocol `sprout.1`, `ws://` locally and
`wss://` otherwise. Each frame is one JSON object with a type, `t`. Every
message is validated with a zod schema in `core`, beside
`ClientDeclaration`. A frame that does not validate is answered with
`refused`, never dropped silently.

### Client to server

| message | fields | meaning |
| --- | --- | --- |
| `hello` | `protocol`, `client`, `token`, `renders` | open the connection: the protocol version, the client's name, the person's token, and the extension statements it renders, as `ClientDeclaration` |
| `admit` | `world`, `nickname` | come into a world under a nickname |
| `command` | `seq`, `line` | one typed line, a command turn |
| `poll` | `seq` | ask for the visitor's view |
| `chat` | `line` | say something to the others, beside the world |
| `levels` | `show` | the levels this client wants records at, from prose, error, warning, info and debug |
| `leave` | — | leave the world, a departure turn |
| `ping` | — | keep the connection alive |

### Server to client

| message | fields | meaning |
| --- | --- | --- |
| `welcome` | `server`, `worlds`, `granted`, `declined` | the server's name, the worlds it serves, and which declared statements it will send payloads of |
| `admitted` | `world`, `nickname`, `returning` | in, and whether this is a visit found again |
| `refused` | `stage`, `text` | a hello, an admission or a frame refused; it always carries text a person can read |
| `effects` | `seq`, `effects` | what a turn gave this visitor, as `core`'s `deliver` makes it: each a kind and its words, or its payload where the client renders it |
| `view` | `view` | the visitor's view, as `core`'s `sendView` makes it |
| `status` | `place`, `exits` | the status line: where the visitor stands and the ways out, sent when either changes |
| `offered` | `lines` | the lines the visitor could type now, for completion, from the view's readings |
| `record` | `level`, `text`, `at` | a log record at a level the client asked for; `at` is the host's time and never reaches a turn |
| `chat` | `from`, `line` | someone said something |
| `bye` | `reason`, `text` | the connection is closing: the visitor left, the world was taken down, or the server is stopping |

`seq` pairs a turn's `effects` with the `command` or `poll` that caused
it; effects of turns the visitor did not cause (a tick, someone else's
command) carry none. A client that asks for no levels is sent prose and
errors, as a person playing is under the spec's _Levels_.

### Reconnecting

The server pings each connection and drops one that stops answering; the
visitor then leaves, as the spec's departure turn says. A client that
reconnects with the same token is admitted again as a returning visitor,
to where they last stood.

## `sprout play`

`sprout play` stays an in-process host for one person at a terminal, for
scripts and tests. It shares `core`'s machinery with the server and has no
network, no clock and no config: time moves only when a script says so.

## Not in the first cut

- An admin interface (`status`, force a tick, withhold a file).
- A telnet/GMCP gateway and an SSH front door. The protocol is plain JSON
  messages, so either can be added in front of it without changing it.
- Hints (`/hint`) and the tree of what is possible here, which come after
  the parser.
- An optional model fallback for lines the grammar cannot read; its
  provider blocks will go in this config when it is built.
