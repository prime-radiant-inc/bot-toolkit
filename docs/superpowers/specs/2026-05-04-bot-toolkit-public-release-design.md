# Bot Toolkit Public Release Design

Status: Draft for Drew review
Date: 2026-05-04
Issues: PRI-1487, supporting PRI-1488
Canceled follow-up: PRI-1491

## Goal

Make `@primeradiant/bot-toolkit` a publish-ready package that Scribble can consume with normal scoped imports. The work happens in a fresh repository at `/Users/drewritter/prime-rad/sen/bot-toolkit`; `/Users/drewritter/prime-rad/sen/bot-toolkit-archive` remains the evidence source and archive.

The first pass should create a clean public baseline: archive the useful implementation, apply the vetted hardening work, remove stale private/public mismatches, and establish strict project quality gates. Scribble integration comes after this package can be built, tested, packed, and consumed locally with the correct `@primeradiant/bot-toolkit` import path.

This pass should not publish to npm. Prime Radiant is the only current consumer, so validation should happen locally first.

The v1 audience is builders of unattended Claude Code chat agents who want reusable session resumption, per-room working directories, MCP/plugin configuration, event deduplication, thread/session tracking, wakeups, attention state, streaming responder primitives, and native chat route pieces while keeping their concrete platform adapters in their applications.

## Baseline Decisions

- The new repo starts from a curated public baseline, not the archive's full git history.
- `@primeradiant/bot-toolkit` is shaped as reusable core bot infrastructure first.
- The package keeps Slack-aware primitives because Scribble's current Slack adapter needs them.
- The package does not claim to bundle a reusable concrete Slack Bolt adapter in PRI-1487.
- Do not bundle concrete Slack or email adapters in this workstream; the original toolkit design kept those adapters consumer-owned.
- Matrix is removed from the public platform surface because no Matrix adapter is present.
- The Claude SDK remains in bypass-permissions mode, with hardening around env, cwd, routes, and docs.
- Strict Biome checks are part of the baseline, and lint fixes are preferred over lint disables.
- npm publication is out of scope for this pass; local package consumption is the validation path.
- A real packed tarball is the canonical local-consumption artifact. Directory `file:` installs are allowed only as a secondary dev convenience.
- Scribble's current root imports are compatibility requirements for PRI-1487; do not accidentally narrow exports below what Scribble needs.

## Non-Goals

- Do not migrate Scribble in this pass.
- Do not extract a reusable concrete Slack adapter in this pass.
- Do not extract a reusable concrete email adapter in this pass.
- Do not publish from the archive checkout.
- Do not publish to npm in this pass.
- Do not keep a temporary package alias as the long-term Scribble integration path.
- Do not add permission-mode configurability in v1.
- Do not remove `permissionMode: 'bypassPermissions'` or `allowDangerouslySkipPermissions: true`.
- Do not reintroduce Matrix as a public platform unless a real Matrix adapter is added later.
- Do not preserve private deployment workflows, private package assumptions, or stale internal branding.

## Source Strategy

The fresh repo should not be a raw clone history of the archive. It should start with a curated baseline derived from:

- `bot-toolkit-archive` `main`, as the implementation evidence.
- `bot-toolkit-archive` `origin/release/public-release-hardening`, as the first hardening candidate.
- Additional cleanup discovered during review, especially around public package metadata, docs, linting, tests, and stale platform references.

The first commit in the fresh repo should represent "public release baseline" rather than "raw archive snapshot". This keeps the new repository history understandable and avoids carrying internal archaeology into the public project.

The intended repository metadata should point at `prime-radiant-inc/bot-toolkit`, matching the existing archive remote. If the final GitHub slug changes, update package metadata, README links, and Linear ticket references together.

## Hardening Branch Treatment

Use `origin/release/public-release-hardening` as evidence and a patch source, not as an unquestioned final answer.

Expected changes to carry forward:

- npm release metadata, `files`, `publishConfig`, and `prepack`
- env allowlisting for Claude SDK execution
- wakeup/native route protection
- native session path validation
- Matrix public-surface removal
- package/readme cleanup that is still accurate after this spec

Known gaps to correct rather than inherit:

- no strict Biome setup
- docs that can still blur platform identifiers with bundled adapters
- dependency placement that needs public-package review
- any private deployment workflow or internal release assumption
- any test fixture or comment that keeps Matrix alive as a fake current platform

## Package Shape

The package name is `@primeradiant/bot-toolkit`. It should be an ESM TypeScript package that builds to `dist/` and exposes only intended package entrypoints.

The public package should include:

- `dist/`
- `dist/index.js`
- `dist/index.d.ts`
- `README.md`
- `LICENSE`
- `package.json`
- package metadata required for local package consumption now and public npm consumption later

The public package should exclude:

