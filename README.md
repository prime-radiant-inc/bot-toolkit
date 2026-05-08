# @primeradianthq/bot-toolkit

Reusable TypeScript core for building unattended Claude-powered chat agents.

`@primeradianthq/bot-toolkit` provides shared bot infrastructure: session storage,
Claude session management, per-room workspaces, wakeups, logging, config/secrets
loading, responder base classes, adapter base classes, attention tracking, task
tracking, and native chat route primitives.

It does not bundle concrete Slack/Bolt or email transport adapters. Applications
own their platform adapters and compose them with `BaseAdapter`,
`BaseResponder`, and the toolkit's shared types.

## Install

```bash
npm install @primeradianthq/bot-toolkit
```

For local validation before npm publication:

```bash
TARBALL=$(npm pack --silent)
npm install "./$TARBALL"
```

## Requirements and Configuration

This package requires Node.js 20 or newer.

`loadConfig()` reads these optional environment variables:

- `DATABASE_PATH`: SQLite database path. Defaults to
  `./data/infrastructure/sessions.db`.
- `DATA_DIRECTORY`: persistent data root for room directories and related
  files. Defaults to the grandparent directory of `DATABASE_PATH`.
- `CONFIG_DIR`: directory containing `instance.json` and `secrets.json`.
  Defaults to `~/etc/sen`.
- `CLAUDE_PA_DIR`: application root passed through to Claude session setup.
- `TZ`: runtime timezone. Defaults to `America/Los_Angeles`.
- `USE_AGENT_SDK`: set to `false` to use CLI mode instead of Agent SDK mode.

## Public Surface

```ts
import {
  BaseAdapter,
  BaseResponder,
  ClaudeSessionManagerSDK,
  ConversationOrchestrator,
  Logger,
  MessageSessionStore,
  SessionDatabase,
  getRoomDirectory,
  type BaseAdapterConfig,
  type IncomingMessage,
  type MessageOrchestrator,
  type Platform,
  type PlatformResponder,
  type SessionCallbacks,
  type WakeupPayload,
} from '@primeradianthq/bot-toolkit';
```

## Platform Identifiers

The public `Platform` type is:

```ts
type Platform = 'slack' | 'native' | 'email';
```

These identifiers are used by core APIs for room paths, wakeups, task rows,
environment setup, and adapter interfaces. They are not claims that this package
exports a bundled `SlackAdapter` or `EmailAdapter`.

## Task Tools

`createTaskToolsServer()` exposes toolkit task inspection/cancellation tools to
Claude through `ClaudeSessionManagerSDK`:

```ts
import {
  ClaudeSessionManagerSDK,
  MessageSessionStore,
  SessionDatabase,
  TaskRegistry,
  createTaskToolsServer,
  loadConfig,
} from '@primeradianthq/bot-toolkit';

const config = loadConfig();
const database = new SessionDatabase(config.database.path);
const sessionStore = new MessageSessionStore(database.db);
const taskRegistry = new TaskRegistry(database.db);

const sessionManager = new ClaudeSessionManagerSDK(config, sessionStore, {
  taskManagement: createTaskToolsServer(taskRegistry),
});
```

## Adapter Boundary

Applications should implement concrete platform adapters in their own packages:

```ts
import {
  BaseAdapter,
  type BaseAdapterConfig,
  type WakeupPayload,
} from '@primeradianthq/bot-toolkit';

export interface ApplicationAdapterConfig extends BaseAdapterConfig {
  token: string;
}

export class ApplicationAdapter extends BaseAdapter {
  readonly platform = 'slack' as const;

  constructor(private readonly config: ApplicationAdapterConfig) {
    super(config);
  }

  async start(): Promise<void> {
    throw new Error('Start the application-owned platform client here');
  }

  async stop(): Promise<void> {}
  async stopListening(): Promise<void> {}
  async sendRecoveryNotice(): Promise<void> {}
  async handleWakeup(
    _channelId: string,
    _payload: WakeupPayload,
  ): Promise<void> {}

  protected async sendUnauthorizedResponse(): Promise<void> {}
}
```

## Security Model

The toolkit is a trusted local/headless runtime, not a sandbox.
`ClaudeSessionManagerSDK` runs Claude Code in unattended mode with:

```ts
permissionMode: 'bypassPermissions';
allowDangerouslySkipPermissions: true;
```

Use a dedicated user or container, least-privilege filesystem mounts, trusted
MCP/plugin configuration, trusted Claude settings, and an allowlisted SDK
environment. Do not run this package against untrusted repositories, untrusted
MCP servers, untrusted plugin paths, or broad host filesystem mounts.

The wakeup/native HTTP server defaults to loopback. If you bind it to a
non-loopback host, configure an `authToken`.

## Local Development

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`npm run check` runs the full quality gate.
