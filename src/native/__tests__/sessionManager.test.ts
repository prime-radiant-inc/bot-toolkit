// packages/bot-toolkit/src/native/__tests__/sessionManager.test.ts

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { NativeSessionManager } from '../sessionManager.js';

describe('NativeSessionManager', () => {
  let tempDir: string;
  let manager: NativeSessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-test-'));
    manager = new NativeSessionManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('creates a new session with unique ID', async () => {
      const session = await manager.createSession();

      expect(session.id).toBeDefined();
      expect(session.id.length).toBeGreaterThan(0);
      expect(session.createdAt).toBeInstanceOf(Date);
    });

    it('creates session directory', async () => {
      const session = await manager.createSession();
      const sessionDir = path.join(tempDir, 'sessions', session.id);

      expect(fs.existsSync(sessionDir)).toBe(true);
    });

    it('writes metadata.json', async () => {
      const session = await manager.createSession();
      const metadataPath = path.join(
        tempDir,
        'sessions',
        session.id,
        'metadata.json',
      );

      expect(fs.existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata.id).toBe(session.id);
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions', async () => {
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('returns all sessions', async () => {
      await manager.createSession();
      await manager.createSession();

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('getSession', () => {
    it('returns null for non-existent session', async () => {
      const session = await manager.getSession('nonexistent');
      expect(session).toBeNull();
    });

    it('returns session by ID', async () => {
      const created = await manager.createSession();
      const retrieved = await manager.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });
  });

  describe('deleteSession', () => {
    it('removes session directory', async () => {
      const session = await manager.createSession();
      const sessionDir = path.join(tempDir, 'sessions', session.id);

      await manager.deleteSession(session.id);

      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it('detaches attached session when deleting', async () => {
      const session = await manager.createSession();
      const mockWs = { readyState: 1 } as unknown as WebSocket;

      manager.attach(session.id, mockWs);
      expect(manager.isAttached(session.id)).toBe(true);

      await manager.deleteSession(session.id);

      expect(manager.isAttached(session.id)).toBe(false);
      expect(manager.getAttachedSocket(session.id)).toBeUndefined();
    });
  });

  describe('updateSessionActivity', () => {
    it('updates last_activity timestamp', async () => {
      const session = await manager.createSession();
      const originalActivity = session.lastActivity;

      // Wait a small amount to ensure timestamp differs
      await new Promise((resolve) => setTimeout(resolve, 10));

      await manager.updateSessionActivity(session.id);

      const updated = await manager.getSession(session.id);
      expect(updated).not.toBeNull();
      expect(updated!.lastActivity.getTime()).toBeGreaterThan(
        originalActivity.getTime(),
      );
    });

    it('sets sdk_session_id when provided', async () => {
      const session = await manager.createSession();
      const sdkSessionId = 'sdk-123-456';

      await manager.updateSessionActivity(session.id, sdkSessionId);

      const updated = await manager.getSession(session.id);
      expect(updated).not.toBeNull();
      expect(updated!.sdkSessionId).toBe(sdkSessionId);
    });

    it('handles non-existent session gracefully', async () => {
      // Should not throw
      await expect(
        manager.updateSessionActivity('nonexistent'),
      ).resolves.toBeUndefined();
    });

    it('handles corrupted metadata gracefully', async () => {
      const session = await manager.createSession();
      const metadataPath = path.join(
        tempDir,
        'sessions',
        session.id,
        'metadata.json',
      );

      // Corrupt the metadata file
      fs.writeFileSync(metadataPath, 'invalid json {{{');

      // Should not throw
      await expect(
        manager.updateSessionActivity(session.id),
      ).resolves.toBeUndefined();
    });
  });

  describe('WebSocket attachment methods', () => {
    it('attach() stores websocket for session', async () => {
      const session = await manager.createSession();
      const mockWs = { readyState: 1 } as unknown as WebSocket;

      manager.attach(session.id, mockWs);

      expect(manager.getAttachedSocket(session.id)).toBe(mockWs);
    });

    it('detach() removes websocket for session', async () => {
      const session = await manager.createSession();
      const mockWs = { readyState: 1 } as unknown as WebSocket;

      manager.attach(session.id, mockWs);
      manager.detach(session.id);

      expect(manager.getAttachedSocket(session.id)).toBeUndefined();
    });

    it('isAttached() returns true for attached session with OPEN socket', async () => {
      const session = await manager.createSession();
      const mockWs = { readyState: 1 } as unknown as WebSocket; // 1 = OPEN

      manager.attach(session.id, mockWs);

      expect(manager.isAttached(session.id)).toBe(true);
    });

    it('isAttached() returns false for attached session with non-OPEN socket', async () => {
      const session = await manager.createSession();
      const mockWs = { readyState: 3 } as unknown as WebSocket; // 3 = CLOSED

      manager.attach(session.id, mockWs);

      expect(manager.isAttached(session.id)).toBe(false);
    });

    it('isAttached() returns false for non-attached session', async () => {
      const session = await manager.createSession();

      expect(manager.isAttached(session.id)).toBe(false);
    });

    it('getAttachedSocket() returns undefined for non-attached session', async () => {
      const session = await manager.createSession();

      expect(manager.getAttachedSocket(session.id)).toBeUndefined();
    });
  });
});
