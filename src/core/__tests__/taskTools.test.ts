// packages/bot-toolkit/src/core/__tests__/taskTools.test.ts

import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRegistry } from '../taskRegistry.js';
import type {
  ITaskRegistry,
  LiveTaskEntry,
  TaskRegistryEntry,
} from '../taskRegistry.types.js';
import { createTaskTools } from '../taskTools.js';

// ── Helpers ────────────────────────────────────────────────────

function makeMockRegistry(): ITaskRegistry & {
  [K in keyof ITaskRegistry]: ReturnType<typeof vi.fn>;
} {
  return {
    register: vi.fn(),
    complete: vi.fn(),
    markError: vi.fn(),
    cancel: vi.fn(),
    heartbeat: vi.fn(),
    setHadVisibleOutput: vi.fn(),
    getActive: vi.fn().mockReturnValue([]),
    getRecent: vi.fn().mockReturnValue([]),
    getEntry: vi.fn().mockReturnValue(null),
    getLiveEntry: vi.fn().mockReturnValue(undefined),
    removeLiveEntry: vi.fn(),
    abortAll: vi.fn().mockResolvedValue(undefined),
    markInterruptedShutdown: vi.fn(),
    recoverInterruptedTasks: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  };
}

function makeActiveRow(
  overrides: Partial<TaskRegistryEntry> = {},
): TaskRegistryEntry {
  return {
    session_id: 'sess-active-1',
    instance_id: 'inst-1',
    room_id: 'matrix:!room:server.com',
    thread_id: '$thread1',
    platform: 'matrix',
    origin: 'user',
    scheduler_job_id: null,
    prompt_preview: 'What is the weather?',
    status: 'active',
    started_at: Date.now() - 120_000, // 2 min ago
    last_heartbeat_at: Date.now() - 10_000,
    completed_at: null,
    final_input_tokens: null,
    final_output_tokens: null,
    final_cost_usd: null,
    had_visible_output: 1,
    ...overrides,
  };
}

function makeCompletedRow(
  overrides: Partial<TaskRegistryEntry> = {},
): TaskRegistryEntry {
  const startedAt = Date.now() - 300_000; // 5 min ago
  return {
    session_id: 'sess-done-1',
    instance_id: 'inst-1',
    room_id: 'slack:C12345',
    thread_id: null,
    platform: 'slack',
    origin: 'scheduled',
    scheduler_job_id: 'job-abc',
    prompt_preview: 'Daily report generation',
    status: 'completed',
    started_at: startedAt,
    last_heartbeat_at: startedAt + 200_000,
    completed_at: startedAt + 240_000,
    final_input_tokens: 5000,
    final_output_tokens: 2000,
    final_cost_usd: 0.15,
    had_visible_output: 1,
    ...overrides,
  };
}

