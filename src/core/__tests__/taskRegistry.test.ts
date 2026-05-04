import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildActiveTaskResponse,
  buildRecentTaskResponse,
  formatRunningFor,
  TaskRegistry,
  truncatePromptPreview,
} from '../taskRegistry.js';
import type {
  LiveTaskEntry,
  TaskRegistryEntry,
} from '../taskRegistry.types.js';

const TEST_DB = '/tmp/bot-toolkit-test-task-registry.sqlite';

describe('truncatePromptPreview', () => {
  it('should return short text unchanged', () => {
    expect(truncatePromptPreview('hello world')).toBe('hello world');
  });

  it('should truncate at word boundary with ellipsis', () => {
    const long =
      'The quick brown fox jumps over the lazy dog and keeps running forever';
    const result = truncatePromptPreview(long, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toMatch(/\.\.\.$/);
    // Should break at a space — no partial words before ellipsis
    expect(result).toBe('The quick brown fox jumps...');
  });

  it('should handle exact boundary text', () => {
    const exact = 'abcde';
    expect(truncatePromptPreview(exact, 5)).toBe('abcde');
  });

  it('should handle empty string', () => {
    expect(truncatePromptPreview('')).toBe('');
  });

  it('should handle single long word', () => {
    const word = 'superlongwordwithnobreaks';
    const result = truncatePromptPreview(word, 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toMatch(/\.\.\.$/);
  });
});

describe('formatRunningFor', () => {
  it('should format seconds', () => {
    const now = Date.now();
    expect(formatRunningFor(now - 5_000)).toBe('5s');
  });

  it('should format minutes and seconds', () => {
    const now = Date.now();
    expect(formatRunningFor(now - 125_000)).toBe('2m 5s');
  });

  it('should format hours, minutes, and seconds', () => {
    const now = Date.now();
    expect(formatRunningFor(now - 3_725_000)).toBe('1h 2m 5s');
  });

  it('should handle zero duration', () => {
    expect(formatRunningFor(Date.now())).toBe('0s');
  });
});

describe('buildActiveTaskResponse', () => {
  it('should format active tasks with count', () => {
    const rows: TaskRegistryEntry[] = [
      {
        session_id: 'sess_1',
        instance_id: 'inst_1',
        room_id: '!room1',
        thread_id: '$thread1',
        platform: 'matrix',
        origin: 'user',
        scheduler_job_id: null,
        prompt_preview: 'hello',
        status: 'active',
        started_at: Date.now() - 60_000,
        last_heartbeat_at: null,
        completed_at: null,
        final_input_tokens: null,
        final_output_tokens: null,
        final_cost_usd: null,
        had_visible_output: 0,
      },
    ];

    const response = buildActiveTaskResponse(rows);
    expect(response.count).toBe(1);
    expect(response.tasks).toHaveLength(1);
    expect(response.tasks[0].id).toBe('sess_1');
    expect(response.tasks[0].room).toBe('!room1');
    expect(response.tasks[0].thread_id).toBe('$thread1');
    expect(response.tasks[0].origin).toBe('user');
    expect(response.tasks[0].prompt_preview).toBe('hello');
    expect(response.tasks[0].running_for).toMatch(/\d+/);
  });

  it('should return empty response for no tasks', () => {
    const response = buildActiveTaskResponse([]);
    expect(response.count).toBe(0);
    expect(response.tasks).toEqual([]);
  });
});

describe('buildRecentTaskResponse', () => {
  it('should format recent tasks with stats', () => {
    const rows: TaskRegistryEntry[] = [
      {
        session_id: 'sess_1',
        instance_id: 'inst_1',
        room_id: '!room1',
        thread_id: null,
        platform: 'matrix',
        origin: 'scheduled',
        scheduler_job_id: 'job_1',
        prompt_preview: 'daily report',
        status: 'completed',
        started_at: Date.now() - 120_000,
        last_heartbeat_at: null,
        completed_at: Date.now() - 60_000,
        final_input_tokens: 1000,
        final_output_tokens: 500,
        final_cost_usd: 0.05,
        had_visible_output: 1,
      },
    ];

    const response = buildRecentTaskResponse(rows);
    expect(response.count).toBe(1);
    expect(response.tasks[0].status).toBe('completed');
    expect(response.tasks[0].input_tokens).toBe(1000);
    expect(response.tasks[0].output_tokens).toBe(500);
    expect(response.tasks[0].cost_usd).toBe(0.05);
    expect(response.tasks[0].duration).toMatch(/\d+/);
  });
});

describe('TaskRegistry', () => {
  let sqliteDb: Database.Database;
  let registry: TaskRegistry;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    sqliteDb = new Database(TEST_DB);
    registry = new TaskRegistry(sqliteDb);
  });

  afterEach(() => {
    sqliteDb.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  function makeLiveEntry(overrides?: Partial<LiveTaskEntry>): LiveTaskEntry {
    return {
      abortController: new AbortController(),
      cancelCallback: async () => {},
      sessionPromise: Promise.resolve(),
      ...overrides,
    };
  }

  describe('schema creation', () => {
    it('should create task_registry table', () => {
      const result = sqliteDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='task_registry'",
        )
        .get() as { name: string } | undefined;
      expect(result?.name).toBe('task_registry');
    });

    it('should create indexes', () => {
      const indexes = sqliteDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_task_registry%'",
        )
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_task_registry_status');
      expect(names).toContain('idx_task_registry_completed');
      expect(names).toContain('idx_task_registry_instance');
    });
  });

  describe('register + getActive round-trip', () => {
    it('should register a task and retrieve it as active', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: '$thread1',
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'what is the meaning of life',
        },
        makeLiveEntry(),
      );

      const active = registry.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].session_id).toBe('sess_1');
      expect(active[0].room_id).toBe('!room1');
      expect(active[0].thread_id).toBe('$thread1');
      expect(active[0].platform).toBe('matrix');
      expect(active[0].origin).toBe('user');
      expect(active[0].status).toBe('active');
      expect(active[0].started_at).toBeGreaterThan(0);
    });

    it('should only return tasks for current instance', () => {
      // Register a task in current registry
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      // Insert a task with different instance_id directly
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, platform, origin, prompt_preview, status, started_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_other',
          'different-instance',
          '!room2',
          'matrix',
          'user',
          'other task',
          'active',
          Date.now(),
          0,
        );

      const active = registry.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].session_id).toBe('sess_1');
    });
  });

  describe('PK collision', () => {
    it('should throw on duplicate active session_id', () => {
      registry.register(
        {
          sessionId: 'sess_dup',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'first',
        },
        makeLiveEntry(),
      );

      expect(() =>
        registry.register(
          {
            sessionId: 'sess_dup',
            roomId: '!room1',
            threadId: null,
            platform: 'matrix',
            origin: 'user',
            promptPreview: 'second',
          },
          makeLiveEntry(),
        ),
      ).toThrow();
    });
  });

  describe('session resume (re-register after terminal state)', () => {
    it('should allow re-registering a completed session', () => {
      registry.register(
        {
          sessionId: 'sess_resume',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'first message',
        },
        makeLiveEntry(),
      );
      registry.complete('sess_resume', {
        contextTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        durationMs: 10000,
        compactionCount: 0,
      });

      // Re-register the same session (simulates resume after container restart)
      registry.register(
        {
          sessionId: 'sess_resume',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'second message',
        },
        makeLiveEntry(),
      );

      const entry = registry.getEntry('sess_resume');
      expect(entry!.status).toBe('active');
      expect(entry!.prompt_preview).toBe('second message');
      expect(entry!.instance_id).toBe(registry.currentInstanceId);
      // Previous stats should be cleared
      expect(entry!.final_input_tokens).toBeNull();
      expect(entry!.final_output_tokens).toBeNull();
      expect(entry!.final_cost_usd).toBeNull();
      expect(entry!.completed_at).toBeNull();
      expect(entry!.had_visible_output).toBe(0);
    });

    it('should allow re-registering an errored session', () => {
      registry.register(
        {
          sessionId: 'sess_errored',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'first attempt',
        },
        makeLiveEntry(),
      );
      registry.markError('sess_errored');

      registry.register(
        {
          sessionId: 'sess_errored',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'retry attempt',
        },
        makeLiveEntry(),
      );

      const entry = registry.getEntry('sess_errored');
      expect(entry!.status).toBe('active');
      expect(entry!.prompt_preview).toBe('retry attempt');
    });

    it('should allow re-registering a cancelled session', () => {
      registry.register(
        {
          sessionId: 'sess_cancelled',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'cancelled task',
        },
        makeLiveEntry(),
      );
      registry.cancel('sess_cancelled');

      registry.register(
        {
          sessionId: 'sess_cancelled',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'resumed task',
        },
        makeLiveEntry(),
      );

      const entry = registry.getEntry('sess_cancelled');
      expect(entry!.status).toBe('active');
    });

    it('should allow re-registering an interrupted session', () => {
      // Simulate an interrupted session from a different instance
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, platform, origin, prompt_preview, status, started_at, completed_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_interrupted',
          'old-instance',
          '!room1',
          'slack',
          'user',
          'interrupted task',
          'interrupted',
          Date.now() - 60_000,
          Date.now() - 30_000,
          1,
        );

      registry.register(
        {
          sessionId: 'sess_interrupted',
          roomId: '!room1',
          threadId: null,
          platform: 'slack',
          origin: 'user',
          promptPreview: 'resumed after interrupt',
        },
        makeLiveEntry(),
      );

      const entry = registry.getEntry('sess_interrupted');
      expect(entry!.status).toBe('active');
      expect(entry!.instance_id).toBe(registry.currentInstanceId);
    });
  });

  describe('complete', () => {
    it('should mark task as completed with stats', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.complete('sess_1', {
        contextTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        durationMs: 10000,
        compactionCount: 0,
      });

      const entry = registry.getEntry('sess_1');
      expect(entry).not.toBeNull();
      expect(entry!.status).toBe('completed');
      expect(entry!.completed_at).toBeGreaterThan(0);
      expect(entry!.final_input_tokens).toBe(1000);
      expect(entry!.final_output_tokens).toBe(500);
      expect(entry!.final_cost_usd).toBe(0.05);
    });
  });

  describe('markError', () => {
    it('should mark task as errored', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.markError('sess_1');

      const entry = registry.getEntry('sess_1');
      expect(entry!.status).toBe('error');
      expect(entry!.completed_at).toBeGreaterThan(0);
    });

    it('should accept optional stats', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.markError('sess_1', {
        contextTokens: 500,
        outputTokens: 100,
        costUsd: 0.01,
        durationMs: 5000,
        compactionCount: 0,
      });

      const entry = registry.getEntry('sess_1');
      expect(entry!.status).toBe('error');
      expect(entry!.final_input_tokens).toBe(500);
    });
  });

  describe('cancel', () => {
    it('should mark task as cancelled', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.cancel('sess_1');

      const entry = registry.getEntry('sess_1');
      expect(entry!.status).toBe('cancelled');
      expect(entry!.completed_at).toBeGreaterThan(0);
    });
  });

  describe('heartbeat throttling', () => {
    it('should update heartbeat on first call', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.heartbeat('sess_1');

      const entry = registry.getEntry('sess_1');
      expect(entry!.last_heartbeat_at).toBeGreaterThan(0);
    });

    it('should throttle heartbeats within 10s window', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.heartbeat('sess_1');
      const entry1 = registry.getEntry('sess_1');
      const firstHeartbeat = entry1!.last_heartbeat_at;

      // Immediate second call should be throttled (same timestamp)
      registry.heartbeat('sess_1');
      const entry2 = registry.getEntry('sess_1');
      expect(entry2!.last_heartbeat_at).toBe(firstHeartbeat);
    });
  });

  describe('setHadVisibleOutput', () => {
    it('should set had_visible_output to 1', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      expect(registry.getEntry('sess_1')!.had_visible_output).toBe(0);

      registry.setHadVisibleOutput('sess_1');

      expect(registry.getEntry('sess_1')!.had_visible_output).toBe(1);
    });
  });

  describe('getRecent', () => {
    it('should return terminal tasks within time window', () => {
      // Register and complete a task
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );
      registry.complete('sess_1', {
        contextTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        durationMs: 10000,
        compactionCount: 0,
      });

      const recent = registry.getRecent(24);
      expect(recent).toHaveLength(1);
      expect(recent[0].session_id).toBe('sess_1');
      expect(recent[0].status).toBe('completed');
    });

    it('should not return active tasks', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      const recent = registry.getRecent(24);
      expect(recent).toHaveLength(0);
    });
  });

  describe('getLiveEntry / removeLiveEntry', () => {
    it('should get live entry from Map', () => {
      const liveEntry = makeLiveEntry();
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        liveEntry,
      );

      const retrieved = registry.getLiveEntry('sess_1');
      expect(retrieved).toBe(liveEntry);
    });

    it('should return undefined for missing entry', () => {
      expect(registry.getLiveEntry('nonexistent')).toBeUndefined();
    });

    it('should remove live entry from Map', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.removeLiveEntry('sess_1');
      expect(registry.getLiveEntry('sess_1')).toBeUndefined();
    });
  });

  describe('abortAll', () => {
    it('should abort all controllers and await promises', async () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      let resolved1 = false;
      let resolved2 = false;

      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test 1',
        },
        {
          abortController: controller1,
          cancelCallback: async () => {},
          sessionPromise: new Promise<void>((resolve) => {
            setTimeout(() => {
              resolved1 = true;
              resolve();
            }, 10);
          }),
        },
      );

      registry.register(
        {
          sessionId: 'sess_2',
          roomId: '!room2',
          threadId: null,
          platform: 'slack',
          origin: 'scheduled',
          promptPreview: 'test 2',
        },
        {
          abortController: controller2,
          cancelCallback: async () => {},
          sessionPromise: new Promise<void>((resolve) => {
            setTimeout(() => {
              resolved2 = true;
              resolve();
            }, 10);
          }),
        },
      );

      await registry.abortAll();

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
      expect(resolved1).toBe(true);
      expect(resolved2).toBe(true);
    });
  });

  describe('markInterruptedShutdown', () => {
    it('should mark all active tasks for this instance as interrupted-shutdown', () => {
      registry.register(
        {
          sessionId: 'sess_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      registry.markInterruptedShutdown();

      const entry = registry.getEntry('sess_1');
      expect(entry!.status).toBe('interrupted-shutdown');
    });

    it('should not affect tasks from different instances', () => {
      // Insert foreign-instance task directly
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, platform, origin, prompt_preview, status, started_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_other',
          'different-instance',
          '!room2',
          'matrix',
          'user',
          'other task',
          'active',
          Date.now(),
          0,
        );

      registry.markInterruptedShutdown();

      const entry = sqliteDb
        .prepare('SELECT status FROM task_registry WHERE session_id = ?')
        .get('sess_other') as { status: string };
      expect(entry.status).toBe('active');
    });
  });

  describe('recoverInterruptedTasks', () => {
    it('should detect stale active rows from different instance', async () => {
      // Insert a stale task from a different instance
      const staleTime = Date.now() - 60_000;
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, thread_id, platform, origin, prompt_preview, status, started_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_stale',
          'old-instance',
          '!room1',
          '$thread1',
          'matrix',
          'user',
          'stale task',
          'active',
          staleTime,
          1,
        );

      const sendRecoveryNotice = vi.fn().mockResolvedValue(undefined);
      const adapters = new Map([['matrix', { sendRecoveryNotice }]]);

      // Override delay for test speed
      await registry.recoverInterruptedTasks(adapters, 0);

      const entry = sqliteDb
        .prepare('SELECT status FROM task_registry WHERE session_id = ?')
        .get('sess_stale') as { status: string };
      expect(entry.status).toBe('interrupted');
      expect(sendRecoveryNotice).toHaveBeenCalledWith(
        '!room1',
        '$thread1',
        expect.stringContaining('restart'),
      );
    });

    it('should not recover tasks from same instance', async () => {
      // Register a task (current instance) then mark it as stale manually
      registry.register(
        {
          sessionId: 'sess_own',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'test',
        },
        makeLiveEntry(),
      );

      const sendRecoveryNotice = vi.fn().mockResolvedValue(undefined);
      const adapters = new Map([['matrix', { sendRecoveryNotice }]]);

      await registry.recoverInterruptedTasks(adapters, 0);

      // Should still be active — not touched by recovery
      const entry = registry.getEntry('sess_own');
      expect(entry!.status).toBe('active');
      expect(sendRecoveryNotice).not.toHaveBeenCalled();
    });

    it('should skip notifications for tasks with no visible output', async () => {
      const staleTime = Date.now() - 60_000;
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, thread_id, platform, origin, prompt_preview, status, started_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_stale',
          'old-instance',
          '!room1',
          '$thread1',
          'matrix',
          'user',
          'stale task',
          'active',
          staleTime,
          0, // no visible output
        );

      const sendRecoveryNotice = vi.fn().mockResolvedValue(undefined);
      const adapters = new Map([['matrix', { sendRecoveryNotice }]]);

      await registry.recoverInterruptedTasks(adapters, 0);

      // Status should still be updated
      const entry = sqliteDb
        .prepare('SELECT status FROM task_registry WHERE session_id = ?')
        .get('sess_stale') as { status: string };
      expect(entry.status).toBe('interrupted');
      // But no notification sent
      expect(sendRecoveryNotice).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should delete terminal rows older than specified days', () => {
      const oldTime = Date.now() - 15 * 24 * 60 * 60 * 1000; // 15 days ago
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, platform, origin, prompt_preview, status, started_at, completed_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_old',
          'inst',
          '!room1',
          'matrix',
          'user',
          'old task',
          'completed',
          oldTime,
          oldTime,
          0,
        );

      registry.cleanup(14);

      const entry = registry.getEntry('sess_old');
      expect(entry).toBeNull();
    });

    it('should not delete recent terminal rows', () => {
      registry.register(
        {
          sessionId: 'sess_recent',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'recent task',
        },
        makeLiveEntry(),
      );
      registry.complete('sess_recent', {
        contextTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        durationMs: 1000,
        compactionCount: 0,
      });

      registry.cleanup(14);

      const entry = registry.getEntry('sess_recent');
      expect(entry).not.toBeNull();
    });

    it('should not delete active rows regardless of age', () => {
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      sqliteDb
        .prepare(
          `INSERT INTO task_registry (session_id, instance_id, room_id, platform, origin, prompt_preview, status, started_at, had_visible_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sess_old_active',
          'inst',
          '!room1',
          'matrix',
          'user',
          'old active task',
          'active',
          oldTime,
          0,
        );

      registry.cleanup(14);

      const entry = registry.getEntry('sess_old_active');
      expect(entry).not.toBeNull();
    });
  });

  describe('getEntry', () => {
    it('should return null for non-existent session', () => {
      expect(registry.getEntry('nonexistent')).toBeNull();
    });
  });

  describe('state transition guards', () => {
    it('complete() after cancel() should be a no-op', () => {
      registry.register(
        {
          sessionId: 'sess_race_1',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'race test',
        },
        makeLiveEntry(),
      );

      registry.cancel('sess_race_1');
      registry.complete('sess_race_1', {
        contextTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        durationMs: 5000,
        compactionCount: 0,
      });

      const entry = registry.getEntry('sess_race_1');
      expect(entry!.status).toBe('cancelled');
      expect(entry!.final_cost_usd).toBeNull();
    });

    it('cancel() after complete() should be a no-op', () => {
      registry.register(
        {
          sessionId: 'sess_race_2',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'race test',
        },
        makeLiveEntry(),
      );

      registry.complete('sess_race_2', {
        contextTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        durationMs: 5000,
        compactionCount: 0,
      });
      registry.cancel('sess_race_2');

      const entry = registry.getEntry('sess_race_2');
      expect(entry!.status).toBe('completed');
      expect(entry!.final_cost_usd).toBe(0.05);
    });

    it('markError() after cancel() should be a no-op', () => {
      registry.register(
        {
          sessionId: 'sess_race_3',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'race test',
        },
        makeLiveEntry(),
      );

      registry.cancel('sess_race_3');
      registry.markError('sess_race_3');

      const entry = registry.getEntry('sess_race_3');
      expect(entry!.status).toBe('cancelled');
    });

    it('complete() after markError() should be a no-op', () => {
      registry.register(
        {
          sessionId: 'sess_race_4',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'user',
          promptPreview: 'race test',
        },
        makeLiveEntry(),
      );

      registry.markError('sess_race_4');
      registry.complete('sess_race_4', {
        contextTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        durationMs: 5000,
        compactionCount: 0,
      });

      const entry = registry.getEntry('sess_race_4');
      expect(entry!.status).toBe('error');
      expect(entry!.final_cost_usd).toBeNull();
    });
  });

  describe('scheduler_job_id', () => {
    it('should store scheduler_job_id for scheduled tasks', () => {
      registry.register(
        {
          sessionId: 'sess_scheduled',
          roomId: '!room1',
          threadId: null,
          platform: 'matrix',
          origin: 'scheduled',
          schedulerJobId: 'job_abc',
          promptPreview: 'scheduled task',
        },
        makeLiveEntry(),
      );

      const entry = registry.getEntry('sess_scheduled');
      expect(entry!.scheduler_job_id).toBe('job_abc');
      expect(entry!.origin).toBe('scheduled');
    });
  });
});
