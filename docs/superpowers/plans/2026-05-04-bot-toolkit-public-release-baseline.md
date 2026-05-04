# Bot Toolkit Public Release Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a fresh-history `@primeradiant/bot-toolkit` repository that is publish-ready, locally packable, and consumable by Scribble with scoped imports while preserving the original core-only adapter boundary.

**Architecture:** Seed `/Users/drewritter/prime-rad/sen/bot-toolkit` from the archived implementation, then make focused public-release changes on top: package metadata and tarball shape, strict quality gates, core API typing, Agent SDK hardening, path/route hardening, docs, CI, and tarball-based consumer verification. Concrete Slack/Bolt and email transport adapters stay in consuming applications; bot-toolkit ships core primitives and verified native modules only.

**Tech Stack:** TypeScript ESM, Node 20, npm, Vitest, Biome, Express, ws, better-sqlite3, `@anthropic-ai/claude-agent-sdk`, AWS SSM secrets support.

---

## Source Documents

- Design spec: `/Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/specs/2026-05-04-bot-toolkit-public-release-design.md`
- Linear ticket: `PRI-1487`
- Canceled boundary ticket: `PRI-1491`
- Archive source: `/Users/drewritter/prime-rad/sen/bot-toolkit-archive`
- Fresh implementation repo: `/Users/drewritter/prime-rad/sen/bot-toolkit`

## File Structure

Create or modify these files in `/Users/drewritter/prime-rad/sen/bot-toolkit`:

- `package.json`: public metadata, scripts, dependency placement, `files`, and `publishConfig`.
- `package-lock.json`: regenerated from `package.json` with `npm install --package-lock-only`.
- `tsconfig.json`: declaration-only output settings without source/declaration maps.
- `biome.json`: strict formatter/linter configuration.
- `.gitignore`: ignore `dist/`, `coverage/`, local tarballs, and temp consumer smoke directories.
- `scripts/check-console.mjs`: fail CI when production code uses `console.*` outside the logger.
- `.github/workflows/ci.yml`: public CI quality gate only.
- `.github/workflows/trigger-build.yml`: removed from the public baseline.
- `src/core/types.ts`: remove Matrix from `Platform`, add `MessageOrchestrator`, and add `platform` to `PlatformAdapter`.
- `src/core/baseAdapter.ts`: depend on `MessageOrchestrator` instead of concrete `ConversationOrchestrator`.
- `src/core/index.ts`: export `MessageOrchestrator` and keep the Scribble compatibility surface.
- `src/core/sessionManagerSDK.ts`: add SDK env allowlist and use it in query options.
- `src/core/__tests__/buildMcpServers.test.ts`: cover SDK env allowlisting with typed fixtures.
- `src/core/__tests__/baseAdapter.test.ts`: cover structural orchestrator typing and platform identity.
- `src/utils/roomPath.ts`: reject empty sanitized room IDs and keep only `slack`, `native`, `email` room docs.
- `src/utils/__tests__/roomPath.test.ts`: cover empty-sanitized ID rejection and non-Matrix platforms.
- `src/native/sessionManager.ts`: validate native session IDs and confine filesystem reads/writes.
- `src/native/__tests__/sessionManager.test.ts`: cover traversal, symlink, and malformed session IDs.
- `src/native/routes.ts`: validate native room slug/name before creating rooms.
- `src/native/__tests__/routes.test.ts`: cover native route validation.
- `src/native/types.ts`: align WebSocket server/client unions with emitted route behavior.
- `src/wakeup/server.ts`: protect control routes, default bind host, keep platform parsing to `slack`, `native`, `email`.
- `src/wakeup/__tests__/server.test.ts`: cover route auth, invalid payload ordering, and no Matrix platform.
- `src/core/conversationLogger.ts`: sanitize thread filenames used for conversation logs.
- `src/core/__tests__/conversationLogger.test.ts`: cover thread filename traversal prevention.
- `README.md`: public-consumer README with core-only adapter boundary and security model.
- `docs/claude-agent-sdk.md`: keep as internal documentation outside the packed tarball and update it only if README links to it.
- `docs/superpowers/handoffs/2026-05-04-pri-1488-scribble-bot-toolkit.md`: handoff note for Scribble.

---

### Task 1: Seed Fresh-History Repo

**Files:**
- Create: `/Users/drewritter/prime-rad/sen/bot-toolkit/.git`
- Copy from archive: `/Users/drewritter/prime-rad/sen/bot-toolkit-archive/*`
- Preserve: `/Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/specs/2026-05-04-bot-toolkit-public-release-design.md`
- Preserve: `/Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/plans/2026-05-04-bot-toolkit-public-release-baseline.md`

- [ ] **Step 1: Verify source and target state**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit-archive
git status --short
git rev-parse --show-toplevel
cd /Users/drewritter/prime-rad/sen/bot-toolkit
find . -maxdepth 3 -type f | sort
test ! -d .git
```

Expected:

```text
/Users/drewritter/prime-rad/sen/bot-toolkit-archive
```

The archive may show no changes. The target must have no `.git` directory. The target should contain the design and plan docs only.

- [ ] **Step 2: Copy archive contents without archive history or generated files**

Run:

```bash
rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='*.tgz' \
  /Users/drewritter/prime-rad/sen/bot-toolkit-archive/ \
  /Users/drewritter/prime-rad/sen/bot-toolkit/
