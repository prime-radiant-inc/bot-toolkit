# bot-toolkit

> Reusable TypeScript core for building unattended Claude-powered chat agents: session storage, per-room workspaces, responder/adapter base classes, and shared bot infrastructure.

**Family:** bots · **Type:** library · **Lifecycle:** production · **Owner:** arittr

## What it does
`@primeradianthq/bot-toolkit` provides shared bot infrastructure for building unattended Claude-powered chat agents: session storage, Claude session management (Agent SDK), per-room workspaces, wakeups, logging, config/secrets loading, responder and adapter base classes, attention tracking, task tracking, and native chat route primitives. It deliberately does not bundle concrete Slack/Bolt or email adapters; applications own their platform adapters and compose them with `BaseAdapter`, `BaseResponder`, and the toolkit's shared types.

## How it fits
- Depends on: — (no internal prime-radiant-inc package dependencies)
- Used by: [scribble](https://github.com/prime-radiant-inc/scribble) (package.json dependency `@primeradianthq/bot-toolkit`).
- External: Anthropic Claude Agent SDK, AWS SSM (secrets), better-sqlite3, Express/ws.

## Runtime & data
- Runs: npm library imported by bot services; not deployed on its own.
- Data in: consumer-provided messages, config, and secrets.
- Data out: SQLite session/state persistence; library APIs to consumers.

<!-- Maintained by the maintaining-project-map skill. Do not hand-edit; regenerated. -->
