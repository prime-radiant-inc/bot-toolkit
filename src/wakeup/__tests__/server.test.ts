import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { SessionDatabase } from '../../core/database.js';
import type { PlatformAdapter, WakeupPayload } from '../../core/types.js';
import type { NativeSessionManager } from '../../native/sessionManager.js';
import { createWakeupServer } from '../server.js';

function makeAdapter(): PlatformAdapter & {
  handleWakeup: ReturnType<typeof vi.fn>;
} {
  return {
    platform: 'native',
    start: vi.fn(),
    stop: vi.fn(),
    stopListening: vi.fn(),
    sendRecoveryNotice: vi.fn(),
    handleWakeup: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlatformAdapter & { handleWakeup: ReturnType<typeof vi.fn> };
}

function makePayload(
  overrides: Partial<WakeupPayload & { room_id: string }> = {},
): WakeupPayload {
  return {
    room_id: 'native:session-1',
    prompt: 'wake me up',
    idempotency_key: 'wake-1',
    job_id: 'job-1',
    scheduled_at: '2026-05-03T00:00:00.000Z',
    triggered_at: '2026-05-03T00:00:01.000Z',
    ...overrides,
  };
}

async function listen(app: ReturnType<typeof createWakeupServer>) {
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function baseUrl(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('missing port');
  }
  return `http://127.0.0.1:${address.port}`;
}

function wsUrl(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('missing port');
  }
  return `ws://127.0.0.1:${address.port}`;
}

describe('createWakeupServer', () => {
  it('requires auth token for non-loopback hosts', () => {
    expect(() =>
      createWakeupServer({
        adapters: new Map([['native', makeAdapter()]]),
        host: '0.0.0.0',
      }),
    ).toThrow('authToken is required when wakeup server host is not loopback');
  });

  it('rejects /wakeup without bearer auth when auth token is configured', async () => {
    const adapter = makeAdapter();
    const app = createWakeupServer({
      adapters: new Map([['native', adapter]]),
      authToken: 'secret-token',
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/wakeup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makePayload()),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
      expect(adapter.handleWakeup).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('accepts /wakeup with matching bearer auth', async () => {
    const adapter = makeAdapter();
    const app = createWakeupServer({
      adapters: new Map([['native', adapter]]),
      authToken: 'secret-token',
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/wakeup`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-token',
        },
        body: JSON.stringify(makePayload()),
      });

      expect(response.status).toBe(202);
      await vi.waitFor(() => {
        expect(adapter.handleWakeup).toHaveBeenCalledTimes(1);
      });
    } finally {
      await close(server);
    }
  });

  it('rejects /notify without bearer auth when auth token is configured', async () => {
    const adapter = makeAdapter();
    const app = createWakeupServer({
      adapters: new Map([['native', adapter]]),
      authToken: 'secret-token',
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room_id: 'native:session-1', message: 'hello' }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
      expect(adapter.handleWakeup).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('rejects native HTTP routes without bearer auth when auth token is configured', async () => {
    const listSessions = vi.fn().mockResolvedValue([]);
    const app = createWakeupServer({
      adapters: new Map([['native', makeAdapter()]]),
      authToken: 'secret-token',
      nativeSessionManager: {
        listSessions,
        isAttached: vi.fn(),
      } as unknown as NativeSessionManager,
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/native/sessions`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
      expect(listSessions).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('rejects native WebSocket attach without bearer auth when auth token is configured', async () => {
    const getSession = vi.fn().mockResolvedValue({ id: 'session-1' });
    const app = createWakeupServer({
      adapters: new Map([['native', makeAdapter()]]),
      authToken: 'secret-token',
      nativeSessionManager: {
        getSession,
        detach: vi.fn(),
        getAttachedSocket: vi.fn(),
        attach: vi.fn(),
        updateSessionActivity: vi.fn(),
      } as unknown as NativeSessionManager,
      orchestrator: {
        handleMessage: vi.fn(),
      },
    });

    const server = await listen(app);
    try {
      const ws = new WebSocket(
        `${wsUrl(server)}/native/sessions/session-1/attach`,
      );
      const closeEvent = await new Promise<{ code: number; reason: string }>(
        (resolve, reject) => {
          ws.on('close', (code, reason) => {
            resolve({ code, reason: reason.toString() });
          });
          ws.on('error', reject);
        },
      );

      expect(closeEvent).toEqual({ code: 4001, reason: 'Unauthorized' });
      expect(getSession).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('does not check or mark idempotency for wakeups without room_id', async () => {
    const adapter = makeAdapter();
    const database = {
      cleanOldWakeups: vi.fn(),
      isWakeupProcessed: vi.fn().mockReturnValue(false),
      markWakeupProcessed: vi.fn(),
    };
    const app = createWakeupServer({
      adapters: new Map([['native', adapter]]),
      database: database as unknown as SessionDatabase,
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/wakeup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makePayload({ room_id: '' })),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        status: 'error',
        error: 'room_id is required',
      });
      expect(database.isWakeupProcessed).not.toHaveBeenCalled();
      expect(database.markWakeupProcessed).not.toHaveBeenCalled();
      expect(adapter.handleWakeup).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('does not check or mark idempotency for wakeups without idempotency_key', async () => {
    const adapter = makeAdapter();
    const database = {
      cleanOldWakeups: vi.fn(),
      isWakeupProcessed: vi.fn().mockReturnValue(false),
      markWakeupProcessed: vi.fn(),
    };
    const app = createWakeupServer({
      adapters: new Map([['native', adapter]]),
      database: database as unknown as SessionDatabase,
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/wakeup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makePayload({ idempotency_key: '' })),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        status: 'error',
        error: 'idempotency_key is required',
      });
      expect(database.isWakeupProcessed).not.toHaveBeenCalled();
      expect(database.markWakeupProcessed).not.toHaveBeenCalled();
      expect(adapter.handleWakeup).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('rejects unsupported Matrix room IDs even if a similarly named adapter is present', async () => {
    const adapter = makeAdapter();
    const app = createWakeupServer({
      adapters: new Map([
        ['native', makeAdapter()],
        ['matrix', adapter],
      ]),
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/wakeup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makePayload({ room_id: 'matrix:room-1' })),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        status: 'error',
        error: 'Unknown platform: unknown. Valid platforms: native',
      });
      expect(adapter.handleWakeup).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});
