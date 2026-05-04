// src/core/attentionTracker.ts

import type Database from 'better-sqlite3';
import { Logger } from '../utils/logger.js';

const logger = new Logger('AttentionTracker');

export interface ActiveThread {
  threadId: string;
  channelId: string;
  engagedAt: number;
  lastActivity: number;
}

export interface EngagementConfig {
  /** Bot name variants to detect in message text (case-insensitive) */
  nameMentions?: string[];

  /** Track active threads and keep responding until dismissed */
  trackActiveThreads?: boolean;

  /** Patterns that indicate user wants to end conversation */
  dismissalPatterns?: RegExp[];

  /** How long to stay engaged in a thread without activity (ms). Default: 30 minutes */
  threadTimeout?: number;
}

export type EngagementReason =
  | 'dm'
  | 'mention'
  | 'name_in_text'
  | 'active_thread'
  | null;

const DEFAULT_THREAD_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Tracks engagement state for threads.
 * Uses lazy table creation - only creates the database table if trackActiveThreads is enabled.
 */
export class AttentionTracker {
  private db: Database.Database;
  private config: EngagementConfig;
  private initialized = false;

  constructor(db: Database.Database, config: EngagementConfig = {}) {
    this.db = db;
    this.config = config;
  }

  /**
   * Lazily create the active_threads table.
   * Only called when trackActiveThreads is enabled.
   */
  private ensureTable(): void {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_threads (
        thread_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        engaged_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_active_threads_channel ON active_threads(channel_id);
      CREATE INDEX IF NOT EXISTS idx_active_threads_activity ON active_threads(last_activity);
    `);

    this.initialized = true;
    logger.info('Active threads table initialized');
  }

  /**
   * Check if we should engage with this message and why.
   * Returns the engagement reason or null if we shouldn't engage.
   */
  shouldEngage(params: {
    channelId: string;
    threadId: string | null;
    messageId: string;
    text: string;
    isDm: boolean;
    isMention: boolean;
  }): EngagementReason {
    const { threadId, text, isDm, isMention } = params;

    // DMs always engage
    if (isDm) {
      return 'dm';
    }

    // @mentions always engage
    if (isMention) {
      return 'mention';
    }

    // Check for name in text
    if (this.config.nameMentions && this.config.nameMentions.length > 0) {
      const lowerText = text.toLowerCase();
      for (const name of this.config.nameMentions) {
        if (lowerText.includes(name.toLowerCase())) {
          return 'name_in_text';
        }
      }
    }

    // Check active thread
    if (this.config.trackActiveThreads && threadId) {
      const activeThread = this.getActiveThread(threadId);
      if (activeThread) {
        const timeout = this.config.threadTimeout ?? DEFAULT_THREAD_TIMEOUT;
        const isTimedOut = Date.now() - activeThread.lastActivity > timeout;

        if (!isTimedOut) {
          return 'active_thread';
        } else {
          // Thread timed out, disengage
          this.disengage(threadId);
        }
      }
    }

    return null;
  }

  /**
   * Check if the message is a dismissal (user wants to end conversation).
   */
  isDismissal(text: string): boolean {
    if (!this.config.dismissalPatterns) return false;

    for (const pattern of this.config.dismissalPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Engage with a thread - start tracking it as active.
   */
  engage(threadId: string, channelId: string): void {
    if (!this.config.trackActiveThreads) return;

    this.ensureTable();

    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO active_threads (thread_id, channel_id, engaged_at, last_activity)
      VALUES (?, ?, COALESCE((SELECT engaged_at FROM active_threads WHERE thread_id = ?), ?), ?)
    `);
    stmt.run(threadId, channelId, threadId, now, now);

    logger.debug('Engaged with thread', { threadId, channelId });
  }

  /**
   * Update activity timestamp for a thread.
   */
  updateActivity(threadId: string): void {
    if (!this.config.trackActiveThreads) return;
    if (!this.initialized) return;

    const now = Date.now();
    const stmt = this.db.prepare(
      'UPDATE active_threads SET last_activity = ? WHERE thread_id = ?',
    );
    stmt.run(now, threadId);
  }

  /**
   * Disengage from a thread - stop tracking it.
   */
  disengage(threadId: string): void {
    if (!this.config.trackActiveThreads) return;
    if (!this.initialized) return;

    const stmt = this.db.prepare(
      'DELETE FROM active_threads WHERE thread_id = ?',
    );
    stmt.run(threadId);

    logger.debug('Disengaged from thread', { threadId });
  }

  /**
   * Get an active thread by ID.
   */
  getActiveThread(threadId: string): ActiveThread | null {
    if (!this.config.trackActiveThreads) return null;

    this.ensureTable();

    const stmt = this.db.prepare(
      'SELECT * FROM active_threads WHERE thread_id = ?',
    );
    const row = stmt.get(threadId) as
      | {
          thread_id: string;
          channel_id: string;
          engaged_at: number;
          last_activity: number;
        }
      | undefined;

    if (!row) return null;

    return {
      threadId: row.thread_id,
      channelId: row.channel_id,
      engagedAt: row.engaged_at,
      lastActivity: row.last_activity,
    };
  }

  /**
   * Get all active threads for a channel.
   */
  getActiveThreadsForChannel(channelId: string): ActiveThread[] {
    if (!this.config.trackActiveThreads) return [];

    this.ensureTable();

    const stmt = this.db.prepare(
      'SELECT * FROM active_threads WHERE channel_id = ? ORDER BY last_activity DESC',
    );
    const rows = stmt.all(channelId) as Array<{
      thread_id: string;
      channel_id: string;
      engaged_at: number;
      last_activity: number;
    }>;

    return rows.map((row) => ({
      threadId: row.thread_id,
      channelId: row.channel_id,
      engagedAt: row.engaged_at,
      lastActivity: row.last_activity,
    }));
  }

  /**
   * Clean up timed-out threads.
   */
  cleanupTimedOutThreads(): number {
    if (!this.config.trackActiveThreads) return 0;
    if (!this.initialized) return 0;

    const timeout = this.config.threadTimeout ?? DEFAULT_THREAD_TIMEOUT;
    const cutoff = Date.now() - timeout;

    const stmt = this.db.prepare(
      'DELETE FROM active_threads WHERE last_activity < ?',
    );
    const result = stmt.run(cutoff);

    if (result.changes > 0) {
      logger.info('Cleaned up timed-out threads', { count: result.changes });
    }

    return result.changes;
  }
}