function makeLiveEntry(overrides: Partial<LiveTaskEntry> = {}): LiveTaskEntry {
  return {
    abortController: new AbortController(),
    cancelCallback: vi.fn().mockResolvedValue(undefined),
    sessionPromise: Promise.resolve(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('createTaskTools', () => {
  let registry: ReturnType<typeof makeMockRegistry>;
  let tools: ReturnType<typeof createTaskTools>;

  beforeEach(() => {
    registry = makeMockRegistry();
    tools = createTaskTools(registry, { cancelTimeoutMs: 50 });
  });

  it('should return three tool definitions', () => {
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_active_tasks');
    expect(names).toContain('list_recent_tasks');
    expect(names).toContain('cancel_task');
  });

  describe('list_active_tasks', () => {
    it('should return formatted active tasks', async () => {
      const row = makeActiveRow();
      registry.getActive.mockReturnValue([row]);

      const tool = tools.find((t) => t.name === 'list_active_tasks');
      const result = await tool!.handler({}, undefined);

      expect(registry.getActive).toHaveBeenCalled();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.tasks).toHaveLength(1);
      expect(parsed.tasks[0].id).toBe('sess-active-1');
      expect(parsed.tasks[0].room).toBe('matrix:!room:server.com');
      expect(parsed.tasks[0].prompt_preview).toBe('What is the weather?');
    });

    it('should return empty list when no active tasks', async () => {
      registry.getActive.mockReturnValue([]);

      const tool = tools.find((t) => t.name === 'list_active_tasks');
      const result = await tool!.handler({}, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
      expect(parsed.tasks).toEqual([]);
    });
  });

  describe('list_recent_tasks', () => {
    it('should return formatted recent tasks with default hours', async () => {
      const row = makeCompletedRow();
      registry.getRecent.mockReturnValue([row]);

      const tool = tools.find((t) => t.name === 'list_recent_tasks');
      const result = await tool!.handler({}, undefined);

      expect(registry.getRecent).toHaveBeenCalledWith(24);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.tasks[0].id).toBe('sess-done-1');
      expect(parsed.tasks[0].status).toBe('completed');
      expect(parsed.tasks[0].cost_usd).toBe(0.15);
    });

    it('should accept custom hours parameter', async () => {
      registry.getRecent.mockReturnValue([]);

      const tool = tools.find((t) => t.name === 'list_recent_tasks');
      await tool!.handler({ hours: 48 }, undefined);

      expect(registry.getRecent).toHaveBeenCalledWith(48);
    });

    it('should cap hours at 168 (1 week)', async () => {
      registry.getRecent.mockReturnValue([]);

      const tool = tools.find((t) => t.name === 'list_recent_tasks');
      await tool!.handler({ hours: 500 }, undefined);

      expect(registry.getRecent).toHaveBeenCalledWith(168);
    });
  });

  describe('cancel_task', () => {
    it('should cancel an active task (happy path)', async () => {
      const row = makeActiveRow({ session_id: 'sess-cancel-1' });
      const liveEntry = makeLiveEntry();
      registry.getEntry.mockReturnValue(row);
      registry.getLiveEntry.mockReturnValue(liveEntry);

      const tool = tools.find((t) => t.name === 'cancel_task');
      const result = await tool!.handler(
        { session_id: 'sess-cancel-1' },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('cancelled');
      expect(parsed.promptPreview).toBe('What is the weather?');
      expect(parsed.wasScheduled).toBe(false);

      // Verify: abort called, registry.cancel called, cancelCallback called
      expect(liveEntry.abortController.signal.aborted).toBe(true);
      expect(registry.cancel).toHaveBeenCalledWith('sess-cancel-1');
      expect(liveEntry.cancelCallback).toHaveBeenCalled();
    });

    it('should return already_completed for non-active tasks', async () => {
      const row = makeCompletedRow({ session_id: 'sess-done' });
      registry.getEntry.mockReturnValue(row);
      registry.getLiveEntry.mockReturnValue(undefined);

      const tool = tools.find((t) => t.name === 'cancel_task');
      const result = await tool!.handler(
        { session_id: 'sess-done' },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('already_completed');
      expect(registry.cancel).not.toHaveBeenCalled();
    });

    it('should return not_found when session does not exist', async () => {
      registry.getEntry.mockReturnValue(null);
      registry.getLiveEntry.mockReturnValue(undefined);

      const tool = tools.find((t) => t.name === 'cancel_task');
      const result = await tool!.handler(
        { session_id: 'nonexistent' },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('not_found');
      expect(registry.cancel).not.toHaveBeenCalled();
    });

    it('should return starting_up when active in SQLite but not in live map', async () => {
      const row = makeActiveRow({ session_id: 'sess-starting' });
      registry.getEntry.mockReturnValue(row);
      registry.getLiveEntry.mockReturnValue(undefined);

      const tool = tools.find((t) => t.name === 'cancel_task');
      const result = await tool!.handler(
        { session_id: 'sess-starting' },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('starting_up');
      expect(registry.cancel).not.toHaveBeenCalled();
    });

    it('should include scheduler info for scheduled tasks', async () => {
      const row = makeActiveRow({
        session_id: 'sess-sched',
        origin: 'scheduled',
        scheduler_job_id: 'job-xyz',
      });
      const liveEntry = makeLiveEntry();
      registry.getEntry.mockReturnValue(row);
      registry.getLiveEntry.mockReturnValue(liveEntry);

      const tool = tools.find((t) => t.name === 'cancel_task');
      const result = await tool!.handler(
        { session_id: 'sess-sched' },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('cancelled');
      expect(parsed.wasScheduled).toBe(true);
      expect(parsed.schedulerJobId).toBe('job-xyz');
    });

    it('should handle sessionPromise timeout gracefully', async () => {
      const row = makeActiveRow({ session_id: 'sess-slow' });
      // Create a promise that never resolves
      const neverResolves = new Promise<void>(() => {});
      const liveEntry = makeLiveEntry({ sessionPromise: neverResolves });
      registry.getEntry.mockReturnValue(row);
      registry.getLiveEntry.mockReturnValue(liveEntry);

      const tool = tools.find((t) => t.name === 'cancel_task');
      const result = await tool!.handler(
        { session_id: 'sess-slow' },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      // Should still return cancelled even if promise doesn't resolve
      expect(parsed.status).toBe('cancelled');
      expect(registry.cancel).toHaveBeenCalledWith('sess-slow');
    });

    it('should handle cancelCallback failure gracefully', async () => {
      const row = makeActiveRow({ session_id: 'sess-err' });
      const liveEntry = makeLiveEntry({
        cancelCallback: vi.fn().mockRejectedValue(new Error('callback failed')),
      });
      registry.getEntry.mockReturnValue(row);
      registry.getLiveEntry.mockReturnValue(liveEntry);

      const tool = tools.find((t) => t.name === 'cancel_task');
      // Should not throw even if cancelCallback fails
      const result = await tool!.handler({ session_id: 'sess-err' }, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('cancelled');
      // cancel should still be called (it runs before cancelCallback)
      expect(registry.cancel).toHaveBeenCalledWith('sess-err');
    });
  });
});

// ── Integration tests with real SQLite ──────────────────────────

const TEST_DB = '/tmp/bot-toolkit-test-task-tools-integration.sqlite';

describe('cancel_task integration (real SQLite)', () => {
  let sqliteDb: Database.Database;
  let registry: TaskRegistry;
  let tools: ReturnType<typeof createTaskTools>;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    sqliteDb = new Database(TEST_DB);
    registry = new TaskRegistry(sqliteDb);
    tools = createTaskTools(registry, { cancelTimeoutMs: 50 });
  });

  afterEach(() => {
    sqliteDb.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should cancel an active task end-to-end', async () => {
    const controller = new AbortController();
    let resolveSession: () => void;
    const sessionPromise = new Promise<void>((resolve) => {
      resolveSession = resolve;
    });

    // Resolve the session promise when abort fires (simulates SDK behavior)
    controller.signal.addEventListener('abort', () => resolveSession());

    registry.register(
      {
        sessionId: 'sess-int-1',
        roomId: '!room1',
        threadId: null,
        platform: 'matrix',
        origin: 'user',
        promptPreview: 'integration test prompt',
      },
      {
        abortController: controller,
        cancelCallback: async () => {},
        sessionPromise,
      },
    );

    expect(registry.getEntry('sess-int-1')!.status).toBe('active');

    const tool = tools.find((t) => t.name === 'cancel_task');
    const result = await tool!.handler({ session_id: 'sess-int-1' }, undefined);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('cancelled');

    // Verify DB state
    const entry = registry.getEntry('sess-int-1');
    expect(entry!.status).toBe('cancelled');
    expect(entry!.completed_at).toBeGreaterThan(0);
  });

  it('cancel should be safe when task completes during the abort window (race)', async () => {
    const controller = new AbortController();

    // When abort fires, simulate the orchestrator completing before the
    // session promise resolves — this is the exact race condition.
    const sessionPromise = new Promise<void>((resolve) => {
      controller.signal.addEventListener('abort', () => {
        registry.complete('sess-race-int', {
          contextTokens: 1000,
          outputTokens: 500,
          costUsd: 0.05,
          durationMs: 5000,
          compactionCount: 0,
        });
        resolve();
      });
    });

    registry.register(
      {
        sessionId: 'sess-race-int',
        roomId: '!room1',
        threadId: null,
        platform: 'matrix',
        origin: 'user',
        promptPreview: 'race condition test',
      },
      {
        abortController: controller,
        cancelCallback: async () => {},
        sessionPromise,
      },
    );

    // cancel_task: reads active, aborts, awaits (complete runs), then cancel() is a no-op
    const tool = tools.find((t) => t.name === 'cancel_task');
    const result = await tool!.handler(
      { session_id: 'sess-race-int' },
      undefined,
    );

    // The tool reports cancelled (it saw active at the top, cancel flow ran)
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('cancelled');

    // But the DB correctly preserves 'completed' — the status guard prevented clobbering
    const entry = registry.getEntry('sess-race-int');
    expect(entry!.status).toBe('completed');
    expect(entry!.final_cost_usd).toBe(0.05);
  });

  it('complete should be safe when task was cancelled during session (race)', async () => {
    const controller = new AbortController();
    const sessionPromise = Promise.resolve();

    registry.register(
      {
        sessionId: 'sess-race-int-2',
        roomId: '!room1',
        threadId: null,
        platform: 'matrix',
        origin: 'user',
        promptPreview: 'reverse race test',
      },
      {
        abortController: controller,
        cancelCallback: async () => {},
        sessionPromise,
      },
    );

    // cancel_task writes cancelled first
    registry.cancel('sess-race-int-2');

    // Orchestrator then tries to complete — should be no-op
    registry.complete('sess-race-int-2', {
      contextTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
      durationMs: 5000,
      compactionCount: 0,
    });

    const entry = registry.getEntry('sess-race-int-2');
    expect(entry!.status).toBe('cancelled');
    expect(entry!.final_cost_usd).toBeNull();
  });
});
