import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Database');

export interface SessionRecord {
  room_id: string;
  context_name: string;
  created_at: number;
  last_active: number;
}

export interface MainSessionRecord {
  channel_id: string;
  session_id: string;
  context_tokens: number;
  compaction_count: number;
  last_activity: number;
}

export interface ThreadSessionRecord {
  thread_id: string;
  channel_id: string;
  session_id: string;
  forked_from_session_id: string | null;
  context_tokens: number;
  compaction_count: number;
  created_at: number;
}

export class SessionDatabase {
  private _db: Database.Database;

  /** Get the underlying database connection for shared use */
  get db(): Database.Database {
    return this._db;
  }

  constructor(dbPath: string) {
    try {
      // Ensure directory exists
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this._db = new Database(dbPath);
      this._db.pragma('journal_mode = WAL');
      this._db.pragma('synchronous = NORMAL'); // NORMAL is safe with WAL (durability guaranteed on checkpoint)
      this._db.pragma('busy_timeout = 5000'); // Wait up to 5s for locks (dashboard reads this DB)
      this.initialize();
      logger.info('Database initialized', { dbPath });
    } catch (error) {
      logger.error('Failed to initialize database', error);
      throw new DatabaseError(`Failed to initialize database: ${error}`);
    }
  }

  private initialize() {
    // Note: session_id column removed - we now use per-room directories for session continuity
    // The sessions table now just tracks room metadata (context_name, activity timestamps)
    const schema = `
      CREATE TABLE IF NOT EXISTS sessions (
        room_id TEXT PRIMARY KEY,
        context_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_events (
        event_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        processed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS debug_rooms (
        room_id TEXT PRIMARY KEY,
        debug_room_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_last_active ON sessions(last_active);
      CREATE INDEX IF NOT EXISTS idx_processed_events_time ON processed_events(processed_at);

      CREATE TABLE IF NOT EXISTS main_sessions (
        channel_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        context_tokens INTEGER DEFAULT 0,
        compaction_count INTEGER DEFAULT 0,
        last_activity INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_sessions (
        thread_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        forked_from_session_id TEXT,
        context_tokens INTEGER DEFAULT 0,
        compaction_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_thread_sessions_channel ON thread_sessions(channel_id);

      CREATE TABLE IF NOT EXISTS processed_wakeups (
        idempotency_key TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_processed_wakeups_time ON processed_wakeups(processed_at);
    `;
    this._db.exec(schema);

    // Migration: drop session_id column if it exists (SQLite doesn't support DROP COLUMN easily,
    // but we can just ignore it - the column will remain but won't be used)
  }

  getSession(roomId: string): SessionRecord | undefined {
    const stmt = this._db.prepare('SELECT * FROM sessions WHERE room_id = ?');
    return stmt.get(roomId) as SessionRecord | undefined;
  }

  createOrUpdateRoom(roomId: string, contextName: string): void {
    const now = Date.now();
    // Use INSERT OR REPLACE to upsert room metadata
    const stmt = this._db.prepare(
      'INSERT OR REPLACE INTO sessions (room_id, context_name, created_at, last_active) VALUES (?, ?, ?, ?)',
    );
    stmt.run(roomId, contextName, now, now);
    logger.info('Room record created/updated', { roomId, contextName });
  }

  updateLastActive(roomId: string): void {
    const now = Date.now();
    const stmt = this._db.prepare(
      'UPDATE sessions SET last_active = ? WHERE room_id = ?',
    );
    stmt.run(now, roomId);
  }

  getAllSessions(): SessionRecord[] {
    const stmt = this._db.prepare(
      'SELECT * FROM sessions ORDER BY last_active DESC',
    );
    return stmt.all() as SessionRecord[];
  }

  isEventProcessed(eventId: string): boolean {
    const stmt = this._db.prepare(
      'SELECT 1 FROM processed_events WHERE event_id = ?',
    );
    return !!stmt.get(eventId);
  }

  markEventProcessed(eventId: string, roomId: string): void {
    const now = Date.now();
    const stmt = this._db.prepare(
      'INSERT OR IGNORE INTO processed_events (event_id, room_id, processed_at) VALUES (?, ?, ?)',
    );
    stmt.run(eventId, roomId, now);
  }

  deleteEventProcessed(eventId: string): void {
    const stmt = this._db.prepare(
      'DELETE FROM processed_events WHERE event_id = ?',
    );
    stmt.run(eventId);
  }

