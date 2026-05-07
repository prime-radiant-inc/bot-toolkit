# Room Instructions Boundary Design

Date: 2026-05-07

## Context

`@primeradiant/bot-toolkit` is being prepared as the reusable npm package for unattended Claude-powered chat agents. Scribble is the first public consumer we must preserve, but the package also needs to support other Prime Radiant consumers such as sen and spec-together without encoding Scribble-specific policy.

Bot-toolkit creates per-room working directories for Claude sessions. When it creates a platform rooms directory such as `rooms/slack/`, it also writes a platform-level `CLAUDE.md`.

The current generated platform index is too permissive for an OSS package. It tells Claude that it may read other rooms' chat history, repos, and MCP data, and it references private `claude-pa` documentation. Bot-toolkit launches Claude with the room directory as `cwd`, so generated room instructions are part of the runtime prompt surface. User/project settings, MCP tool descriptions, app system prompts, and message context are separate runtime prompt surfaces that this design must not accidentally confuse with generated filesystem docs.

Scribble still needs cross-channel memory. That behavior is already owned by Scribble through its system prompt, `<background-context>`, and `conversation_search` tool. The bot-toolkit generated filesystem instructions should not grant that policy on Scribble's behalf.

Live Scribble inspection confirmed the distinction:

- `/data/rooms/slack/CLAUDE.md` contains the broad old template.
- Most room-level `CLAUDE.md` files are generated placeholders.
- At least one room-level `CLAUDE.md` contains hand-authored private-channel context.
- Scribble's real conversation memory lives primarily under `/data/conversations`, not `rooms/*/chat-history`.

## Goals

- Make bot-toolkit's generated `CLAUDE.md` files safe and host-application-neutral for public npm release.
- Make generated Markdown safe when room names, channel names, user display names, and IDs come from external platforms.
- Preserve existing generated `CLAUDE.md` files unless an operator manually cleans them up.
- Preserve Scribble's intentional cross-channel context behavior and current deployment/install shape.
- Keep the package suitable for Scribble, sen, spec-together, and future consumers without baking in one app's memory policy.
- Verify the built npm package artifact, not only source files.

## Non-Goals

- Do not redesign Scribble's memory model.
- Do not weaken or remove Scribble's current cross-channel awareness, global conversation search, or current-message attachment handling.
- Do not change Scribble's `<background-context>` payload shape, source attribution, search defaults, Docker/deploy shape, or production data as part of this fix.
- Do not add per-channel privacy controls.
- Do not implement filesystem sandboxing or tool-level enforcement.
- Do not migrate the current production Scribble data directory.
- Do not overwrite existing platform-level or room-level `CLAUDE.md` files that operators may have edited.
- Do not make sen, spec-together, or future consumers adopt Scribble-specific prompt or storage policy.

## Design

### 1. Neutral Generated Instructions In Bot-Toolkit

Change `src/utils/roomPath.ts` so generated `CLAUDE.md` text is host-application-neutral.

The generated platform index should still explain:

- What the platform rooms directory is.
- How room IDs are sanitized.
- That individual room directories can contain room-specific context.
- That Claude's default workspace for a room is the current room directory.

It should no longer say or imply:

- This directory is a sandbox.
- Claude may read other rooms by default.
- Claude may read repos, MCP data, infrastructure, or other app-specific storage.
- The package has private `claude-pa` documentation.
- Users should grep across `rooms/*/chat-history`.

The core wording should be:

> Use the current room directory for files related to this conversation. Do not infer permission to read or write other room directories from this file. If the host application provides cross-room or cross-channel context, use the host application's system prompt and tools.

This keeps bot-toolkit neutral. Applications that want broader memory can provide it explicitly.

The generated room-level template should also be made neutral for newly created rooms. It should keep room metadata and editable "Purpose" / "Context" sections, but it should not promise that historical chat messages are available in `chat-history/` or imply that filesystem browsing is the memory mechanism. The replacement should say that host applications may provide conversation history through prompts, tools, or app-specific storage, and that the generated room file itself does not grant broader read access.

Bot-toolkit can keep legacy path helpers such as `repos` and `mcp-data` because they are public API/data-layout helpers, but generated prompt text must not present those paths as default readable context. Opt-in cross-room/admin tools such as task-listing tools should be documented as tool surfaces, not filesystem permissions.

