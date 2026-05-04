// packages/bot-toolkit/src/native/sessionManager.ts

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WebSocket } from 'ws';
import { Logger } from '../utils/logger.js';
import type { NativeSession, NativeSessionMetadata } from './types.js';

const logger = new Logger('NativeSessionManager');
const UUID_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METADATA_FILENAME = 'metadata.json';
const O_NOFOLLOW =
  (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ??
  0;

function isConfinedPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

function chmodBestEffort(targetPath: string, mode: number): void {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // Ignore filesystems that do not support POSIX permissions.
  }
}

function fchmodBestEffort(fd: number, mode: number): void {
  try {
    fs.fchmodSync(fd, mode);
  } catch {
    // Ignore filesystems that do not support POSIX permissions.
  }
}

function readFileDescriptorUtf8(fd: number): string {
  return fs.readFileSync(fd, { encoding: 'utf-8' });
}

export class NativeSessionManager {
  private readonly baseDataDir: string;
  private readonly sessionsDir: string;
  private attachedSessions = new Map<string, WebSocket>();

  constructor(dataDir: string) {
    this.baseDataDir = path.resolve(dataDir);
    this.sessionsDir = path.resolve(this.baseDataDir, 'sessions');
  }

  get dataDir(): string {
    return this.baseDataDir;
  }

  async createSession(): Promise<NativeSession> {
    const id = crypto.randomUUID();
    const now = new Date();

    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    chmodBestEffort(this.sessionsDir, 0o700);

    const sessionDir = this.requireSessionDirectory(id);
    fs.mkdirSync(sessionDir, { mode: 0o700 });
    chmodBestEffort(sessionDir, 0o700);

    const metadata: NativeSessionMetadata = {
      id,
      created_at: now.toISOString(),
      last_activity: now.toISOString(),
    };

    const metadataPath = path.join(sessionDir, METADATA_FILENAME);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    chmodBestEffort(metadataPath, 0o600);

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
    const sessionDir = this.getSafeExistingSessionDirectory(id);
    if (!sessionDir) {
      return null;
    }

    const metadata = this.readSessionMetadata(id, sessionDir);
    if (!metadata) {
      return null;
    }

    return {
      id: metadata.id,
      createdAt: new Date(metadata.created_at),
      lastActivity: new Date(metadata.last_activity),
      sdkSessionId: metadata.sdk_session_id,
    };
  }

  async deleteSession(id: string): Promise<void> {
    const sessionDir = this.getSafeExistingSessionDirectory(id);

    if (sessionDir) {
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
    const sessionDir = this.getSafeExistingSessionDirectory(id);
    if (!sessionDir) {
      return;
    }

    try {
      const metadata = this.readSessionMetadata(id, sessionDir);
      if (!metadata) {
        return;
      }

      metadata.last_activity = new Date().toISOString();
      if (sdkSessionId) {
        metadata.sdk_session_id = sdkSessionId;
      }

      this.writeSessionMetadata(sessionDir, metadata);
    } catch {
      logger.error('Failed to update session activity', { id });
    }
  }

  getSessionDirectory(id: string): string {
    return this.requireSessionDirectory(id);
  }

  private requireSessionDirectory(id: string): string {
    const sessionDir = this.getSafeSessionDirectory(id);
    if (!sessionDir) {
      throw new Error('Invalid native session ID');
    }
    return sessionDir;
  }

  private getSafeSessionDirectory(id: string): string | null {
    if (!UUID_SESSION_ID_PATTERN.test(id)) {
      return null;
    }

    const sessionDir = path.resolve(this.sessionsDir, id);
    if (!isConfinedPath(this.sessionsDir, sessionDir)) {
      return null;
    }

    return sessionDir;
  }

  private getSafeExistingSessionDirectory(id: string): string | null {
    const sessionDir = this.getSafeSessionDirectory(id);
    if (!sessionDir) {
      return null;
    }

    try {
      const sessionStat = fs.lstatSync(sessionDir);
      if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
        return null;
      }

      const realSessionsDir = fs.realpathSync(this.sessionsDir);
      const realSessionDir = fs.realpathSync(sessionDir);
      if (!isConfinedPath(realSessionsDir, realSessionDir)) {
        return null;
      }
    } catch {
      return null;
    }

    return sessionDir;
  }

  private getSafeMetadataPath(sessionDir: string): string | null {
    const metadataPath = path.join(sessionDir, METADATA_FILENAME);

    try {
      const metadataStat = fs.lstatSync(metadataPath);
      if (
        !metadataStat.isFile() ||
        metadataStat.isSymbolicLink() ||
        metadataStat.nlink !== 1
      ) {
        return null;
      }

      const realSessionDir = fs.realpathSync(sessionDir);
      const realMetadataPath = fs.realpathSync(metadataPath);
      if (!isConfinedPath(realSessionDir, realMetadataPath)) {
        return null;
      }
    } catch {
      return null;
    }

    return metadataPath;
  }

  private readSessionMetadata(
    id: string,
    sessionDir: string,
  ): NativeSessionMetadata | null {
    const metadataPath = this.getSafeMetadataPath(sessionDir);
    if (!metadataPath) {
      return null;
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(metadataPath, fs.constants.O_RDONLY | O_NOFOLLOW);
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile() || fdStat.nlink !== 1) {
        return null;
      }

      const metadata: NativeSessionMetadata = JSON.parse(
        readFileDescriptorUtf8(fd),
      );

      if (metadata.id !== id) {
        logger.error('Session metadata ID mismatch', { id });
        return null;
      }

      return metadata;
    } catch {
      logger.error('Failed to read session metadata', { id });
      return null;
    } finally {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    }
  }

  private writeSessionMetadata(
    sessionDir: string,
    metadata: NativeSessionMetadata,
  ): void {
    const metadataPath = this.getSafeMetadataPath(sessionDir);
    if (!metadataPath) {
      return;
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(metadataPath, fs.constants.O_RDWR | O_NOFOLLOW);
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile() || fdStat.nlink !== 1) {
        return;
      }

      const body = `${JSON.stringify(metadata, null, 2)}\n`;
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, body, 0, 'utf-8');
      fchmodBestEffort(fd, 0o600);
    } finally {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    }
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
