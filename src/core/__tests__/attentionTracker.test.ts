import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngagementConfig } from '../attentionTracker.js';
import { AttentionTracker } from '../attentionTracker.js';

const TEST_DB = '/tmp/attention-tracker-test.sqlite';

function createDb(): Database.Database {
  return new Database(TEST_DB);
}

describe('AttentionTracker', () => {
  let db: Database.Database;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = createDb();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('shouldEngage', () => {
    it('should always engage for DMs', () => {
      const tracker = new AttentionTracker(db, {});
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'hello',
        isDm: true,
        isMention: false,
      });
      expect(reason).toBe('dm');
    });

    it('should always engage for @mentions', () => {
      const tracker = new AttentionTracker(db, {});
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'hello',
        isDm: false,
        isMention: true,
      });
      expect(reason).toBe('mention');
    });

    it('should prioritize DM over mention', () => {
      const tracker = new AttentionTracker(db, {});
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'hello',
        isDm: true,
        isMention: true,
      });
      expect(reason).toBe('dm');
    });

    it('should engage when bot name appears in text', () => {
      const tracker = new AttentionTracker(db, {
        nameMentions: ['Claude', 'Bot'],
      });
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'Hey Claude, what do you think?',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBe('name_in_text');
    });

    it('should match name mentions case-insensitively', () => {
      const tracker = new AttentionTracker(db, {
        nameMentions: ['Claude'],
      });
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'hey CLAUDE how are you',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBe('name_in_text');
    });

    it('should not engage when name not in text and no other triggers', () => {
      const tracker = new AttentionTracker(db, {
        nameMentions: ['Claude'],
      });
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'just a random message',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBeNull();
    });

    it('should not check names when nameMentions is empty', () => {
      const tracker = new AttentionTracker(db, {
        nameMentions: [],
      });
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'Claude is great',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBeNull();
    });

    it('should engage for active thread within timeout', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: 30_000,
      });

      // Engage with a thread first
      tracker.engage('thread-1', 'C123');

      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: 'thread-1',
        messageId: 'msg1',
        text: 'follow up message',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBe('active_thread');
    });

    it('should not engage for unknown thread', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: 'unknown-thread',
        messageId: 'msg1',
        text: 'message in unknown thread',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBeNull();
    });

    it('should disengage and return null for timed-out thread', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: 1, // 1ms timeout for test
      });

      tracker.engage('thread-1', 'C123');

      // Wait for timeout
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait 5ms
      }

      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: 'thread-1',
        messageId: 'msg1',
        text: 'late message',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBeNull();

      // Verify thread was disengaged
      const thread = tracker.getActiveThread('thread-1');
      expect(thread).toBeNull();
    });

    it('should never time out active thread when threadTimeout is Infinity', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: Infinity,
      });

      tracker.engage('thread-1', 'C123');

      // Wait a bit — with Infinity timeout thread should never expire
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy-wait
      }

      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: 'thread-1',
        messageId: 'msg1',
        text: 'message long after engage',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBe('active_thread');

      // Thread should still be tracked
      expect(tracker.getActiveThread('thread-1')).not.toBeNull();
    });

    it('should not check active threads when threadId is null', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');

      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'message without thread',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBeNull();
    });

    it('should return null when no engagement config triggers match', () => {
      const tracker = new AttentionTracker(db, {});
      const reason = tracker.shouldEngage({
        channelId: 'C123',
        threadId: null,
        messageId: 'msg1',
        text: 'hello',
        isDm: false,
        isMention: false,
      });
      expect(reason).toBeNull();
    });
  });

  describe('isDismissal', () => {
    it('should detect dismissal matching a pattern', () => {
      const tracker = new AttentionTracker(db, {
        dismissalPatterns: [
          /^thanks,?\s*(that'?s?\s*all|bye|goodbye)/i,
          /^go away/i,
        ],
      });
      expect(tracker.isDismissal("Thanks, that's all")).toBe(true);
      expect(tracker.isDismissal('thanks bye')).toBe(true);
      expect(tracker.isDismissal('Go Away')).toBe(true);
    });

    it('should return false when text does not match any pattern', () => {
      const tracker = new AttentionTracker(db, {
        dismissalPatterns: [/^bye$/i],
      });
      expect(tracker.isDismissal('hello there')).toBe(false);
      expect(tracker.isDismissal('bye bye')).toBe(false);
    });

    it('should return false when no dismissal patterns configured', () => {
      const tracker = new AttentionTracker(db, {});
      expect(tracker.isDismissal('bye')).toBe(false);
    });

    it('should return false when dismissalPatterns is undefined', () => {
      const config: EngagementConfig = {};
      delete config.dismissalPatterns;
      const tracker = new AttentionTracker(db, config);
      expect(tracker.isDismissal('bye')).toBe(false);
    });
  });

  describe('engage', () => {
    it('should track a new thread', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');

      const thread = tracker.getActiveThread('thread-1');
      expect(thread).not.toBeNull();
      expect(thread!.threadId).toBe('thread-1');
      expect(thread!.channelId).toBe('C123');
      expect(thread!.engagedAt).toBeGreaterThan(0);
      expect(thread!.lastActivity).toBeGreaterThan(0);
    });

    it('should preserve original engaged_at on re-engage', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      const firstThread = tracker.getActiveThread('thread-1')!;
      const originalEngagedAt = firstThread.engagedAt;

      // Wait a bit and re-engage
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait
      }

      tracker.engage('thread-1', 'C123');
      const secondThread = tracker.getActiveThread('thread-1')!;

      expect(secondThread.engagedAt).toBe(originalEngagedAt);
      expect(secondThread.lastActivity).toBeGreaterThanOrEqual(
        originalEngagedAt,
      );
    });

    it('should update lastActivity on re-engage', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      const first = tracker.getActiveThread('thread-1')!;

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait
      }

      tracker.engage('thread-1', 'C123');
      const second = tracker.getActiveThread('thread-1')!;

      expect(second.lastActivity).toBeGreaterThanOrEqual(first.lastActivity);
    });

    it('should be a no-op when trackActiveThreads is false', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: false,
      });

      tracker.engage('thread-1', 'C123');

      // Table shouldn't even exist, but getActiveThread with tracking disabled returns null
      const thread = tracker.getActiveThread('thread-1');
      expect(thread).toBeNull();
    });

    it('should track multiple threads independently', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C100');
      tracker.engage('thread-2', 'C100');
      tracker.engage('thread-3', 'C200');

      expect(tracker.getActiveThread('thread-1')).not.toBeNull();
      expect(tracker.getActiveThread('thread-2')).not.toBeNull();
      expect(tracker.getActiveThread('thread-3')).not.toBeNull();
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivity without changing engagedAt', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      const original = tracker.getActiveThread('thread-1')!;

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait
      }

      tracker.updateActivity('thread-1');
      const updated = tracker.getActiveThread('thread-1')!;

      expect(updated.engagedAt).toBe(original.engagedAt);
      expect(updated.lastActivity).toBeGreaterThanOrEqual(
        original.lastActivity,
      );
    });

    it('should be a no-op when trackActiveThreads is false', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: false,
      });
      // Should not throw
      tracker.updateActivity('thread-1');
    });

    it('should be a no-op before any engage call (not initialized)', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });
      // Table not created yet, should not throw
      tracker.updateActivity('thread-1');
    });
  });

  describe('disengage', () => {
    it('should remove thread from tracking', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      expect(tracker.getActiveThread('thread-1')).not.toBeNull();

      tracker.disengage('thread-1');
      expect(tracker.getActiveThread('thread-1')).toBeNull();
    });

    it('should not affect other threads', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      tracker.engage('thread-2', 'C123');

      tracker.disengage('thread-1');

      expect(tracker.getActiveThread('thread-1')).toBeNull();
      expect(tracker.getActiveThread('thread-2')).not.toBeNull();
    });

    it('should be a no-op for non-existent thread', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123'); // Initialize table
      // Should not throw
      tracker.disengage('non-existent');
    });

    it('should be a no-op when trackActiveThreads is false', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: false,
      });
      tracker.disengage('thread-1');
    });
  });

  describe('getActiveThread', () => {
    it('should return null for non-existent thread', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      const thread = tracker.getActiveThread('non-existent');
      expect(thread).toBeNull();
    });

    it('should return correct field mapping from database', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      const thread = tracker.getActiveThread('thread-1')!;

      expect(thread).toEqual({
        threadId: 'thread-1',
        channelId: 'C123',
        engagedAt: expect.any(Number),
        lastActivity: expect.any(Number),
      });
    });

    it('should return null when trackActiveThreads is false', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: false,
      });
      expect(tracker.getActiveThread('anything')).toBeNull();
    });
  });

  describe('getActiveThreadsForChannel', () => {
    it('should return all active threads for a channel', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');
      tracker.engage('thread-2', 'C123');
      tracker.engage('thread-3', 'C456');

      const threads = tracker.getActiveThreadsForChannel('C123');
      expect(threads).toHaveLength(2);

      const ids = threads.map((t) => t.threadId);
      expect(ids).toContain('thread-1');
      expect(ids).toContain('thread-2');
    });

    it('should return empty array for channel with no active threads', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123'); // Initialize table
      const threads = tracker.getActiveThreadsForChannel('EMPTY');
      expect(threads).toEqual([]);
    });

    it('should order by lastActivity descending', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123');

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait so timestamps differ
      }

      tracker.engage('thread-2', 'C123');

      const threads = tracker.getActiveThreadsForChannel('C123');
      expect(threads[0]!.threadId).toBe('thread-2');
      expect(threads[1]!.threadId).toBe('thread-1');
    });

    it('should return empty array when trackActiveThreads is false', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: false,
      });
      expect(tracker.getActiveThreadsForChannel('C123')).toEqual([]);
    });
  });

  describe('cleanupTimedOutThreads', () => {
    it('should remove threads that have timed out', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: 1, // 1ms timeout for test
      });

      tracker.engage('thread-1', 'C123');
      tracker.engage('thread-2', 'C123');

      // Wait for timeout
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy-wait
      }

      const cleaned = tracker.cleanupTimedOutThreads();
      expect(cleaned).toBe(2);

      expect(tracker.getActiveThread('thread-1')).toBeNull();
      expect(tracker.getActiveThread('thread-2')).toBeNull();
    });

    it('should not remove threads that have not timed out', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: 60_000, // 60 seconds - won't timeout during test
      });

      tracker.engage('thread-1', 'C123');

      const cleaned = tracker.cleanupTimedOutThreads();
      expect(cleaned).toBe(0);
      expect(tracker.getActiveThread('thread-1')).not.toBeNull();
    });

    it('should only remove timed-out threads, keeping active ones', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: 10, // 10ms
      });

      tracker.engage('old-thread', 'C123');

      // Wait for old-thread to time out
      const start = Date.now();
      while (Date.now() - start < 15) {
        // busy-wait
      }

      // Engage a new thread after the wait
      tracker.engage('new-thread', 'C123');

      const cleaned = tracker.cleanupTimedOutThreads();
      expect(cleaned).toBe(1);

      expect(tracker.getActiveThread('old-thread')).toBeNull();
      expect(tracker.getActiveThread('new-thread')).not.toBeNull();
    });

    it('should return 0 when trackActiveThreads is false', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: false,
      });
      expect(tracker.cleanupTimedOutThreads()).toBe(0);
    });

    it('should return 0 when not initialized (no engage calls yet)', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });
      expect(tracker.cleanupTimedOutThreads()).toBe(0);
    });

    it('should never remove threads when threadTimeout is Infinity', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        threadTimeout: Infinity,
      });

      tracker.engage('thread-1', 'C123');
      tracker.engage('thread-2', 'C123');

      // Wait a bit — with Infinity timeout nothing should expire
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy-wait
      }

      const cleaned = tracker.cleanupTimedOutThreads();
      expect(cleaned).toBe(0);

      expect(tracker.getActiveThread('thread-1')).not.toBeNull();
      expect(tracker.getActiveThread('thread-2')).not.toBeNull();
    });

    it('should use default 30-minute timeout when not configured', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
        // No threadTimeout - should use 30 min default
      });

      tracker.engage('thread-1', 'C123');

      // Thread was just created, should NOT be cleaned up
      const cleaned = tracker.cleanupTimedOutThreads();
      expect(cleaned).toBe(0);
    });
  });

  describe('table initialization', () => {
    it('should lazily create table only when needed', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      // Table should not exist yet
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='active_threads'",
        )
        .all();
      expect(tables).toHaveLength(0);

      // Trigger table creation via engage
      tracker.engage('thread-1', 'C123');

      const tablesAfter = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='active_threads'",
        )
        .all();
      expect(tablesAfter).toHaveLength(1);
    });

    it('should create indexes on table creation', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      tracker.engage('thread-1', 'C123'); // Trigger table creation

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='active_threads'",
        )
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_active_threads_channel');
      expect(indexNames).toContain('idx_active_threads_activity');
    });

    it('should be idempotent - calling ensureTable multiple times is safe', () => {
      const tracker = new AttentionTracker(db, {
        trackActiveThreads: true,
      });

      // Multiple calls that each trigger ensureTable
      tracker.engage('thread-1', 'C123');
      tracker.engage('thread-2', 'C123');
      tracker.getActiveThread('thread-1');
      tracker.getActiveThreadsForChannel('C123');

      // Should all succeed without errors
      expect(tracker.getActiveThread('thread-1')).not.toBeNull();
    });
  });
});
