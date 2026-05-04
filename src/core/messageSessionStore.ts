// src/db/messageSessionStore.ts
// Maps platform message IDs to SDK session IDs for conversation continuity

import type Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS message_sessions (
  event_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  context_tokens INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_message_sessions_room ON message_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_message_sessions_session ON message_sessions(session_id);
`;

export interface MessageSession {
  eventId: string;
  roomId: string;
  sessionId: string;
  createdAt: number;
  contextTokens: number;
  compactionCount: number;
}

/** Database row shape for message_sessions table */
interface MessageSessionRow {
  event_id: string;
  room_id: string;
  session_id: string;
  created_at: number;
  context_tokens: number;
  compaction_count: number;
}

export class MessageSessionStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  /**
   * Save a session mapping for a message event.
   */
  saveSession(
    eventId: string,
    roomId: string,
    data: {
      sessionId: string;
      contextTokens: number;
      compactionCount: number;
    },
  ): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO message_sessions (event_id, room_id, session_id, created_at, context_tokens, compaction_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        session_id = excluded.session_id,
        context_tokens = excluded.context_tokens,
        compaction_count = excluded.compaction_count
    `);
    stmt.run(
      eventId,
      roomId,
      data.sessionId,
      now,
      data.contextTokens,
      data.compactionCount,
    );
  }

  /**
   * Get the session associated with a specific message event.
   */
  getSession(eventId: string): MessageSession | null {
    const stmt = this.db.prepare(`
      SELECT event_id, room_id, session_id, created_at, context_tokens, compaction_count
      FROM message_sessions
      WHERE event_id = ?
    `);
    const row = stmt.get(eventId) as MessageSessionRow | undefined;
    if (!row) return null;

    return {
      eventId: row.event_id,
      roomId: row.room_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
      contextTokens: row.context_tokens,
      compactionCount: row.compaction_count,
    };
  }

  /**
   * Delete a session mapping by event ID.
   * Used on the cancel path to clear session state so the next message starts fresh.
   */
  deleteSession(eventId: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM message_sessions WHERE event_id = ?',
    );
    stmt.run(eventId);
  }

  /**
   * Get sessions for a room, ordered by most recent.
   */
  getSessionsForRoom(roomId: string, limit: number = 10): MessageSession[] {
    const stmt = this.db.prepare(`
      SELECT event_id, room_id, session_id, created_at, context_tokens, compaction_count
      FROM message_sessions
      WHERE room_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(roomId, limit) as MessageSessionRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      roomId: row.room_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
      contextTokens: row.context_tokens,
      compactionCount: row.compaction_count,
    }));
  }
}