### 2. Escape Generated Markdown Metadata

Room metadata can come from external platforms. Before writing generated Markdown, bot-toolkit must escape or constrain:

- `channelId`
- `channelName`
- `userDisplayName`
- any value derived from those fields for headings, inline code, or metadata lines

This is separate from filesystem path sanitization. `sanitizeRoomId()` protects directory names; generated Markdown needs its own formatting/escaping so metadata cannot inject headings, lists, code fences, XML-ish tags, or instruction-looking text into durable `CLAUDE.md` files.

The escaped output should remain readable. It does not need to preserve every Markdown character literally if replacing dangerous characters with spaces or escaped forms is simpler and clearer.

### 3. Keep Existing Generated Files Stable

Platform-level and room-level files may have been edited by operators. The implementation must not overwrite existing `rooms/<platform>/CLAUDE.md` or `rooms/<platform>/<room>/CLAUDE.md` files. This matches current behavior and protects hand-authored channel context.

If future work changes default templates, it applies only to newly created platform indexes and newly created rooms.

### 4. No Production Migration

This spec does not require changing the current Scribble instance.

Production remains intentionally unchanged until an operator chooses manual cleanup. For operators who want to clean up an existing deployment, documentation may describe a manual replacement of `rooms/<platform>/CLAUDE.md`. The implementation should not ship an automatic live-data migration.

If a future migration is needed, it must be conservative and only touch platform-level generated index files that match old-template markers such as `claude-pa` and `Read from other rooms' chat-history, repos, MCP data`.

### 5. Minimal Scribble Clarification

Scribble should keep its current behavior. The goal is not to make Scribble less capable because that sounds safer. The goal is to make Scribble-owned prompt/tool/doc surfaces describe the behavior it already has, while removing generic bot-toolkit filesystem permission grants.

Add a small clarification in Scribble documentation and runtime tool/guidance text:

- Cross-channel awareness comes from Scribble-provided `<background-context>` and `conversation_search`.
- The `conversation_search` tool should say that omitting `channel_id` performs global logged-conversation search.
- `conversation_search` results should be used with relevance, attribution, and privacy judgment when referenced across channels.
- Existing constitution language such as "perfect memory" should remain product-true but become source-precise: Scribble remembers through Scribble-provided context/tools for conversations where Scribble is present.
- Current behavior remains unchanged: recent public-channel context and global conversation search continue to work as documented.

The expected touchpoints are:

- `README.md`, in "What Scribble Reads and How Data Flows".
- `src/constitution/base.ts`, in the constitution text near safety or tool-usage guidance.
- `src/mcp/index.ts` or the relevant tool description source for `conversation_search`.
- Existing tests for constitution and MCP/tool wording, adjusted only as needed to pin the new wording.
- If documentation around the temporary bot-toolkit package bridge is touched, update Scribble's `AGENTS.md` and `CLAUDE.md` in the same spirit. Otherwise, treat their broader cleanup as non-blocking.

Do not change `src/context/crossChannelContext.ts`, its payload shape, its source-path attribution, global `conversation_search` behavior, current-message attachment `localPath` handling, Docker/deploy shape, or production data in this pass. Those may be future product/security decisions, but they are not the bot-toolkit npm release blocker.

This makes Scribble the authority for Scribble's memory policy without pushing app-specific policy into bot-toolkit. It also keeps the same installation/deployment behavior that currently works well.

### 6. Npm And Transitional Tarball Validation

Publishing bot-toolkit to npm is part of why this work exists. After publish, Scribble should be able to consume `@primeradiant/bot-toolkit` from npm instead of a local `.tgz` bridge. That transition is useful, but it should not turn this prompt-boundary fix into a deployment rewrite.

The durable release gate is: the exact package artifact that npm will publish must be clean. Source tests alone are not enough because `package.json` publishes `dist/`, README, LICENSE, and package metadata.

Before npm publish, local tarball validation remains a pre-publish stand-in for the registry artifact. Treat it as transitional scaffolding, not a durable Scribble architecture.

For Scribble validation, choose one explicit path:

- Update Scribble's tarball lockfile/bridge refs to the cleaned packed artifact and validate the normal bridge path.
- Or validate Scribble through a temporary install of the exact cleaned `npm pack` artifact and do not claim the normal Docker bridge path has been validated.

