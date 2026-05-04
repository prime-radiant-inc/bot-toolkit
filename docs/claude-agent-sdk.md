# Claude Agent SDK Integration Guide

This document covers lessons learned from integrating with `@anthropic-ai/claude-agent-sdk` in bot-toolkit.

## Overview

The Claude Agent SDK provides a way to run Claude Code programmatically. It works by spawning a subprocess that runs the Claude Code CLI (`cli.js`), communicating via stdin/stdout.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({ prompt: 'Hello', options })) {
  // Handle messages
}
```

## Architecture

```
Your Application
      │
      ▼
SDK (sdk.mjs)
      │
      ▼ spawns subprocess
CLI (cli.js) ─────► Anthropic API
      │
      ▼
Session files (~/.claude/projects/)
```

The SDK:
1. Spawns `node cli.js` as a child process
2. Passes options via command-line args and environment
3. Streams messages back via stdout
4. Stores session data in `~/.claude/projects/{project-path}/`

## Key Options

```typescript
const options = {
  // Permission handling
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,  // Required with bypassPermissions

  // Session management
  resume: 'session-uuid',  // Resume an existing session

  // Environment
  env: buildSdkEnv(process.env, { CUSTOM_VAR: 'value' }),
  cwd: '/path/to/working/directory',

  // MCP servers
  mcpServers: {
    'server-name': {
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'xxx' },
    },
  },

  // Structured output (see below)
  outputFormat: { type: 'json_schema', schema: { ... } },

  // Limits
  maxTurns: 10,

  // Debugging
  stderr: (msg) => console.error('SDK:', msg),
};
```

## Structured Output

The SDK supports structured output via an internal `StructuredOutput` tool. When you specify `outputFormat`, the SDK:

1. Adds a `StructuredOutput` tool to the available tools
2. Instructs Claude to use this tool to return structured data
3. Returns the result in `message.structured_output`

### Requirements

Structured output requires the `structured-outputs-2025-11-13` beta header. Add it to your options:

```typescript
const options = {
  outputFormat: { type: 'json_schema', schema: mySchema },
  betas: ['structured-outputs-2025-11-13'],
};
```

**Note**: As of SDK 0.2.27, the TypeScript types only include `'context-1m-2025-08-07'` as a valid beta. Use a type cast:

```typescript
betas: ['structured-outputs-2025-11-13'] as unknown as ('context-1m-2025-08-07')[],
```

### Handling Structured Output Response

```typescript
if (message.type === 'result') {
  const structuredOutput = (message as { structured_output?: unknown }).structured_output;
  if (structuredOutput !== undefined) {
    // Use structured output
    const data = typeof structuredOutput === 'string'
      ? JSON.parse(structuredOutput)
      : structuredOutput;
  }
}
```

## Session Management

### How Sessions Work

Sessions are stored as JSONL files in `~/.claude/projects/{encoded-cwd}/{session-id}.jsonl`. Each file contains the full conversation history.

### Resuming Sessions

```typescript
const options = {
  resume: 'existing-session-uuid',
};
```

### Session File Loss

**Critical Issue**: Session files can be lost during container restarts if `~/.claude/` is not on persistent storage. When this happens:

1. The database still references the session
2. The SDK tries to resume but can't find the file
3. The SDK returns 0 tokens with "success" status (silent failure)
4. No error is thrown

### Detecting Stale Sessions

Check for 0 tokens when resuming:

```typescript
if (resumeSession && stats.contextTokens === 0 && stats.outputTokens === 0) {
  // Session file is likely missing - retry without resume
  return this.sendMessage(roomId, message, platform, context, callbacks, undefined, options);
}
```

## Common Failure Modes

### 1. "Bun is not defined" Error

```
ReferenceError: Bun is not defined
    at Z34 (cli.js:1602:27809)