- `src/`
- tests
- local plans/specs
- `.github/` internals unless they are intentional public CI workflows
- private deployment workflows
- lockfiles in the packed tarball
- generated local artifacts

`npm pack --dry-run` is the release-surface test. The tarball must contain the compiled public package, not the source checkout. A real local `npm pack` tarball should be used to test Scribble without publishing to npm. The implementation may use a directory `file:` dependency for quick local iteration, but the completion gate must install and test the packed tarball.

The public baseline should not ship source maps or declaration maps unless the corresponding source files are intentionally included. Prefer declarations without maps for this pass.

## Dependency Policy

Dependencies should match what the package actually ships.

PRI-1487 should not add Slack SDK dependencies such as `@slack/bolt` or `@slack/web-api` because this package should not ship a concrete Slack adapter module. The same rule applies to email transport dependencies such as SQS, S3, SES, MIME, or HTML-sanitization packages: keep them out of the core package because concrete email adapters remain consumer-owned.

Runtime dependencies, peer dependencies, and type-only dependencies should be reviewed intentionally:

- packages imported by shipped runtime code belong in `dependencies`
- packages needed only for tests, build, lint, or local type-checking belong in `devDependencies`
- `peerDependencies` should be used only when consumers must provide a compatible singleton or integration dependency
- `@types/*` packages should not be runtime dependencies unless emitted public declarations require them and TypeScript consumers cannot otherwise type-check

The Claude Agent SDK belongs in `dependencies` for PRI-1487 because the toolkit directly imports it for `ClaudeSessionManagerSDK`; do not also list it in `peerDependencies` unless a later design makes SDK version control an explicit consumer contract.

SSM secrets support remains in the v1 core package because the archive exports that config path and Sen consumers use it. The AWS SDK dependency is intentional for this baseline. A future split can move cloud-specific secrets support behind a subpath or optional package if the public audience broadens.

## Platform Surface

The public `Platform` type should remove Matrix and keep the non-Matrix identifiers carried forward by the hardening branch: `slack`, `native`, and `email`.

This section distinguishes two concepts:

- **Platform identifier**: a string used by toolkit primitives for room paths, env setup, wakeups, task registry rows, conversation logs, and adapter interfaces.
- **Packaged adapter module**: a concrete importable implementation such as a hypothetical `@primeradiant/bot-toolkit/slack` module that owns Slack Bolt startup, Socket Mode listeners, Slack Web API calls, and Slack-specific responder behavior. PRI-1487 should not create one.

PRI-1487 keeps `slack` as a platform identifier because Scribble's current Slack adapter uses the toolkit's shared infrastructure. PRI-1487 should not document or imply that `@primeradiant/bot-toolkit` already exports a bundled `SlackAdapter`.

`native` is different because the archive already contains concrete native route/session/responder pieces. Docs can describe native as bundled only to the extent those exports exist and are verified.

`email` should remain as a platform identifier because the broader Sen codebase has a concrete email adapter that depends on shared bot-toolkit platform support. PRI-1487 should not document or imply that `@primeradiant/bot-toolkit` already exports a bundled `EmailAdapter`.

This is not deleting a Matrix adapter. The archive does not contain a Matrix adapter implementation; it contains stale Matrix labels, tests, fixtures, comments, and public type remnants. Removing Matrix from the public union is a public API cleanup.

During implementation, any docs/examples that mention supported platforms must distinguish between toolkit platform identifiers and bundled adapters.

The absence of bundled concrete Slack and email adapters is not a bug in the package shape. Git archaeology suggests the original extraction intentionally kept concrete Slack/Bolt and email transport adapters in consumer/platform packages while moving reusable primitives into bot-toolkit. PRI-1491 was canceled to avoid turning OSS readiness into a new adapter architecture redesign.

## Scribble Unblock Strategy

PRI-1487 should produce a package Scribble can depend on locally with the real import path. A representative import set must work from the root entrypoint:

```ts
import {
  AttentionTracker,
  BaseAdapter,
  BaseResponder,
  ClaudeSessionManagerSDK,
  getRoomDirectory,
  Logger,
  MessageSessionStore,
  SessionDatabase,
  type Attachment,
  type BaseAdapterConfig,
  type Config,
  type EngagementConfig,
  type IncomingMessage,
  type MainSessionRecord,
  type PlatformResponder,
  type RoomInfo,
  type SessionCallbacks,
  type SessionStats,
  type ThreadSessionRecord,
  type WakeupPayload,
} from '@primeradiant/bot-toolkit';
```

Scribble may still keep its concrete Slack adapter during the first OSS-readiness pass. That is acceptable because PRI-1487's job is to remove the private/local `bot-toolkit` dependency and make the shared toolkit publish-ready. It is not required to remove every Slack-specific file from Scribble.