After npm publish, move Scribble to the registry package before calling the Scribble standalone OSS install story final. That post-publish dependency transition can be a follow-up if it would expand this fix too far.

## Testing

### Bot-Toolkit

Update `src/utils/__tests__/roomPath.test.ts` to assert that generated platform indexes and newly generated room-level templates:

- Contain platform-specific directory context.
- Mention host-application-provided context/tools as the source of broader access.
- Preserve editable room-specific context sections.
- Do not mention `claude-pa`.
- Do not mention `mcp-data` or `MCP data`.
- Do not mention `repos/` or `infrastructure/`.
- Do not say or imply reading other rooms is OK.
- Do not call the room directory a sandbox.
- Do not include all-room `grep` examples.
- Escape or neutralize Markdown metadata injection in headings, metadata lines, and inline-code contexts.
- Preserve existing platform-level and room-level `CLAUDE.md` files byte-for-byte.

Run the normal bot-toolkit check suite and package validation:

- `npm run check`
- `npm pack --dry-run`
- A real `npm pack` into a temporary location, followed by an unpacked artifact scan of the built generated-instruction code.
- A clean temporary consumer install from the packed `.tgz`, with import/typecheck smoke coverage.
- Dependency/audit output inspected for runtime issues; critical/high runtime vulnerabilities block release, while moderate findings require an explicit fix, upgrade, pin, or documented release exception.

The artifact scan should fail if generated-instruction templates in built `dist/` still contain `read from other rooms`, `MCP data`, `mcp-data`, `repos/`, `infrastructure/`, `This is your sandbox`, or `grep` examples over `rooms/*/chat-history`. Separately, the whole packed artifact should fail if it contains private references such as `claude-pa`. Do not make the template scan fail on legitimate non-template text such as the README's "not a sandbox" security warning, legacy path-helper constants, or bot-toolkit's non-prompt `chat-history` storage code.

### Scribble

Run the relevant Scribble checks for the touched files. At minimum, verify the changed text preserves the documented behavior that:

- Recent public-channel context may be included in the system prompt.
- `conversation_search` can search logged conversations.
- Omitting `channel_id` from `conversation_search` means global logged-conversation search.
- Runtime guidance says Slack history discovery comes from `<background-context>` and `conversation_search`.
- Current-message attachment `localPath` values remain allowed.
- The generated bot-toolkit room directories are not the policy surface for cross-channel memory.

Use exact commands rather than a vague "check" script. For this scope, use targeted tests for touched constitution/MCP/docs behavior, then `npm test` and `npm run build:all` if Scribble code changes. If validating the normal tarball bridge, also run `npm run check:bridge`. If Docker/package/deploy shape changes, run a Docker build smoke; otherwise Docker is intentionally out of scope.

When validating before npm publish, Scribble may temporarily install the locally packed bot-toolkit artifact. When validating after npm publish, prefer installing the actual npm version. In either case, verify Scribble is exercising the cleaned package artifact rather than stale source, stale `dist/`, or an old local `.tgz`.

## Release Notes

This is an OSS release blocker because generated project instructions are part of the runtime prompt surface. The release should describe the change as a safety/documentation correction:

> Generated room directory instructions no longer grant app-specific cross-room read access. Host applications that provide broader context should do so explicitly through their own prompts and tools.

For the initial npm release, include this in the package release notes or README release section. If the package has not yet been published, version `0.1.0` can remain the initial release version unless npm registry state says otherwise.

## Acceptance Criteria

- New bot-toolkit-generated platform index files and room-level files are host-application-neutral.
- New bot-toolkit-generated Markdown escapes external metadata safely.
- No generated text references private Prime Radiant internals.
- No generated text grants default cross-room read access.
- Packed npm artifact contents are scanned and clean.
- Existing platform-level and room-level generated files are not overwritten.
- Scribble's documented cross-channel memory behavior remains intact.
- Scribble's runtime guidance preserves current-message attachment reads and current cross-channel/search behavior.
- Scribble `crossChannelContext`, global `conversation_search`, Docker/deploy shape, and production data are unchanged unless a later explicit product/security decision says otherwise.
- Existing Scribble production data is not migrated by this work.
