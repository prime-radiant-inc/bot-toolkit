// packages/bot-toolkit/src/native/sessionManager.ts

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WebSocket } from 'ws';
import { Logger } from '../utils/logger.js';
import type { NativeSession, NativeSessionMetadata } from './types.js';

const logger = new Logger('NativeSessionManager');

export class NativeSessionManager {
  private readonly baseDataDir: string;
  private sessionsDir: string;
  private attachedSessions = new Map<string, WebSocket>();

  constructor(dataDir: string) {
    this.baseDataDir = dataDir;
    this.sessionsDir = path.join(dataDir, 'sessions');
  }

  get dataDir(): string {
    return this.baseDataDir;
  }

  async createSession(): Promise<NativeSession> {
    const id = crypto.randomUUID();
    const now = new Date();

    const sessionDir = path.join(this.sessionsDir, id);
    fs.mkdirSync(sessionDir, { recursive: true });

    const metadata: NativeSessionMetadata = {
      id,
      created_at: now.toISOString(),
      last_activity: now.toISOString(),
    };

    fs.writeFileSync(
      path.join(sessionDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
    );

    logger.info('Created native session', { id });

    return {
      id,
      createdAt: now,
      lastActivity: now,
    };
  }

  async listSessions(): Promise<NativeSession[]> {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.sessionsDir, { withFileTypes: true });
    const sessions: NativeSession[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const session = await this.getSession(entry.name);
        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions.sort(
      (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime(),
    );
  }

  async getSession(id: string): Promise<NativeSession | null> {
    const metadataPath = path.join(this.sessionsDir, id, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const metadata: NativeSessionMetadata = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8'),
      );

      return {
        id: metadata.id,
        createdAt: new Date(metadata.created_at),
        lastActivity: new Date(metadata.last_activity),
        sdkSessionId: metadata.sdk_session_id,
      };
    } catch {
      logger.error('Failed to read session metadata', { id });
      return null;
    }
  }

  async deleteSession(id: string): Promise<void> {
    const sessionDir = path.join(this.sessionsDir, id);

    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      logger.info('Deleted native session', { id });
    }

    // Detach if attached
    this.attachedSessions.delete(id);
  }

  async updateSessionActivity(
    id: string,
    sdkSessionId?: string,
  ): Promise<void> {
    const metadataPath = path.join(this.sessionsDir, id, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return;
    }

    try {
      const metadata: NativeSessionMetadata = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8'),
      );

      metadata.last_activity = new Date().toISOString();
      if (sdkSessionId) {
        metadata.sdk_session_id = sdkSessionId;
      }

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      logger.error('Failed to update session activity', { id });
    }
  }

  getSessionDirectory(id: string): string {
    return path.join(this.sessionsDir, id);
  }

  // Attach/detach management
  attach(id: string, ws: WebSocket): void {
    this.attachedSessions.set(id, ws);
    logger.info('Session attached', { id });
  }

  detach(id: string): void {
    this.attachedSessions.delete(id);
    logger.info('Session detached', { id });
  }

  isAttached(id: string): boolean {
    const ws = this.attachedSessions.get(id);
    return ws !== undefined && ws.readyState === 1; // WebSocket.OPEN
  }

  getAttachedSocket(id: string): WebSocket | undefined {
    return this.attachedSessions.get(id);
  }
}
