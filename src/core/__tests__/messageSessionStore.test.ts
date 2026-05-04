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
    store.saveSession('$evt1', '!room1', {
      sessionId: 'sess_abc',
      contextTokens: 1500,
      compactionCount: 0,
    });

    const session = store.getSession('$evt1');
    expect(session).not.toBeNull();
    expect(session!.eventId).toBe('$evt1');
    expect(session!.roomId).toBe('!room1');
    expect(session!.sessionId).toBe('sess_abc');
    expect(session!.contextTokens).toBe(1500);
    expect(session!.compactionCount).toBe(0);
    expect(session!.createdAt).toBeGreaterThan(0);
  });

  it('should return null for non-existent event', () => {
    expect(store.getSession('$nonexistent')).toBeNull();
  });

  it('should upsert on conflict', () => {
    store.saveSession('$evt1', '!room1', {
      sessionId: 'sess_1',
      contextTokens: 100,
      compactionCount: 0,
    });
    store.saveSession('$evt1', '!room1', {
      sessionId: 'sess_2',
      contextTokens: 200,
      compactionCount: 1,
    });

    const session = store.getSession('$evt1');
    expect(session!.sessionId).toBe('sess_2');
    expect(session!.contextTokens).toBe(200);
    expect(session!.compactionCount).toBe(1);
  });

  describe('deleteSession', () => {
    it('should delete an existing session', () => {
      store.saveSession('$evt1', '!room1', {
        sessionId: 'sess_abc',
        contextTokens: 1000,
        compactionCount: 0,
      });

      expect(store.getSession('$evt1')).not.toBeNull();

      store.deleteSession('$evt1');

      expect(store.getSession('$evt1')).toBeNull();
    });

    it('should be a no-op for non-existent event', () => {
      // Should not throw
      store.deleteSession('$nonexistent');
    });

    it('should not affect other sessions', () => {
      store.saveSession('$evt1', '!room1', {
        sessionId: 'sess_1',
        contextTokens: 100,
        compactionCount: 0,
      });
      store.saveSession('$evt2', '!room1', {
        sessionId: 'sess_2',
        contextTokens: 200,
        compactionCount: 0,
      });

      store.deleteSession('$evt1');

      expect(store.getSession('$evt1')).toBeNull();
      expect(store.getSession('$evt2')).not.toBeNull();
    });
  });

  describe('getSessionsForRoom', () => {
    it('should return sessions ordered by most recent', () => {
      // Insert directly with controlled timestamps to avoid same-millisecond race
      const insert = sqliteDb.prepare(`
        INSERT INTO message_sessions (event_id, room_id, session_id, created_at, context_tokens, compaction_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run('$evt1', '!room1', 'sess_1', 1000, 100, 0);
      insert.run('$evt2', '!room1', 'sess_2', 2000, 200, 0);

      const sessions = store.getSessionsForRoom('!room1');
      expect(sessions).toHaveLength(2);
      // Most recent first
      expect(sessions[0].sessionId).toBe('sess_2');
      expect(sessions[1].sessionId).toBe('sess_1');
    });

    it('should respect limit parameter', () => {
      store.saveSession('$evt1', '!room1', {
        sessionId: 'sess_1',
        contextTokens: 100,
        compactionCount: 0,
      });
      store.saveSession('$evt2', '!room1', {
        sessionId: 'sess_2',
        contextTokens: 200,
        compactionCount: 0,
      });

      const sessions = store.getSessionsForRoom('!room1', 1);
      expect(sessions).toHaveLength(1);
    });

    it('should only return sessions for the specified room', () => {
      store.saveSession('$evt1', '!room1', {
        sessionId: 'sess_1',
        contextTokens: 100,
        compactionCount: 0,
      });
      store.saveSession('$evt2', '!room2', {
        sessionId: 'sess_2',
        contextTokens: 200,
        compactionCount: 0,
      });

      const sessions = store.getSessionsForRoom('!room1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].roomId).toBe('!room1');
    });
  });
});