After PRI-1487, Scribble should be able to replace the private submodule or unscoped file dependency with a packed tarball whose package identity is `@primeradiant/bot-toolkit`. Source imports should use the scoped package name so the later publish path does not require import churn.

Scribble should keep its concrete Slack adapter for this workstream and consume only the core package from PRI-1487. Any stale comments that imply Scribble wraps a bundled bot-toolkit `SlackAdapter` should be cleaned during the Scribble integration work.

The canonical validation should happen in a temporary Scribble copy or fresh checkout, not by mutating Scribble in this ticket. The validation copy should:

- have no usable `lib/bot-toolkit` submodule dependency
- install the packed tarball as `@primeradiant/bot-toolkit`
- rewrite source imports from bare `bot-toolkit` to `@primeradiant/bot-toolkit`
- run `npm install`, `npm run build`, and `npm test`
- assert there are no source imports from bare `bot-toolkit`
- assert the validation did not resolve `node_modules/bot-toolkit`

## Claude SDK Permission Model

Keep the current autonomous/headless execution model:

- `permissionMode: 'bypassPermissions'`
- `allowDangerouslySkipPermissions: true`

This is intentional. Scribble's Slack bot needs unattended operation and does not currently have a permission approval loop. Lower-permission modes may be safer in the abstract, but they would likely break expected bot behavior unless Scribble grows a real approval UX and retry model.

The v1 public package should harden this model rather than make it configurable. Hardening means:

- clearly documenting that the toolkit runs Claude Code in unattended/headless mode
- narrowing environment propagation into the SDK process
- keeping per-room/session working directories isolated
- protecting native/wakeup control routes
- ensuring path validation prevents room/session path traversal
- documenting host expectations for secrets, tokens, cwd, and data directories

## Environment Handling

SDK subprocess environment should be allowlisted. The public package should not blindly forward the host process environment into Claude Code.

The allowlist should preserve variables the toolkit actually needs for operation, such as platform identifiers, room/session identifiers, Claude/Anthropic credentials, and intentionally supported runtime configuration. It should exclude broad host secrets by default.

Environment access in code should be centralized at config boundaries. New scattered `process.env` reads should be avoided unless there is a clear config-boundary reason.

## Security Boundaries

The toolkit should be documented and hardened as a trusted local/headless runtime, not a sandbox. `cwd` isolation, per-room directories, and env allowlisting reduce blast radius, but they do not make bypass-permissions execution safe against untrusted code, untrusted MCP servers, untrusted plugin paths, or broad filesystem mounts.

Security requirements for PRI-1487:

- run examples and docs as a dedicated non-root user or container
- use least-privilege filesystem mounts containing only intended data/config
- treat `configDir`, enabled MCP commands, enabled plugin paths, and Claude user/project settings as trusted code/config
- do not forward the broad host process environment into Claude SDK execution
- remove or rewrite docs that recommend `env: { ...process.env }`
- reject empty sanitized room IDs
- validate every path segment used for filesystem writes/reads, including room IDs, session IDs, thread IDs, outbox entries, and conversation log filenames
- default HTTP server binding to loopback
- require `authToken` for non-loopback wakeup/native control routes
- ensure `additionalRoutes` are either protected by the same auth layer or explicitly documented as caller-owned unsafe routes
- keep native/browser-facing routes local/internal unless a specific authenticated browser flow is designed

Public examples should not use `authorizedUsers: []` in a way that normalizes allow-all bots running with privileged MCPs and bypass permissions.

## Public API And Typing

The package should export stable public types and implementation classes that consumers need to build bots. Internal helpers should stay unexported unless they are intentionally part of the public contract.

Known typing cleanup for the baseline:

- define a small public `MessageOrchestrator` interface with `handleMessage(message: IncomingMessage, responder: PlatformResponder): Promise<void>`
- use `MessageOrchestrator` in `BaseAdapterConfig` instead of requiring the concrete `ConversationOrchestrator` class
- export `BaseAdapterConfig` from the public entrypoint if README examples use it
- keep `Platform` aligned with the documented platform identifiers
- include `readonly platform: Platform` on the public `PlatformAdapter` contract, or otherwise type adapter maps as platform-keyed maps that cannot drift from adapter identity
- avoid public docs that reference non-exported types
- use explicit typed test helpers instead of `any`-heavy public examples
- do not add Slack or email adapter subpath exports in this workstream
- define native HTTP routes and WebSocket message unions accurately; emitted `notice`/`file` server messages and accepted `roomSlug`/`roomName` client fields must be typed or removed

The v1 root export allowlist should intentionally include the Scribble compatibility surface:

