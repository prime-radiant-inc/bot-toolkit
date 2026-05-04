// src/core/taskRegistry.ts

import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { Logger } from '../utils/logger.js';
import type {
  ActiveTaskInfo,
  ActiveTaskResponse,
  ITaskRegistry,
  LiveTaskEntry,
  RecentTaskInfo,
  RecentTaskResponse,
  TaskRegistration,
  TaskRegistryEntry,
} from './taskRegistry.types.js';
import type { SessionStats } from './types.js';

const logger = new Logger('TaskRegistry');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS task_registry (
  session_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  thread_id TEXT,
  platform TEXT NOT NULL CHECK(platform IN ('slack', 'native', 'email')),
  origin TEXT NOT NULL CHECK(origin IN ('user', 'scheduled')),
  scheduler_job_id TEXT,
  prompt_preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'completed', 'cancelled', 'interrupted', 'interrupted-shutdown', 'error')),
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER,
  completed_at INTEGER,
  final_input_tokens INTEGER,
  final_output_tokens INTEGER,
  final_cost_usd REAL,
  had_visible_output INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_task_registry_status ON task_registry(status);
CREATE INDEX IF NOT EXISTS idx_task_registry_completed ON task_registry(status, completed_at);
CREATE INDEX IF NOT EXISTS idx_task_registry_instance ON task_registry(instance_id);
`;

const HEARTBEAT_THROTTLE_MS = 10_000;

// ── Pure functions ──────────────────────────────────────────────

/**
 * Truncate a prompt preview at a word boundary, appending ellipsis.
 */
export function truncatePromptPreview(
  text: string,
  maxLen: number = 120,
): string {
  if (text.length <= maxLen) return text;

  const truncated = text.slice(0, maxLen - 3);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    return `${truncated.slice(0, lastSpace)}...`;
  }
  return `${truncated}...`;
}

/**
 * Format a duration from a start timestamp to now as human-readable.
 */
export function formatRunningFor(startedAt: number): string {
  const elapsed = Math.max(0, Date.now() - startedAt);
  const totalSeconds = Math.floor(elapsed / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a duration between two timestamps as human-readable.
 */
function formatDuration(startedAt: number, endedAt: number): string {
  const elapsed = Math.max(0, endedAt - startedAt);
  const totalSeconds = Math.floor(elapsed / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Build the response for list_active_tasks tool.
 */
export function buildActiveTaskResponse(
  rows: TaskRegistryEntry[],
): ActiveTaskResponse {
  const tasks: ActiveTaskInfo[] = rows.map((row) => ({
    id: row.session_id,
    room: row.room_id,
    thread_id: row.thread_id,
    origin: row.origin,
    prompt_preview: row.prompt_preview,
    started_at: new Date(row.started_at).toISOString(),
    running_for: formatRunningFor(row.started_at),
    scheduler_job_id: row.scheduler_job_id,
  }));

  return { tasks, count: tasks.length };
}

/**
 * Build the response for list_recent_tasks tool.
 */
export function buildRecentTaskResponse(
  rows: TaskRegistryEntry[],
): RecentTaskResponse {
  const tasks: RecentTaskInfo[] = rows.map((row) => ({
    id: row.session_id,
    room: row.room_id,
    origin: row.origin,
    prompt_preview: row.prompt_preview,
    status: row.status,
    started_at: new Date(row.started_at).toISOString(),
    completed_at: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
    duration: formatDuration(
      row.started_at,
      row.completed_at ?? row.started_at,
    ),
    input_tokens: row.final_input_tokens,
    output_tokens: row.final_output_tokens,
    cost_usd: row.final_cost_usd,
  }));

  return { tasks, count: tasks.length };
}

// ── TaskRegistry class ──────────────────────────────────────────

export class TaskRegistry implements ITaskRegistry {
  private db: Database.Database;
  private instanceId: string;
  private liveEntries = new Map<string, LiveTaskEntry>();
  private lastHeartbeatAt = new Map<string, number>();

  /** The unique instance ID for this process. */
  get currentInstanceId(): string {
    return this.instanceId;
  }

  constructor(db: Database.Database) {
    this.db = db;
    this.instanceId = crypto.randomUUID();
    this.db.exec(SCHEMA);
    this.migrateCheckConstraints();
    logger.info('TaskRegistry initialized', { instanceId: this.instanceId });
  }

  /**
   * Rebuild table if the platform CHECK constraint is outdated.
   * Handles adding 'email' and renaming 'cli' to 'native'.
   * SQLite can't ALTER CHECK constraints, so we rebuild via rename+copy.
   */
  private migrateCheckConstraints(): void {
    const tableInfo = this.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='task_registry'",
      )
      .get() as { sql: string } | undefined;

    if (!tableInfo) return;

    const needsEmailMigration = !tableInfo.sql.includes("'email'");
    const needsNativeMigration = tableInfo.sql.includes("'cli'");

    if (!needsEmailMigration && !needsNativeMigration) return;

    logger.info('Migrating task_registry platform constraint', {
      needsEmailMigration,
      needsNativeMigration,
    });

    // Rename existing rows from 'cli' to 'native' before rebuilding the constraint
    if (needsNativeMigration) {
      this.db
        .prepare(
          `UPDATE task_registry SET platform = 'native' WHERE platform = 'cli'`,
        )
        .run();
    }

    this.db.exec(`
      ALTER TABLE task_registry RENAME TO task_registry_old;
      ${SCHEMA}
      INSERT INTO task_registry SELECT * FROM task_registry_old;
      DROP TABLE task_registry_old;
    `);
  }

  register(entry: TaskRegistration, liveEntry: LiveTaskEntry): void {
    const now = Date.now();
    const preview = truncatePromptPreview(entry.promptPreview);

    // Remove any previous terminal-state row for this session (happens on resume
    // after container restart, where the SDK reuses the same session ID).
    // Active duplicates still fail the UNIQUE constraint — that's a real bug.
    this.db
      .prepare(
        `DELETE FROM task_registry WHERE session_id = ? AND status IN ('completed', 'cancelled', 'error', 'interrupted', 'interrupted-shutdown')`,
      )
      .run(entry.sessionId);

    const stmt = this.db.prepare(`
      INSERT INTO task_registry (session_id, instance_id, room_id, thread_id, platform, origin, scheduler_job_id, prompt_preview, status, started_at, had_visible_output)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0)
    `);

    stmt.run(
      entry.sessionId,
      this.instanceId,
      entry.roomId,
      entry.threadId,
      entry.platform,
      entry.origin,
      entry.schedulerJobId ?? null,
      preview,
      now,
    );

    this.liveEntries.set(entry.sessionId, liveEntry);
    logger.info('task.registered', {
      sessionId: entry.sessionId,
      roomId: entry.roomId,
      platform: entry.platform,
      origin: entry.origin,
    });
  }

  complete(sessionId: string, stats: SessionStats): void {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE task_registry SET status = 'completed', completed_at = ?, final_input_tokens = ?, final_output_tokens = ?, final_cost_usd = ? WHERE session_id = ? AND status = 'active'`,
      )
      .run(
        now,
        stats.contextTokens,
        stats.outputTokens,
        stats.costUsd,
        sessionId,
      );

    if (result.changes === 0) {
      logger.warn('task.complete.no_op', { sessionId });
      return;
    }

    logger.info('task.completed', {
      sessionId,
      inputTokens: stats.contextTokens,
      outputTokens: stats.outputTokens,
      costUsd: stats.costUsd,
    });
  }

  markError(sessionId: string, stats?: SessionStats): void {
    const now = Date.now();
    let changes: number;
    if (stats) {
      const result = this.db
        .prepare(
          `UPDATE task_registry SET status = 'error', completed_at = ?, final_input_tokens = ?, final_output_tokens = ?, final_cost_usd = ? WHERE session_id = ? AND status = 'active'`,
        )
        .run(
          now,
          stats.contextTokens,
          stats.outputTokens,
          stats.costUsd,
          sessionId,
        );
      changes = result.changes;
    } else {
      const result = this.db
        .prepare(
          `UPDATE task_registry SET status = 'error', completed_at = ? WHERE session_id = ? AND status = 'active'`,
        )
        .run(now, sessionId);
      changes = result.changes;
    }

    if (changes === 0) {
      logger.warn('task.markError.no_op', { sessionId });
      return;
    }

    logger.info('task.error', { sessionId });
  }

  cancel(sessionId: string): void {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE task_registry SET status = 'cancelled', completed_at = ? WHERE session_id = ? AND status = 'active'`,
      )
      .run(now, sessionId);

    if (result.changes === 0) {
      logger.warn('task.cancel.no_op', { sessionId });
      return;
    }

    logger.info('task.cancelled', { sessionId });
  }

  heartbeat(sessionId: string): void {
    const now = Date.now();
    const lastAt = this.lastHeartbeatAt.get(sessionId) ?? 0;

    if (now - lastAt < HEARTBEAT_THROTTLE_MS) return;

    this.lastHeartbeatAt.set(sessionId, now);
    this.db
      .prepare(
        `UPDATE task_registry SET last_heartbeat_at = ? WHERE session_id = ?`,
      )
      .run(now, sessionId);
  }

  setHadVisibleOutput(sessionId: string): void {
    this.db
      .prepare(
        `UPDATE task_registry SET had_visible_output = 1 WHERE session_id = ?`,
      )
      .run(sessionId);
  }

  getActive(): TaskRegistryEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM task_registry WHERE status = 'active' AND instance_id = ?`,
      )
      .all(this.instanceId) as TaskRegistryEntry[];
  }

  getRecent(hours: number): TaskRegistryEntry[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return this.db
      .prepare(
        `SELECT * FROM task_registry WHERE status IN ('completed', 'cancelled', 'interrupted', 'interrupted-shutdown', 'error') AND completed_at > ? ORDER BY completed_at DESC`,
      )
      .all(cutoff) as TaskRegistryEntry[];
  }

  getEntry(sessionId: string): TaskRegistryEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM task_registry WHERE session_id = ?`)
      .get(sessionId) as TaskRegistryEntry | undefined;
    return row ?? null;
  }

  getLiveEntry(sessionId: string): LiveTaskEntry | undefined {
    return this.liveEntries.get(sessionId);
  }

  removeLiveEntry(sessionId: string): void {
    this.liveEntries.delete(sessionId);
    this.lastHeartbeatAt.delete(sessionId);
    logger.info('task.live_entry_removed', { sessionId });
  }

  async abortAll(): Promise<void> {
    const entries = [...this.liveEntries.values()];
    logger.info('Aborting all active sessions', { count: entries.length });

    // Abort all controllers first
    for (const entry of entries) {
      entry.abortController.abort();
    }

    // Await all session promises in parallel
    await Promise.allSettled(entries.map((e) => e.sessionPromise));

    logger.info('All active sessions aborted and settled');
  }

  markInterruptedShutdown(): void {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE task_registry SET status = 'interrupted-shutdown', completed_at = ? WHERE status = 'active' AND instance_id = ?`,
      )
      .run(now, this.instanceId);

    logger.info('task.interrupted_shutdown', {
      count: result.changes,
      instanceId: this.instanceId,
    });
  }

  async recoverInterruptedTasks(
    adapters: Map<
      string,
      {
        sendRecoveryNotice(
          channelId: string,
          threadId: string | null,
          text: string,
        ): Promise<void>;
      }
    >,
    delayMs: number = 30_000,
  ): Promise<void> {
    if (delayMs > 0) {
      logger.info('task.recovery.started', { delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Find stale active rows from OTHER instances
    const staleRows = this.db
      .prepare(
        `SELECT * FROM task_registry WHERE status = 'active' AND instance_id != ? LIMIT 100`,
      )
      .all(this.instanceId) as TaskRegistryEntry[];

    if (staleRows.length === 0) {
      logger.info('task.recovery.none_found');
      return;
    }

    logger.info('task.recovery.found', { count: staleRows.length });

    const now = Date.now();

    for (const row of staleRows) {
      // Update status to interrupted (only if still active)
      const result = this.db
        .prepare(
          `UPDATE task_registry SET status = 'interrupted', completed_at = ? WHERE session_id = ? AND status = 'active'`,
        )
        .run(now, row.session_id);

      if (result.changes === 0) {
        logger.info('task.recovery.skip', { sessionId: row.session_id });
        continue;
      }

      // Only notify if the task had visible output
      if (row.had_visible_output) {
        const adapter = adapters.get(row.platform);
        if (adapter) {
          try {
            const notice = `I had to restart and your previous request was interrupted. The prompt was: "${row.prompt_preview}". You may want to re-send it.`;
            await Promise.race([
              adapter.sendRecoveryNotice(row.room_id, row.thread_id, notice),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error('Notification timeout')),
                  2000,
                ),
              ),
            ]);
            logger.info('task.recovery.notified', {
              sessionId: row.session_id,
              roomId: row.room_id,
            });
          } catch (error) {
            logger.error('task.recovery.failed', {
              sessionId: row.session_id,
              error,
            });
          }
        }
      }
    }
  }

  cleanup(days: number = 14): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare(
        `DELETE FROM task_registry WHERE status IN ('completed', 'cancelled', 'interrupted', 'interrupted-shutdown', 'error') AND completed_at < ?`,
      )
      .run(cutoff);

    logger.info('task.cleanup', { deleted: result.changes, days });
  }
}
