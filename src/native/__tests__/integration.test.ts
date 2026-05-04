// packages/bot-toolkit/src/native/__tests__/integration.test.ts

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { NativeResponder } from '../responder.js';
import { NativeSessionManager } from '../sessionManager.js';

describe('Native Wakeup Integration', () => {
  let tempDir: string;
  let sessionManager: NativeSessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-integration-'));
    sessionManager = new NativeSessionManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles wakeup for detached session', async () => {
    // Create session
    const session = await sessionManager.createSession();

    // Simulate wakeup without attached WebSocket
    const responder = new NativeResponder(session.id, undefined);
    await responder.updateResponse('Wakeup response');

    const response = responder.getAccumulatedResponse();
    expect(response).toBe('Wakeup response');
  });

  it('handles wakeup for attached session', async () => {
    const session = await sessionManager.createSession();

    // Mock WebSocket
    const sentMessages: string[] = [];
    const mockWs = {
      readyState: 1,
      send: (msg: string) => sentMessages.push(msg),
    };

    const ws = mockWs as unknown as WebSocket;
    sessionManager.attach(session.id, ws);

    const responder = new NativeResponder(session.id, ws);
    // updateResponse receives full accumulated text (matching SDK behavior)
    await responder.updateResponse('Hello');
    await responder.updateResponse('Hello World');

    expect(sentMessages).toHaveLength(2);
    expect(JSON.parse(sentMessages[0])).toEqual({
      type: 'text_delta',
      content: 'Hello',
    });
    expect(JSON.parse(sentMessages[1])).toEqual({
      type: 'text_delta',
      content: ' World',
    });
  });
});