- values/classes: `AttentionTracker`, `BaseAdapter`, `BaseResponder`, `ClaudeSessionManagerSDK`, `ConversationLogger`, `ConversationOrchestrator`, `getRoomDirectory`, `Logger`, `MessageSessionStore`, `SessionDatabase`
- types: `Attachment`, `BaseAdapterConfig`, `Config`, `EngagementConfig`, `IncomingMessage`, `ISessionManager`, `MainSessionRecord`, `MessageOrchestrator`, `Platform`, `PlatformAdapter`, `PlatformResponder`, `RoomInfo`, `SessionCallbacks`, `SessionStats`, `ThreadSessionRecord`, `WakeupPayload`
- native and wakeup exports that are documented in README

Internal helpers such as low-level session utility functions and task response formatting helpers should not be exported from the root unless the README or consumer smoke tests prove they are intended public API.

For PRI-1487, `SessionDatabase.db` remains a supported v1 compatibility surface because Scribble constructs stores with it today. Do not expand new public examples around raw `better-sqlite3`. Higher-level constructors/factories are welcome if small, but they are not required for this baseline.

## Documentation

README should be public-consumer oriented. It should explain:

- what the toolkit does
- platform identifiers versus bundled adapter modules
- installation from `@primeradiant/bot-toolkit`
- minimal consumer setup
- required environment/configuration
- the autonomous Claude SDK permission model and its security implications
- package build/test/pack commands
- local consumer validation instructions for Scribble
- the consumer-owned adapter boundary, including why PRI-1491 was canceled

Docs should remove stale private branding and Matrix-era examples. Claude SDK notes can remain if they are useful, but they should match the actual public package behavior.

README rules:

- say the package ships core bot primitives and verified native modules
- say `slack` and `email` are platform identifiers used by core APIs
- say concrete Slack and email adapters remain consumer-owned unless a future explicit product/API design reopens that architecture
- do not include `SlackAdapter`, `EmailAdapter`, or `@primeradiant/bot-toolkit/slack` examples in PRI-1487
- ensure every README code example compiles against the exported package

## Quality Gates

The baseline should introduce strict Biome checks and treat them as a quality bar.

Policy:

- do not disable broad/global Biome rules up front
- fix code instead of weakening lint when practical
- production code must pass strict lint without broad exceptions
- any ignore must be local, justified, and rare
- test exceptions should be local and minimal; prefer typed fakes/helpers over `as any`

Known likely exception:

- keep the existing narrow `lint/suspicious/noControlCharactersInRegex` ignore in `sanitize.ts` if the code still strips C0 control characters intentionally

Expected fixes rather than rule disables:

- route stray `console.*` usage through the logger, except inside the logger implementation itself
- replace production `any` with concrete or unknown-based types
- replace non-null assertions with explicit checks or small assertion helpers
- keep `process.env` access centralized in config/env modules

Project checks should include:

- `npm run format` for local formatting
- `npm run format:check` for CI formatting verification
- `npm run lint`
- `npm run typecheck`
- `npm run check` as the full non-mutating CI gate
- `npm run test`
- `npm run build`
- `npm run prepack`
- `npm pack --dry-run`
- local Scribble smoke test using the scoped package identity

`npm run check` should run the non-mutating CI gate: format check, lint, typecheck, tests, build, and pack dry-run. `prepack` should build the package. The exact implementation can use helper scripts, but the public script names above should exist.

## CI

The public repo should have a simple CI workflow that installs dependencies and runs the full quality gate on pull requests and pushes. It should not include private deployment or npm publishing steps in the baseline.

npm publishing can remain a documented future/manual step until release automation is intentionally designed.

## Verification

Completion requires evidence for:

- fresh repo initialized at `/Users/drewritter/prime-rad/sen/bot-toolkit`
- archive checkout left intact
- package builds cleanly
- tests pass
- Biome format/lint/check pass
- `npm pack --dry-run` includes only intended public files
- pack output includes `dist/index.js` and `dist/index.d.ts`
- pack output excludes `src/`, tests, local specs/plans, private workflows, and source/declaration maps that point at missing sources
- a throwaway TypeScript consumer can install the tarball and type-check imports without relying on Scribble's dev dependencies
- a local Scribble smoke test installs the packed tarball as `@primeradiant/bot-toolkit`, rewrites imports in a temp copy, and passes build/tests
- package metadata points at the intended public repository/package identity
- README examples type-check or are otherwise verified against exports

## Risks

The main risk is weakening security accidentally while preserving headless autonomy. The mitigation is to keep bypass mode explicit, documented, and paired with environment/path/control-route hardening.

The second risk is public API drift: docs can advertise types or platforms that the package does not actually provide. The mitigation is to keep docs, exports, tests, and the `Platform` union aligned.

The third risk is producing a source-shaped tarball. The mitigation is to make `npm pack --dry-run` a required gate and inspect its contents before local Scribble validation or any future npm publish.

## Open Decisions

No open product decisions remain for the baseline. Implementation details such as exact Biome rule names, typed test helper shape, and package export file layout should be resolved during the implementation plan while preserving the decisions in this spec.
