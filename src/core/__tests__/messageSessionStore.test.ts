import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageSessionStore } from '../messageSessionStore.js';

const TEST_DB = '/tmp/bot-toolkit-test-message-sessions.sqlite';

describe('MessageSessionStore', () => {
  let sqliteDb: Database.Database;
  let store: MessageSessionStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    sqliteDb = new Database(TEST_DB);
    store = new MessageSessionStore(sqliteDb);
  });

  afterEach(() => {
    sqliteDb.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should save and retrieve a session', () => {
    store.saveSession('msg-1', 'C123', {
      sessionId: 'sess_abc',
      contextTokens: 1500,
      compactionCount: 0,
    });

    const session = store.getSession('msg-1');
    expect(session).not.toBeNull();
    expect(session!.eventId).toBe('msg-1');
    expect(session!.roomId).toBe('C123');
    expect(session!.sessionId).toBe('sess_abc');
    expect(session!.contextTokens).toBe(1500);
    expect(session!.compactionCount).toBe(0);
    expect(session!.createdAt).toBeGreaterThan(0);
  });

  it('should return null for non-existent event', () => {
    expect(store.getSession('$nonexistent')).toBeNull();
  });

  it('should upsert on conflict', () => {
    store.saveSession('msg-1', 'C123', {
      sessionId: 'sess_1',
      contextTokens: 100,
      compactionCount: 0,
    });
    store.saveSession('msg-1', 'C123', {
      sessionId: 'sess_2',
      contextTokens: 200,
      compactionCount: 1,
    });

    const session = store.getSession('msg-1');
    expect(session!.sessionId).toBe('sess_2');
    expect(session!.contextTokens).toBe(200);
    expect(session!.compactionCount).toBe(1);
  });

  describe('deleteSession', () => {
    it('should delete an existing session', () => {
      store.saveSession('msg-1', 'C123', {
        sessionId: 'sess_abc',
        contextTokens: 1000,
        compactionCount: 0,
      });

      expect(store.getSession('msg-1')).not.toBeNull();

      store.deleteSession('msg-1');

      expect(store.getSession('msg-1')).toBeNull();
    });

    it('should be a no-op for non-existent event', () => {
      // Should not throw
      store.deleteSession('$nonexistent');
    });

    it('should not affect other sessions', () => {
      store.saveSession('msg-1', 'C123', {
        sessionId: 'sess_1',
        contextTokens: 100,
        compactionCount: 0,
      });
      store.saveSession('msg-2', 'C123', {
        sessionId: 'sess_2',
        contextTokens: 200,
        compactionCount: 0,
      });

      store.deleteSession('msg-1');

      expect(store.getSession('msg-1')).toBeNull();
      expect(store.getSession('msg-2')).not.toBeNull();
    });
  });

  describe('getSessionsForRoom', () => {
    it('should return sessions ordered by most recent', () => {
      // Insert directly with controlled timestamps to avoid same-millisecond race
      const insert = sqliteDb.prepare(`
        INSERT INTO message_sessions (event_id, room_id, session_id, created_at, context_tokens, compaction_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run('msg-1', 'C123', 'sess_1', 1000, 100, 0);
      insert.run('msg-2', 'C123', 'sess_2', 2000, 200, 0);

      const sessions = store.getSessionsForRoom('C123');
      expect(sessions).toHaveLength(2);
      // Most recent first
      expect(sessions[0].sessionId).toBe('sess_2');
      expect(sessions[1].sessionId).toBe('sess_1');
    });

    it('should respect limit parameter', () => {
      store.saveSession('msg-1', 'C123', {
        sessionId: 'sess_1',
        contextTokens: 100,
        compactionCount: 0,
      });
      store.saveSession('msg-2', 'C123', {
        sessionId: 'sess_2',
        contextTokens: 200,
        compactionCount: 0,
      });

      const sessions = store.getSessionsForRoom('C123', 1);
      expect(sessions).toHaveLength(1);
    });

    it('should only return sessions for the specified room', () => {
      store.saveSession('msg-1', 'C123', {
        sessionId: 'sess_1',
        contextTokens: 100,
        compactionCount: 0,
      });
      store.saveSession('msg-2', 'C456', {
        sessionId: 'sess_2',
        contextTokens: 200,
        compactionCount: 0,
      });

      const sessions = store.getSessionsForRoom('C123');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].roomId).toBe('C123');
    });
  });
});