```

Expected:

```text
```

`rsync` should print no output on success.

- [ ] **Step 3: Restore superpowers docs that already lived in the fresh repo**

Run:

```bash
mkdir -p /Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/specs
mkdir -p /Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/plans
test -f /Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/specs/2026-05-04-bot-toolkit-public-release-design.md
test -f /Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/plans/2026-05-04-bot-toolkit-public-release-baseline.md
```

Expected:

```text
```

The commands should succeed with no output.

- [ ] **Step 4: Remove private workflow from the fresh baseline**

Run:

```bash
rm -f /Users/drewritter/prime-rad/sen/bot-toolkit/.github/workflows/trigger-build.yml
```

Expected:

```text
```

- [ ] **Step 5: Initialize fresh git history**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git init -b main
git status --short
```

Expected: `git status --short` lists the copied files as untracked.

- [ ] **Step 6: Commit the archived implementation baseline**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add .gitignore .github LICENSE README.md docs package-lock.json package.json src tsconfig.json
git commit -m "chore: seed public bot-toolkit baseline"
git status --short
```

Expected:

```text
```

`git status --short` should be empty after the commit.

---

### Task 2: Package Metadata And Build Surface

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/package.json`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/package-lock.json`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/tsconfig.json`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/.gitignore`

- [ ] **Step 1: Replace `package.json` with public-ready metadata and scripts**

Set `/Users/drewritter/prime-rad/sen/bot-toolkit/package.json` to:

```json
{
  "name": "@primeradiant/bot-toolkit",
  "version": "0.1.0",
  "description": "Reusable TypeScript core for building unattended Claude-powered chat agents.",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE",
    "package.json"
  ],
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "biome lint . && node scripts/check-console.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "build": "tsc",
    "prepack": "npm run build",
    "pack:dry-run": "npm pack --dry-run",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run pack:dry-run"
  },
  "keywords": [
    "claude",
    "chatbot",
    "bot",
    "agent",
    "typescript",
    "native"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prime-radiant-inc/bot-toolkit.git"
  },
  "bugs": {
    "url": "https://github.com/prime-radiant-inc/bot-toolkit/issues"
  },
  "homepage": "https://github.com/prime-radiant-inc/bot-toolkit#readme",
  "engines": {
    "node": ">=20"
  },
  "publishConfig": {
    "access": "public"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.0",
    "@aws-sdk/client-ssm": "^3.971.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^5.0.0",
    "@types/ws": "^8.18.1",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.0",
    "express": "^5.0.0",
    "express-ws": "^5.0.2",
    "gray-matter": "^4.0.3",
    "ws": "^8.19.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.2.0",
    "@types/express-ws": "^3.0.6",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Remove declaration/source maps from `tsconfig.json`**

Set `/Users/drewritter/prime-rad/sen/bot-toolkit/tsconfig.json` to:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "declarationMap": false,
    "sourceMap": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

- [ ] **Step 3: Update `.gitignore` for generated outputs and smoke artifacts**

Ensure `/Users/drewritter/prime-rad/sen/bot-toolkit/.gitignore` contains:

```gitignore
node_modules/
dist/
coverage/
*.tgz
.tmp/
.DS_Store
```

- [ ] **Step 4: Regenerate lockfile without installing runtime artifacts**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm install --package-lock-only
npm ci
npm run build
npm pack --dry-run
```

Expected:

```text
> @primeradiant/bot-toolkit@0.1.0 build
> tsc
```

The `npm pack --dry-run` output should list `dist/index.js`, `dist/index.d.ts`, `README.md`, `LICENSE`, and `package.json`. It should not list `src/`, tests, local plans, or `.github/workflows/trigger-build.yml`.

- [ ] **Step 5: Commit package surface changes**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git status --short
git add .gitignore package.json package-lock.json tsconfig.json
git commit -m "chore: configure public package surface"
```

Expected: commit succeeds.

---

### Task 3: Strict Biome And Local Static Checks

**Files:**
- Create: `/Users/drewritter/prime-rad/sen/bot-toolkit/biome.json`
- Create: `/Users/drewritter/prime-rad/sen/bot-toolkit/scripts/check-console.mjs`
- Modify: source and tests flagged by Biome

- [ ] **Step 1: Add strict Biome configuration**

Create `/Users/drewritter/prime-rad/sen/bot-toolkit/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.2.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "includes": [
      "**",
      "!dist",
      "!node_modules",
      "!coverage",
      "!*.tgz",
      "!.tmp"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "style": {
        "useImportType": "error"
      }
    }
  }
}
```

- [ ] **Step 2: Add console usage guard**

Create `/Users/drewritter/prime-rad/sen/bot-toolkit/scripts/check-console.mjs`:

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const allowed = new Set(['src/utils/logger.ts']);
const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'coverage', '.tmp']);
const consolePattern = /\bconsole\.(log|info|warn|error|debug|trace)\b/;
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) {
      continue;
    }

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.js')) {
      continue;
    }

    const rel = relative(root, fullPath);
    if (allowed.has(rel)) {
      continue;
    }

    const lines = readFileSync(fullPath, 'utf-8').split('\n');
    lines.forEach((line, index) => {
      if (consolePattern.test(line)) {
        failures.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

walk(join(root, 'src'));

if (failures.length > 0) {
  console.error('Unexpected console usage outside src/utils/logger.ts:');
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}
```

- [ ] **Step 3: Run formatter and linter**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm run format
npm run lint
```

Expected:

```text
> @primeradiant/bot-toolkit@0.1.0 lint
> biome lint . && node scripts/check-console.mjs
```

If Biome flags explicit `any`, add small local test-only interfaces instead of weakening `noExplicitAny`.

- [ ] **Step 4: Commit quality gate configuration**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git status --short
git add biome.json scripts/check-console.mjs package.json package-lock.json src
git commit -m "chore: add strict quality gates"
```

Expected: commit succeeds.

---

### Task 4: Public Platform And Orchestrator API

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/types.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/baseAdapter.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/index.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/__tests__/baseAdapter.test.ts`

- [ ] **Step 1: Update core public types**

In `src/core/types.ts`, replace the platform and adapter section with:

```ts
export type Platform = 'slack' | 'native' | 'email';

export type SenderRole = 'primary' | 'delegate';

export interface IncomingMessage {
  platform: Platform;
  channelId: string;
  channelName: string;
  threadId: string | null;
  messageId: string;
  senderId: string;
  senderName?: string;
  senderRole?: SenderRole;
  text: string;
  attachments: Attachment[];
}
```

Add `MessageOrchestrator` after `PlatformResponder`:

```ts
export interface MessageOrchestrator {
  handleMessage(
    message: IncomingMessage,
    responder: PlatformResponder,
  ): Promise<void>;
}
```

Update `PlatformAdapter` to include platform identity:

```ts
export interface PlatformAdapter {
  readonly platform: Platform;

  start(): Promise<void>;
  stop(): Promise<void>;
  handleWakeup(channelId: string, payload: WakeupPayload): Promise<void>;

  /** Stop accepting new messages but keep platform client connected. */
  stopListening(): Promise<void>;

  /** Send a recovery notice to a channel/thread for crash recovery. */
  sendRecoveryNotice(
    channelId: string,
    threadId: string | null,
    text: string,
  ): Promise<void>;
}
```

- [ ] **Step 2: Update BaseAdapter to accept structural orchestrators**

In `src/core/baseAdapter.ts`, remove:

```ts
import type { ConversationOrchestrator } from './orchestrator.js';
```

Add `MessageOrchestrator` to the type imports and update config/properties:

```ts
import type {
  Attachment,
  IncomingMessage,
  MessageOrchestrator,
  Platform,
  PlatformAdapter,
  SenderRole,
  WakeupPayload,
} from './types.js';

export interface BaseAdapterConfig {
  orchestrator: MessageOrchestrator;
  authorizedUsers: string[];
  dataDir: string;
}

export abstract class BaseAdapter implements PlatformAdapter {
  protected orchestrator: MessageOrchestrator;
  protected authorizedUsers: string[];
  protected dataDir: string;
```

- [ ] **Step 3: Export `MessageOrchestrator`**

In `src/core/index.ts`, add `MessageOrchestrator` to the type export block:

```ts
export type {
  Attachment,
  CompactionInfo,
  IncomingMessage,
  ISessionManager,
  MessageOrchestrator,
  Platform,
  PlatformAdapter,
  PlatformResponder,
  SenderRole,
  SessionCallbacks,
  SessionResult,
  SessionStats,
  ThreadSession,
  WakeupPayload,
} from './types.js';
```

- [ ] **Step 4: Add BaseAdapter typing test**

Append this test to `src/core/__tests__/baseAdapter.test.ts`:

```ts
it('accepts structural message orchestrators', async () => {
  const handled: IncomingMessage[] = [];
  const orchestrator: MessageOrchestrator = {
    async handleMessage(message) {
      handled.push(message);
    },
  };

  class TestAdapter extends BaseAdapter {
    readonly platform = 'slack' as const;

    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async stopListening(): Promise<void> {}
    async sendRecoveryNotice(): Promise<void> {}
    async handleWakeup(): Promise<void> {}

    protected async sendUnauthorizedResponse(): Promise<void> {}

    async emit(): Promise<void> {
      const message = this.buildIncomingMessage({
        channelId: 'C123',
        channelName: 'general',
        threadId: null,
        messageId: 'm1',
        senderId: 'U123',
        text: 'hello',
      });
      await this.orchestrator.handleMessage(message, testResponder);
    }
  }

  const testResponder: PlatformResponder = {
    cancelled: false,
    async markProcessing() {},
    async clearProcessing() {},
    async markError() {},
    async updateResponse() {},
    async finalizeResponse() {},
    async sendNotice() {},
    async sendFile() {},
    async setTyping() {},
    async updateChannelStats() {},
    async createThreadStarter() {
      return 'thread-1';
    },
    async appendCancellationNotice() {},
  };

  const adapter = new TestAdapter({
    orchestrator,
    authorizedUsers: ['U123'],
    dataDir: '/tmp/bot-toolkit-base-adapter-test',
  });

  await adapter.emit();

  expect(handled).toHaveLength(1);
  expect(handled[0]?.platform).toBe('slack');
});
```

Ensure the file imports these types:

```ts
import type {
  IncomingMessage,
  MessageOrchestrator,
  PlatformResponder,
} from '../types.js';
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm test -- --run src/core/__tests__/baseAdapter.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit public API boundary**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add src/core/types.ts src/core/baseAdapter.ts src/core/index.ts src/core/__tests__/baseAdapter.test.ts
git commit -m "feat: stabilize public adapter interfaces"
```

Expected: commit succeeds.

---

### Task 5: Claude SDK Environment Hardening

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/sessionManagerSDK.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/__tests__/buildMcpServers.test.ts`

- [ ] **Step 1: Add SDK env allowlist helper**

In `src/core/sessionManagerSDK.ts`, after `const logger = new Logger('ClaudeSessionManagerSDK');`, add:

```ts
const SDK_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

export function buildSdkEnv(
  sourceEnv: NodeJS.ProcessEnv,
  platformEnv: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of SDK_ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...platformEnv,
    DEBUG_CLAUDE_AGENT_SDK: 'true',
  };
}
```

- [ ] **Step 2: Use allowlist in SDK query options**

In `src/core/sessionManagerSDK.ts`, replace:

```ts
env: {
  ...process.env,
  ...platformEnv,
  // Enable stderr capture for debugging process crashes
  DEBUG_CLAUDE_AGENT_SDK: 'true',
},
```

with:

```ts
env: buildSdkEnv(process.env, platformEnv),
```

- [ ] **Step 3: Add typed env tests**

In `src/core/__tests__/buildMcpServers.test.ts`, import `buildSdkEnv`:

```ts
import { buildMcpServers, buildSdkEnv } from '../sessionManagerSDK.js';
```

Append:

```ts
describe('buildSdkEnv', () => {
  it('includes platform env and debug flag while excluding broad host secrets', () => {
    const env = buildSdkEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/bot',
        AWS_SECRET_ACCESS_KEY: 'do-not-pass',
        GITHUB_TOKEN: 'do-not-pass',
        LINEAR_API_KEY: 'do-not-pass',
        ANTHROPIC_API_KEY: 'anthropic-key',
      },
      { ROOM_ID: 'native:abc', PLATFORM: 'native' },
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/bot',
      ANTHROPIC_API_KEY: 'anthropic-key',
      ROOM_ID: 'native:abc',
      PLATFORM: 'native',
      DEBUG_CLAUDE_AGENT_SDK: 'true',
    });
  });

  it('omits undefined allowlisted variables', () => {
    const env = buildSdkEnv({}, { ROOM_ID: 'email:inbox', PLATFORM: 'email' });

    expect(env).toEqual({
      ROOM_ID: 'email:inbox',
      PLATFORM: 'email',
      DEBUG_CLAUDE_AGENT_SDK: 'true',
    });
  });
});
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm test -- --run src/core/__tests__/buildMcpServers.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit SDK hardening**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add src/core/sessionManagerSDK.ts src/core/__tests__/buildMcpServers.test.ts
git commit -m "fix: allowlist Claude SDK environment"
```

Expected: commit succeeds.

---

### Task 6: Platform And Path Hardening

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/utils/roomPath.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/utils/__tests__/roomPath.test.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/conversationLogger.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/__tests__/conversationLogger.test.ts`

