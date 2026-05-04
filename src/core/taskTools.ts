// src/core/taskTools.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Logger } from '../utils/logger.js';
import {
  buildActiveTaskResponse,
  buildRecentTaskResponse,
  formatRunningFor,
} from './taskRegistry.js';
import type { BotToolkitMcpSdkServerConfigWithInstance } from './sdkTypes.js';
import type { CancelResult, ITaskRegistry } from './taskRegistry.types.js';

const logger = new Logger('TaskTools');

const DEFAULT_CANCEL_TIMEOUT_MS = 15_000;

type TaskToolContent = {
  type: 'text';
  text: string;
};

export interface BotToolkitTaskTool {
  name: string;
  handler(
    args: Record<string, unknown>,
    context: unknown,
  ): Promise<{ content: TaskToolContent[] }>;
}

type SdkToolDefinitions = Parameters<typeof createSdkMcpServer>[0]['tools'];

export interface TaskToolsOptions {
  /** Timeout in ms to await session promise during cancel. Default: 15000 */
  cancelTimeoutMs?: number;
}

/**
 * Create task management tool definitions for the Claude Agent SDK.
 *
 * Returns an array of SdkMcpToolDefinition objects that can be passed
 * to `createSdkMcpServer({ tools: ... })`.
 */
export function createTaskTools(
  registry: ITaskRegistry,
  options?: TaskToolsOptions,
): BotToolkitTaskTool[] {
  const cancelTimeoutMs = options?.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS;
  const listActiveTasks = tool(
    'list_active_tasks',
    'List all currently active (in-progress) tasks across all rooms and platforms. Returns task IDs, room, prompt preview, and how long each task has been running.',
    {},
    async () => {
      const rows = registry.getActive();
      const response = buildActiveTaskResponse(rows);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  const listRecentTasks = tool(
    'list_recent_tasks',
    'List recently completed, cancelled, or errored tasks. Returns task IDs, status, duration, token usage, and cost. Useful for understanding recent activity and costs.',
    { hours: z.number().optional() },
    async (args) => {
      const hours = Math.min(args.hours ?? 24, 168);
      const rows = registry.getRecent(hours);
      const response = buildRecentTaskResponse(rows);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  const cancelTask = tool(
    'cancel_task',
    'Cancel an active task by session ID. Always confirm with the user before cancelling. Never cancel a task in the thread you are currently responding to. If the result is "starting_up", tell the user to try again in a moment.',
    { session_id: z.string() },
    async (args) => {
      const { session_id: sessionId } = args;
      const result = await cancelTaskHandler(
        registry,
        sessionId,
        cancelTimeoutMs,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  return [
    listActiveTasks,
    listRecentTasks,
    cancelTask,
  ] as unknown as BotToolkitTaskTool[];
}

/**
 * Create an in-process SDK MCP server with task management tools.
 *
 * The returned value can be merged directly into the `mcpServers` dict
 * passed to the Claude Agent SDK's `query()` function.
 */
export function createTaskToolsServer(
  registry: ITaskRegistry,
  options?: TaskToolsOptions,
): BotToolkitMcpSdkServerConfigWithInstance {
  const tools = createTaskTools(registry, options);
  return createSdkMcpServer({
    name: 'task-management',
    tools: tools as unknown as SdkToolDefinitions,
  }) as BotToolkitMcpSdkServerConfigWithInstance;
}

async function cancelTaskHandler(
  registry: ITaskRegistry,
  sessionId: string,
  timeoutMs: number,
): Promise<CancelResult> {
  const entry = registry.getEntry(sessionId);
  const liveEntry = registry.getLiveEntry(sessionId);

  // Not found at all
  if (!entry) {
    return {
      status: 'not_found',
      message: `No task found with session ID "${sessionId}".`,
    };
  }

  // Task exists in SQLite but is not active
  if (entry.status !== 'active') {
    return {
      status: 'already_completed',
      promptPreview: entry.prompt_preview,
      message: `Task already has status "${entry.status}".`,
    };
  }

  // Active in SQLite but not yet in the live map (still starting up)
  if (!liveEntry) {
    return {
      status: 'starting_up',
      promptPreview: entry.prompt_preview,
      message: 'Task is still starting up. Try again in a moment.',
    };
  }

  // ── Happy path: cancel the active task ──────────────────────

  // 1. Abort the controller (signals the SDK query to stop)
  liveEntry.abortController.abort();

  // 2. Await the session promise with a timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      liveEntry.sessionPromise,
      new Promise<void>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Session promise timed out')),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    logger.warn('cancel_task: session promise did not resolve within timeout', {
      sessionId,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  // 3. Persist cancellation in SQLite
  registry.cancel(sessionId);

  // 4. Call cancelCallback best-effort (sets responder.cancelled, etc.)
  try {
    await liveEntry.cancelCallback();
  } catch (error) {
    logger.error('cancel_task: cancelCallback failed', { sessionId, error });
  }

  return {
    status: 'cancelled',
    promptPreview: entry.prompt_preview,
    runningFor: formatRunningFor(entry.started_at),
    wasScheduled: entry.origin === 'scheduled',
    schedulerJobId: entry.scheduler_job_id ?? undefined,
    message: `Task cancelled successfully.`,
  };
}
