import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('SessionLogger');

export interface DebugLogEntry {
  type: 'tool_use' | 'tool_result' | 'assistant' | 'user' | 'error' | 'system';
  tool?: string;
  input?: Record<string, unknown>;
  content?: string;
  [key: string]: unknown;
}

interface StoredEntry extends DebugLogEntry {
  id: string;
  timestamp: string;
  session_id: string;
  room: string;
}

interface TruncateResult {
  text: string;
  truncated: boolean;
  id?: string;
}

export class SessionLogger {
  private baseDir: string;
  private currentRoom: string | null = null;
  private currentSessionId: string | null = null;
  private logPath: string | null = null;
  private entryIndex: Map<string, StoredEntry> = new Map();
  private idCounter: number = 0;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  startSession(roomName: string, sessionId: string): void {
    // End any existing session
    this.endSession();

    this.currentRoom = this.sanitizeRoomName(roomName);
    this.currentSessionId = sessionId;
    this.idCounter = 0;
    this.entryIndex.clear();

    // Create room directory
    const roomDir = path.join(this.baseDir, this.currentRoom);
    if (!fs.existsSync(roomDir)) {
      fs.mkdirSync(roomDir, { recursive: true });
    }

    // Set up log path and create empty file
    this.logPath = path.join(roomDir, `${sessionId}.jsonl`);
    fs.writeFileSync(this.logPath, '', { flag: 'a' });

    logger.info('Session started', {
      room: this.currentRoom,
      sessionId,
      logPath: this.logPath,
    });
  }

  logEntry(entry: DebugLogEntry): string {
    if (!this.logPath || !this.currentRoom || !this.currentSessionId) {
      // No active session - return empty ID
      return '';
    }

    const id = this.generateId();
    const storedEntry: StoredEntry = {
      ...entry,
      id,
      timestamp: new Date().toISOString(),
      session_id: this.currentSessionId,
      room: this.currentRoom,
    };

    // Write to file synchronously
    fs.appendFileSync(this.logPath, `${JSON.stringify(storedEntry)}\n`);

    // Store in memory index
    this.entryIndex.set(id, storedEntry);

    logger.debug('Entry logged', { id, type: entry.type });

    return id;
  }

  getEntry(id: string): StoredEntry | undefined {
    return this.entryIndex.get(id);
  }

  endSession(): void {
    this.logPath = null;
    this.currentRoom = null;
    this.currentSessionId = null;
    this.entryIndex.clear();
    this.idCounter = 0;

    logger.debug('Session ended');
  }

  truncate(content: string, maxLength: number = 500): TruncateResult {
    if (content.length <= maxLength) {
      return { text: content, truncated: false };
    }

    // Log the full content and get an ID
    const id = this.logEntry({
      type: 'tool_result',
      content,
    });

    const truncatedText = `${content.substring(0, maxLength)}... [truncated, show dbg:${id}]`;

    return {
      text: truncatedText,
      truncated: true,
      id,
    };
  }

  private sanitizeRoomName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private generateId(): string {
    // Generate compact hex ID (0-4095 = 3 hex chars, then 4 chars)
    const id = this.idCounter.toString(16);
    this.idCounter++;
    return id;
  }
}