- [ ] **Step 1: Reject empty sanitized room IDs**

In `src/utils/roomPath.ts`, add this helper after `sanitizeRoomId`:

```ts
function sanitizeRoomIdOrThrow(roomId: string): string {
  const sanitized = sanitizeRoomId(roomId);
  if (sanitized.length === 0) {
    throw new Error('Room ID must contain at least one filesystem-safe character');
  }
  return sanitized;
}
```

In `getRoomDirectory`, replace:

```ts
const sanitized = sanitizeRoomId(roomId);
```

with:

```ts
const sanitized = sanitizeRoomIdOrThrow(roomId);
```

- [ ] **Step 2: Remove Matrix switch branches from room docs**

In `src/utils/roomPath.ts`, ensure platform switches contain only:

```ts
switch (platform) {
  case 'slack':
    platformLabel = 'Slack';
    idExample =
      'Slack channel IDs like `C0123456789` are lowercased to `c0123456789`';
    platformDescription = 'Slack chat sessions';
    break;
  case 'native':
    platformLabel = 'Native';
    idExample = 'Native session IDs like `native-session-123` are used as-is';
    platformDescription = 'Native chat API sessions';
    break;
  case 'email':
    platformLabel = 'Email';
    idExample =
      'Email thread IDs are SHA-256 hashes of the Message-ID header, truncated to 16 chars';
    platformDescription = 'Email conversation sessions';
    break;
}
```