  cleanOldProcessedEvents(daysToKeep: number = 7): void {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const stmt = this._db.prepare(
      'DELETE FROM processed_events WHERE processed_at < ?',
    );
    const result = stmt.run(cutoff);
    logger.info('Cleaned old processed events', { deleted: result.changes });
  }

  getDebugRoom(roomId: string): string | undefined {
    const stmt = this._db.prepare(
      'SELECT debug_room_id FROM debug_rooms WHERE room_id = ?',
    );
    const result = stmt.get(roomId) as { debug_room_id: string } | undefined;
    return result?.debug_room_id;
  }

  setDebugRoom(roomId: string, debugRoomId: string): void {
    const now = Date.now();
    const stmt = this._db.prepare(
      'INSERT OR REPLACE INTO debug_rooms (room_id, debug_room_id, created_at) VALUES (?, ?, ?)',
    );
    stmt.run(roomId, debugRoomId, now);
    logger.info('Debug room mapping saved', { roomId, debugRoomId });
  }

  /**
   * Check if a room is a debug room (i.e., it's the debug_room_id for some other room).
   * We don't want Claude to listen to debug rooms to avoid recursive debugging.
   */
  isDebugRoom(roomId: string): boolean {
    const stmt = this._db.prepare(
      'SELECT 1 FROM debug_rooms WHERE debug_room_id = ?',
    );
    return !!stmt.get(roomId);
  }

  saveMainSession(
    channelId: string,
    data: { sessionId: string; contextTokens: number; compactionCount: number },
  ): void {
    const now = Date.now();
    const stmt = this._db.prepare(`
      INSERT INTO main_sessions (channel_id, session_id, context_tokens, compaction_count, last_activity)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        session_id = excluded.session_id,
        context_tokens = excluded.context_tokens,
        compaction_count = excluded.compaction_count,
        last_activity = excluded.last_activity
    `);
    stmt.run(
      channelId,
      data.sessionId,
      data.contextTokens,
      data.compactionCount,
      now,
    );
  }

  getMainSession(channelId: string): MainSessionRecord | null {
    const stmt = this._db.prepare(
      'SELECT * FROM main_sessions WHERE channel_id = ?',
    );
    const row = stmt.get(channelId) as MainSessionRecord | undefined;
    return row ?? null;
  }

  saveThreadSession(
    threadId: string,
    data: {
      channelId: string;
      sessionId: string;
      forkedFromSessionId: string | null;
      contextTokens: number;
      compactionCount: number;
    },
  ): void {
    const now = Date.now();
    const stmt = this._db.prepare(`
      INSERT INTO thread_sessions (thread_id, channel_id, session_id, forked_from_session_id, context_tokens, compaction_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        session_id = excluded.session_id,
        context_tokens = excluded.context_tokens,
        compaction_count = excluded.compaction_count
    `);
    stmt.run(
      threadId,
      data.channelId,
      data.sessionId,
      data.forkedFromSessionId,
      data.contextTokens,
      data.compactionCount,
      now,
    );
  }

  getThreadSession(threadId: string): ThreadSessionRecord | null {
    const stmt = this._db.prepare(
      'SELECT * FROM thread_sessions WHERE thread_id = ?',
    );
    const row = stmt.get(threadId) as ThreadSessionRecord | undefined;
    return row ?? null;
  }

  isWakeupProcessed(idempotencyKey: string): boolean {
    const stmt = this._db.prepare(
      'SELECT 1 FROM processed_wakeups WHERE idempotency_key = ?',
    );
    return !!stmt.get(idempotencyKey);
  }

  markWakeupProcessed(idempotencyKey: string): void {
    const now = Date.now();
    this._db
      .prepare(
        'INSERT OR IGNORE INTO processed_wakeups (idempotency_key, processed_at) VALUES (?, ?)',
      )
      .run(idempotencyKey, now);
  }

  cleanOldWakeups(ttlMs: number): number {
    const cutoff = Date.now() - ttlMs;
    const result = this._db
      .prepare('DELETE FROM processed_wakeups WHERE processed_at < ?')
      .run(cutoff);
    logger.info('Cleaned old processed wakeups', { deleted: result.changes });
    return result.changes;
  }

  close() {
    this._db.close();
    logger.info('Database closed');
  }
}
