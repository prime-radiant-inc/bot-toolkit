# Room Instructions Boundary Design

Date: 2026-05-07

## Context

`@primeradiant/bot-toolkit` creates per-room working directories for Claude sessions. When it creates a platform rooms directory such as `rooms/slack/`, it also writes a platform-level `CLAUDE.md`.

The current generated platform index is too permissive for an OSS package. It tells Claude that it may read other rooms' chat history, repos, and MCP data, and it references private `claude-pa` documentation. Because bot-toolkit launches Claude with the room directory as `cwd` and project settings enabled, generated `CLAUDE.md` files are live prompt instructions, not inert documentation.

Scribble still needs cross-channel memory. That behavior is already owned by Scribble through its system prompt, `<background-context>`, and `conversation_search` tool. The bot-toolkit generated filesystem instructions should not grant that policy on Scribble's behalf.

Live Scribble inspection confirmed the distinction:

- `/data/rooms/slack/CLAUDE.md` contains the broad old template.
- Most room-level `CLAUDE.md` files are generated placeholders.
- At least one room-level `CLAUDE.md` contains hand-authored private-channel context.
- Scribble's real conversation memory lives primarily under `/data/conversations`, not `rooms/*/chat-history`.

## Goals

- Make bot-toolkit's generated platform-level `CLAUDE.md` safe for public npm release.
- Preserve Scribble's intentional cross-channel context behavior.
- Avoid any automatic rewrite of existing room-level `CLAUDE.md` files.
- Give future implementers clear tests and release checks for the boundary.

## Non-Goals

- Do not redesign Scribble's memory model.
- Do not add per-channel privacy controls.
- Do not implement filesystem sandboxing or tool-level enforcement.
- Do not migrate the current production Scribble data directory.
- Do not overwrite room-specific `CLAUDE.md` files that operators may have edited.

## Design

### 1. Neutral Generated Platform Indexes In Bot-Toolkit

Change `src/utils/roomPath.ts` so `createRoomsIndexClaudeMd()` writes host-application-neutral guidance.

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

### 2. Keep Room-Level Files Stable

Do not change generated room-level `CLAUDE.md` behavior beyond any narrow wording needed to avoid false claims.

Room-level files may have been edited by operators. The implementation must not overwrite existing room-level files. This matches current behavior and protects hand-authored channel context.

If future work changes the default room-level template, it applies only to newly created rooms.

### 3. No Production Migration

This spec does not require changing the current Scribble instance.

For operators who want to clean up an existing deployment, documentation may describe a manual replacement of `rooms/<platform>/CLAUDE.md`. The implementation should not ship an automatic live-data migration.

If a future migration is needed, it must be conservative and only touch platform-level generated index files that match old-template markers such as `claude-pa` and `Read from other rooms' chat-history, repos, MCP data`.

### 4. Scribble Clarification

Scribble should keep its current cross-channel behavior, but the boundary should be explicit in Scribble-owned text.

Add a small clarification in Scribble documentation and runtime guidance:

- Cross-channel awareness comes from Scribble-provided `<background-context>` and `conversation_search`.
- Claude should not rely on direct filesystem browsing of bot-toolkit room directories to discover Slack history.
- Current behavior remains unchanged: recent public-channel context and global conversation search continue to work as documented.

The expected touchpoints are:

- `README.md`, in "What Scribble Reads and How Data Flows".
- `src/constitution/base.ts`, in the constitution text near safety or tool-usage guidance.
- Existing tests for constitution rendering and documented cross-channel context, adjusted only as needed to pin the new wording.

This makes Scribble the authority for Scribble's memory policy without pushing app-specific policy into bot-toolkit.

## Testing

### Bot-Toolkit

Update `src/utils/__tests__/roomPath.test.ts` to assert that generated platform indexes:

- Contain platform-specific directory context.
- Mention host-application-provided context/tools as the source of broader access.
- Do not mention `claude-pa`.
- Do not mention `mcp-data`.
- Do not mention `repos/`.
- Do not say reading other rooms is OK.
- Do not include all-room `grep` examples.

Run the normal bot-toolkit check suite and package validation:

- `npm run check`
- `npm pack --dry-run`

### Scribble

Run the relevant Scribble checks for the touched files. At minimum, verify the changed text preserves the documented behavior that:

- Recent public-channel context may be included in the system prompt.
- `conversation_search` can search logged conversations.
- The generated bot-toolkit room directories are not the policy surface for cross-channel memory.

## Release Notes

This is an OSS release blocker because generated project instructions are part of the runtime prompt surface. The release should describe the change as a safety/documentation correction:

> Generated room directory instructions no longer grant app-specific cross-room read access. Host applications that provide broader context should do so explicitly through their own prompts and tools.

## Acceptance Criteria

- New bot-toolkit-generated platform index files are host-application-neutral.
- No generated text references private Prime Radiant internals.
- No generated text grants default cross-room read access.
- Room-level files are not overwritten.
- Scribble's documented cross-channel memory behavior remains intact.
- Existing Scribble production data is not migrated by this work.