- [ ] **Step 3: Add room path tests**

Append to `src/utils/__tests__/roomPath.test.ts`:

```ts
it('throws when room ID sanitizes to empty', () => {
  expect(() =>
    getRoomDirectory(testBaseDir, '!!!', 'native', 'Invalid Room'),
  ).toThrow('Room ID must contain at least one filesystem-safe character');
});
```

Ensure tests only refer to `slack`, `native`, and `email`.

- [ ] **Step 4: Sanitize conversation log filenames**

In `src/core/conversationLogger.ts`, add:

```ts
function sanitizeLogFileBase(value: string): string {
  const sanitized = sanitizeRoomId(value);
  if (sanitized.length === 0) {
    return 'main';
  }
  return sanitized;
}
```

Replace both occurrences of:

```ts
const fileBase = entry.threadId ?? 'main';
```

with:

```ts
const fileBase = entry.threadId
  ? sanitizeLogFileBase(entry.threadId)
  : 'main';
```

- [ ] **Step 5: Add conversation logger path traversal test**

Append to `src/core/__tests__/conversationLogger.test.ts`:

```ts
it('sanitizes thread IDs before using them as log filenames', async () => {
  const logger = new ConversationLogger(testDataDir);

  await logger.logIncoming({
    platform: 'slack',
    channelId: 'C123',
    channelName: 'general',
    threadId: '../outside',
    messageId: 'm1',
    senderId: 'U123',
    senderName: 'Drew',
    text: 'hello',
    rawEvent: {},
  });

  const expected = path.join(
    testDataDir,
    'rooms',
    'slack',
    'c123',
    'chat-history',
  );
  const dateDirs = fs.readdirSync(expected);
  expect(dateDirs).toHaveLength(1);
  const files = fs.readdirSync(path.join(expected, dateDirs[0] ?? ''));
  expect(files).toContain('outside.md');
  expect(files).toContain('outside.jsonl');
  expect(fs.existsSync(path.join(testDataDir, 'rooms', 'slack', 'outside.md'))).toBe(false);
});
```