```

**Cause**: The SDK CLI has some code paths that reference Bun (an alternative JavaScript runtime). When running under Node.js, these paths throw.

**Impact**: This error typically occurs during cleanup and doesn't affect the main functionality. It can be safely logged and ignored.

**Note**: This is a known SDK bug. Filed as issue #161.

### 2. Zero Tokens with Success Status

**Symptoms**:
- `result.usage.input_tokens === 0`
- `result.usage.output_tokens === 0`
- No API call visible in logs
- SDK reports success

**Causes**:
1. **Missing session file** when trying to resume (most common)
2. **Missing API key** in environment
3. **Invalid API key**

**Solution**: Check for 0 tokens and retry without resume, or verify API key is present.

### 3. "Invalid API key - Please run /login"

**Cause**: The `ANTHROPIC_API_KEY` environment variable is not set or not passed to the subprocess.

**Solution**: Ensure the SDK environment allowlist includes `ANTHROPIC_API_KEY`, then build the subprocess environment through `buildSdkEnv`:

```typescript
const options = {
  env: buildSdkEnv(process.env, {
    ROOM_ID: 'native:session-id',
    PLATFORM: 'native',
  }),
};
```

### 4. "cannot be used with root/sudo privileges"

```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

**Cause**: Running with `bypassPermissions` while the process runs as root.

**Solution**: Run the application as a non-root user. In Docker:

```dockerfile
USER myuser
CMD ["node", "app.js"]
```

### 5. Infinite Loop with StructuredOutput

**Symptoms**: Hundreds of turns, then stack overflow:
```
Turns: 874
RangeError: Maximum call stack size exceeded
```

**Cause**: Unknown SDK bug, possibly related to Node.js version differences.

**Observed**: Only in Node 20.x containers, not in Node 25.x locally.

## Environment Requirements

### Node.js Version

SDK requires Node.js >= 18.0.0. Tested working:
- Node 20.20.0 (with caveats)
- Node 25.2.1

### Required Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...  # Required for API calls
```

### Recommended Options for Server Use

```typescript
const options = {
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  env: buildSdkEnv(process.env, {
    ROOM_ID: 'native:session-id',
    PLATFORM: 'native',
  }),
  stderr: (msg) => logger.debug('SDK stderr', { msg }),
};
```

## Message Types

The SDK yields various message types:

```typescript
for await (const message of query({ prompt, options })) {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        // Session started
        const sessionId = message.session_id;
      }
      if (message.subtype === 'compact_boundary') {
        // Context was compacted
        const { pre_tokens, trigger } = message.compact_metadata;
      }
      break;

    case 'assistant':
      // Claude's response (may have multiple content blocks)
      for (const block of message.message.content) {
        if (block.type === 'text') { /* text response */ }
        if (block.type === 'tool_use') { /* tool call */ }
      }
      break;

    case 'stream_event':
      // Streaming delta (for real-time display)
      if (message.event?.type === 'content_block_delta') {
        const text = message.event.delta.text;
      }
      break;

    case 'result':
      // Final result
      const { usage, total_cost_usd, duration_ms, structured_output } = message;
      break;
  }
}
```

## Debugging Tips

### Enable SDK Debug Output

```typescript
const options = {
  env: buildSdkEnv(process.env, {
    ROOM_ID: 'native:session-id',
    PLATFORM: 'native',
  }),
  stderr: (msg) => console.error('[SDK]', msg),
};
```

### Check Session Files

```bash
# List sessions for a project
ls -la ~/.claude/projects/-path-to-project/

# View session content
cat ~/.claude/projects/-path-to-project/{session-id}.jsonl | head -20
```

### Verify API Requests

If using llm-proxy or similar, check the actual API requests:
- Are requests being made?
- Do they include the right tools?
- What's the response status?

## Version Compatibility

| SDK Version | Notes |
|-------------|-------|
| 0.2.27 | Stable, used in production |
| 0.2.29 | Latest, untested |

## References

- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Structured Outputs Issue #18935](https://github.com/anthropics/claude-code/issues/18935)
- [Bun Error Issue #161](https://github.com/anthropics/claude-agent-sdk-typescript/issues/161)