Ensure the test file imports `fs` and `path`.

- [ ] **Step 6: Run path-focused tests**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm test -- --run src/utils/__tests__/roomPath.test.ts src/core/__tests__/conversationLogger.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit path hardening**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add src/utils/roomPath.ts src/utils/__tests__/roomPath.test.ts src/core/conversationLogger.ts src/core/__tests__/conversationLogger.test.ts
git commit -m "fix: harden room and log paths"
```

Expected: commit succeeds.

---

### Task 7: Native And Wakeup Route Hardening

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/native/sessionManager.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/native/routes.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/native/types.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/native/__tests__/sessionManager.test.ts`
- Create: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/native/__tests__/routes.test.ts`
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/wakeup/server.ts`
- Create: `/Users/drewritter/prime-rad/sen/bot-toolkit/src/wakeup/__tests__/server.test.ts`

- [ ] **Step 1: Port native session path hardening from the hardening branch**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git --git-dir=/Users/drewritter/prime-rad/sen/bot-toolkit-archive/.git show origin/release/public-release-hardening:src/native/sessionManager.ts > src/native/sessionManager.ts
git --git-dir=/Users/drewritter/prime-rad/sen/bot-toolkit-archive/.git show origin/release/public-release-hardening:src/native/__tests__/sessionManager.test.ts > src/native/__tests__/sessionManager.test.ts
```

Expected: both files are replaced with the hardening branch versions.

- [ ] **Step 2: Port route auth tests from the hardening branch**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
mkdir -p src/wakeup/__tests__ src/native/__tests__
git --git-dir=/Users/drewritter/prime-rad/sen/bot-toolkit-archive/.git show origin/release/public-release-hardening:src/wakeup/server.ts > src/wakeup/server.ts
git --git-dir=/Users/drewritter/prime-rad/sen/bot-toolkit-archive/.git show origin/release/public-release-hardening:src/wakeup/__tests__/server.test.ts > src/wakeup/__tests__/server.test.ts
git --git-dir=/Users/drewritter/prime-rad/sen/bot-toolkit-archive/.git show origin/release/public-release-hardening:src/native/__tests__/routes.test.ts > src/native/__tests__/routes.test.ts
```

Expected: files are written with the hardening branch route/auth behavior.

- [ ] **Step 3: Fail closed for non-loopback hosts without auth**

In `src/wakeup/server.ts`, update `WakeupServerConfig`:

```ts
export interface WakeupServerConfig {
  adapters: Map<string, PlatformAdapter>;
  contextStore?: ContextStore;
  database?: SessionDatabase;
  additionalRoutes?: Router;
  nativeSessionManager?: NativeSessionManager;
  orchestrator?: MessageOrchestrator;
  authToken?: string;
  host?: string;
}
```

Add:

```ts
function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function requireAuthForHost(host: string, authToken: string | undefined): void {
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error('authToken is required when wakeup server host is not loopback');
  }
}
```

In `createWakeupServer`, read host and enforce auth:

```ts
const host = config.host ?? '127.0.0.1';
requireAuthForHost(host, config.authToken);
```

In `startWakeupServer`, default to loopback:

```ts
export async function startWakeupServer(
  config: WakeupServerConfig & { port: number },
): Promise<void> {
  const app = createWakeupServer(config);
  const host = config.host ?? '127.0.0.1';
  app.listen(config.port, host, () => {
    logger.info('Wakeup server listening', { port: config.port, host });
  });
}
```

- [ ] **Step 4: Validate native room payloads**

In `src/native/routes.ts`, replace room creation body parsing with:

```ts
const { slug, name } = req.body as { slug?: unknown; name?: unknown };
if (typeof slug !== 'string' || typeof name !== 'string') {
  res.status(400).json({ error: 'slug and name are required' });
  return;
}
if (slug.trim().length === 0 || name.trim().length === 0) {
  res.status(400).json({ error: 'slug and name cannot be empty' });
  return;
}
```

- [ ] **Step 5: Add route validation tests**

Append to `src/native/__tests__/routes.test.ts`:

```ts
it('rejects empty native room slugs', async () => {
  const sessionManager = new NativeSessionManager(testDataDir);
  const app = express();
  app.use(express.json());
  app.use('/native', createNativeRoutes(sessionManager));
  const server = await listen(app);

  try {
    const response = await fetch(`${baseUrl(server)}/native/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: '   ', name: 'Room' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'slug and name cannot be empty',
    });
  } finally {
    await close(server);
  }
});
```

- [ ] **Step 6: Add wakeup host auth test**

Append to `src/wakeup/__tests__/server.test.ts`:

```ts
it('requires auth token for non-loopback hosts', () => {
  expect(() =>
    createWakeupServer({
      adapters: new Map([['native', makeAdapter()]]),
      host: '0.0.0.0',
    }),
  ).toThrow('authToken is required when wakeup server host is not loopback');
});
```

- [ ] **Step 7: Run route hardening tests**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm test -- --run src/native/__tests__/sessionManager.test.ts src/native/__tests__/routes.test.ts src/wakeup/__tests__/server.test.ts
npm run typecheck
```

Expected: all commands pass.

- [ ] **Step 8: Commit route hardening**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add src/native src/wakeup
git commit -m "fix: protect native and wakeup routes"
```

Expected: commit succeeds.

---

### Task 8: README And Scribble Handoff

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/README.md`
- Create: `/Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/handoffs/2026-05-04-pri-1488-scribble-bot-toolkit.md`

- [ ] **Step 1: Replace README with public-consumer documentation**

Set `/Users/drewritter/prime-rad/sen/bot-toolkit/README.md` to:

```md
# @primeradiant/bot-toolkit

Reusable TypeScript core for building unattended Claude-powered chat agents.

`@primeradiant/bot-toolkit` provides shared bot infrastructure: session storage, Claude session management, per-room workspaces, wakeups, logging, config/secrets loading, responder base classes, adapter base classes, attention tracking, task tracking, and native chat route primitives.

It does not bundle concrete Slack/Bolt or email transport adapters. Applications own their platform adapters and compose them with `BaseAdapter`, `BaseResponder`, and the toolkit's shared types.

## Install

```bash
npm install @primeradiant/bot-toolkit
```

For local validation before npm publication:

```bash
npm pack
npm install ./primeradiant-bot-toolkit-0.1.0.tgz
```

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
} from '@primeradiant/bot-toolkit';
```

## Platform Identifiers

The public `Platform` type is:

```ts
type Platform = 'slack' | 'native' | 'email';
```

These identifiers are used by core APIs for room paths, wakeups, task rows, environment setup, and adapter interfaces. They are not claims that this package exports a bundled `SlackAdapter` or `EmailAdapter`.

## Adapter Boundary

Applications should implement concrete platform adapters in their own packages:

```ts
import {
  BaseAdapter,
  type BaseAdapterConfig,
  type WakeupPayload,
} from '@primeradiant/bot-toolkit';

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
  async handleWakeup(_channelId: string, _payload: WakeupPayload): Promise<void> {}

  protected async sendUnauthorizedResponse(): Promise<void> {}
}
```

## Security Model

The toolkit is a trusted local/headless runtime, not a sandbox. `ClaudeSessionManagerSDK` runs Claude Code in unattended mode with:

```ts
permissionMode: 'bypassPermissions'
allowDangerouslySkipPermissions: true
```

Use a dedicated user or container, least-privilege filesystem mounts, trusted MCP/plugin configuration, trusted Claude settings, and an allowlisted SDK environment. Do not run this package against untrusted repositories, untrusted MCP servers, untrusted plugin paths, or broad host filesystem mounts.

The wakeup/native HTTP server defaults to loopback. If you bind it to a non-loopback host, configure an `authToken`.

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
```

- [ ] **Step 2: Add Scribble handoff note**

Create `/Users/drewritter/prime-rad/sen/bot-toolkit/docs/superpowers/handoffs/2026-05-04-pri-1488-scribble-bot-toolkit.md`:

```md
# PRI-1488 Scribble Bot Toolkit Handoff

Bot-toolkit should be consumed as `@primeradiant/bot-toolkit`.

Scribble should remove the private `file:./lib/bot-toolkit` dependency and bare `bot-toolkit` imports. Replace source imports with scoped imports from `@primeradiant/bot-toolkit`.

Scribble should keep its concrete Slack adapter in this workstream. The original bot-toolkit architecture keeps concrete Slack/Bolt and email transport adapters in consuming applications. Bot-toolkit provides core primitives and platform identifiers only.

Required validation for Scribble:

```bash
npm install /absolute/path/to/primeradiant-bot-toolkit-0.1.0.tgz
npm run build
npm test
rg \"from 'bot-toolkit'|from \\\"bot-toolkit\\\"\" src
test ! -d node_modules/bot-toolkit
```
```

- [ ] **Step 3: Verify README examples typecheck**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
mkdir -p .tmp/readme-smoke
cat > .tmp/readme-smoke/package.json <<'JSON'
{
  "type": "module",
  "dependencies": {
    "@primeradiant/bot-toolkit": "file:../.."
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
JSON
cat > .tmp/readme-smoke/index.ts <<'TS'
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
} from '@primeradiant/bot-toolkit';

const names = [
  BaseAdapter,
  BaseResponder,
  ClaudeSessionManagerSDK,
  ConversationOrchestrator,
  Logger,
  MessageSessionStore,
  SessionDatabase,
  getRoomDirectory,
];

const platform: Platform = 'native';
const callbacks: Partial<SessionCallbacks> = {};
const orchestrator: MessageOrchestrator = {
  async handleMessage(_message: IncomingMessage, _responder: PlatformResponder) {},
};
const config: BaseAdapterConfig = {
  orchestrator,
  authorizedUsers: ['user'],
  dataDir: '/tmp/bot-toolkit-readme',
};
const payload: Partial<WakeupPayload> = { room_id: 'native:room' };

console.log(names.length, platform, callbacks, config, payload);
TS
cat > .tmp/readme-smoke/tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"]
}
JSON
(cd .tmp/readme-smoke && npm install && npx tsc --noEmit)
```

Expected: `npx tsc --noEmit` passes.

- [ ] **Step 4: Commit docs**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add README.md docs/superpowers/handoffs/2026-05-04-pri-1488-scribble-bot-toolkit.md
git commit -m "docs: document public core package boundary"
```

Expected: commit succeeds.

---

### Task 9: Public CI

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/bot-toolkit/.github/workflows/ci.yml`
- Delete: `/Users/drewritter/prime-rad/sen/bot-toolkit/.github/workflows/trigger-build.yml`

- [ ] **Step 1: Replace CI with public quality gate**

Set `.github/workflows/ci.yml` to:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run check
```

- [ ] **Step 2: Ensure private dispatch workflow is absent**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
rm -f .github/workflows/trigger-build.yml
test ! -f .github/workflows/trigger-build.yml
```

Expected:

```text
```

- [ ] **Step 3: Commit CI changes**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git add .github/workflows/ci.yml
git add -u .github/workflows
git status --short
git commit -m "ci: run public package quality gate"
```

Expected: commit succeeds.

---

### Task 10: Full Verification And Local Consumer Smoke

**Files:**
- Generated: `/Users/drewritter/prime-rad/sen/bot-toolkit/primeradiant-bot-toolkit-0.1.0.tgz`
- Temporary: `/Users/drewritter/prime-rad/sen/bot-toolkit/.tmp/consumer-smoke`
- Temporary: `/Users/drewritter/prime-rad/sen/bot-toolkit/.tmp/scribble-smoke`

- [ ] **Step 1: Run the package quality gate**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm ci
npm run check
npm run build
npm test
npm pack --dry-run
```

Expected:

```text
> @primeradiant/bot-toolkit@0.1.0 check
```

The final `npm pack --dry-run` output must include `dist/index.js`, `dist/index.d.ts`, `README.md`, `LICENSE`, and `package.json`. It must not include `src/`, test files, local superpowers specs/plans, private workflows, source maps, or declaration maps.

- [ ] **Step 2: Create real tarball**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm pack
ls -1 *.tgz
```

Expected:

```text
primeradiant-bot-toolkit-0.1.0.tgz
```

- [ ] **Step 3: Verify throwaway TypeScript consumer**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
rm -rf .tmp/consumer-smoke
mkdir -p .tmp/consumer-smoke
cat > .tmp/consumer-smoke/package.json <<'JSON'
{
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@primeradiant/bot-toolkit": "file:../../primeradiant-bot-toolkit-0.1.0.tgz"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
JSON
cat > .tmp/consumer-smoke/index.ts <<'TS'
import {
  AttentionTracker,
  BaseAdapter,
  BaseResponder,
  ClaudeSessionManagerSDK,
  ConversationLogger,
  ConversationOrchestrator,
  Logger,
  MessageSessionStore,
  SessionDatabase,
  getRoomDirectory,
  type Attachment,
  type BaseAdapterConfig,
  type Config,
  type EngagementConfig,
  type IncomingMessage,
  type ISessionManager,
  type MainSessionRecord,
  type MessageOrchestrator,
  type Platform,
  type PlatformAdapter,
  type PlatformResponder,
  type RoomInfo,
  type SessionCallbacks,
  type SessionStats,
  type ThreadSessionRecord,
  type WakeupPayload,
} from '@primeradiant/bot-toolkit';

const values = [
  AttentionTracker,
  BaseAdapter,
  BaseResponder,
  ClaudeSessionManagerSDK,
  ConversationLogger,
  ConversationOrchestrator,
  Logger,
  MessageSessionStore,
  SessionDatabase,
  getRoomDirectory,
];

const platform: Platform = 'native';
const attachment: Attachment = {
  localPath: '/tmp/file.txt',
  originalName: 'file.txt',
  mimeType: 'text/plain',
  size: 1,
};
const responder: PlatformResponder = {
  cancelled: false,
  async markProcessing() {},
  async clearProcessing() {},
  async markError() {},
  async updateResponse() {},
  async finalizeResponse() {},
  async sendNotice() {},
  async sendFile() {},
  async setTyping() {},
  async updateChannelStats(_stats: SessionStats) {},
  async createThreadStarter() {
    return 'thread';
  },
  async appendCancellationNotice() {},
};
const orchestrator: MessageOrchestrator = {
  async handleMessage(_message: IncomingMessage, _responder: PlatformResponder) {},
};
const adapterConfig: BaseAdapterConfig = {
  orchestrator,
  authorizedUsers: ['user'],
  dataDir: '/tmp/bot-toolkit-consumer',
};
const wakeup: Partial<WakeupPayload> = { room_id: 'native:room' };
const callbacks: Partial<SessionCallbacks> = {};
const config: Partial<Config> = {};
const engagement: Partial<EngagementConfig> = {};
const room: Partial<RoomInfo> = {};
const mainRecord: Partial<MainSessionRecord> = {};
const threadRecord: Partial<ThreadSessionRecord> = {};
const sessionManager: Partial<ISessionManager> = {};
const adapter: Partial<PlatformAdapter> = { platform };

console.log(
  values.length,
  platform,
  attachment,
  responder,
  adapterConfig,
  wakeup,
  callbacks,
  config,
  engagement,
  room,
  mainRecord,
  threadRecord,
  sessionManager,
  adapter,
);
TS
cat > .tmp/consumer-smoke/tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": false
  },
  "include": ["index.ts"]
}
JSON
(cd .tmp/consumer-smoke && npm install && npm run typecheck)
test ! -d .tmp/consumer-smoke/node_modules/bot-toolkit
```

Expected: install and typecheck pass, and `node_modules/bot-toolkit` does not exist.

- [ ] **Step 4: Verify temporary Scribble copy against tarball**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
rm -rf .tmp/scribble-smoke
cp -R /Users/drewritter/prime-rad/sen/scribble .tmp/scribble-smoke
rm -rf .tmp/scribble-smoke/.git .tmp/scribble-smoke/node_modules .tmp/scribble-smoke/lib/bot-toolkit
node - <<'JS'
const fs = require('node:fs');
const path = '.tmp/scribble-smoke/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf-8'));
pkg.dependencies = pkg.dependencies || {};
delete pkg.dependencies['bot-toolkit'];
pkg.dependencies['@primeradiant/bot-toolkit'] =
  'file:../primeradiant-bot-toolkit-0.1.0.tgz';
fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
JS
rg -l "from 'bot-toolkit'|from \"bot-toolkit\"" .tmp/scribble-smoke/src .tmp/scribble-smoke/docs | while read -r file; do
  perl -0pi -e "s/from 'bot-toolkit'/from '\@primeradiant\\/bot-toolkit'/g; s/from \"bot-toolkit\"/from \"\@primeradiant\\/bot-toolkit\"/g" "$file"
done
(cd .tmp/scribble-smoke && npm install && npm run build && npm test)
! rg "from 'bot-toolkit'|from \"bot-toolkit\"" .tmp/scribble-smoke/src
test ! -d .tmp/scribble-smoke/node_modules/bot-toolkit
```

Expected: Scribble install, build, and tests pass in the temporary copy. The source import search returns no matches.

- [ ] **Step 5: Record verification output in handoff note**

Append to `docs/superpowers/handoffs/2026-05-04-pri-1488-scribble-bot-toolkit.md`:

```md
## Bot Toolkit Verification

Completed on 2026-05-04 from `/Users/drewritter/prime-rad/sen/bot-toolkit`.

Commands run:

```bash
npm ci
npm run check
npm run build
npm test
npm pack --dry-run
npm pack
```

Consumer smoke:

```bash
.tmp/consumer-smoke npm install
.tmp/consumer-smoke npm run typecheck
```

Scribble smoke:

```bash
.tmp/scribble-smoke npm install
.tmp/scribble-smoke npm run build
.tmp/scribble-smoke npm test
```

Outcome: all listed commands passed.
```

- [ ] **Step 6: Final commit**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
git status --short
git add docs/superpowers/handoffs/2026-05-04-pri-1488-scribble-bot-toolkit.md
git commit -m "docs: record Scribble tarball validation"
git status --short
```

Expected: final `git status --short` is empty or only shows ignored local `.tgz`/`.tmp` artifacts.

---

## Self-Review Checklist

- Spec coverage: tasks cover fresh repo/history, hardening branch carry-forward, package shape, dependencies, platform boundary, Scribble unblock, bypass permission hardening, env allowlisting, path/route security, public API, docs, Biome, CI, and verification.
- Placeholder scan: no task contains placeholder work; each file change has concrete content, commands, or exact source branch copy instructions.
- Type consistency: `MessageOrchestrator` is defined once in `src/core/types.ts`, used by `BaseAdapterConfig`, and exported from `src/core/index.ts`.
- Adapter boundary: no task adds Slack SDK dependencies, email transport dependencies, `SlackAdapter`, `EmailAdapter`, or adapter subpath exports.
- Verification: final gate uses real packed tarball and a temporary Scribble copy, not a directory `file:` shortcut.
