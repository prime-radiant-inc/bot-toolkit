// packages/bot-toolkit/src/native/__tests__/responder.test.ts

import { describe, expect, it, vi } from 'vitest';
import { NativeResponder } from '../responder.js';

describe('NativeResponder', () => {
  describe('updateResponse', () => {
    it('sends text_delta to WebSocket when attached', async () => {
      const mockWs = {
        readyState: 1, // OPEN
        send: vi.fn(),
      };

      const responder = new NativeResponder('test-session', mockWs as any);
      await responder.updateResponse('Hello');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'text_delta', content: 'Hello' }),
      );
    });

    it('does not throw when detached', async () => {
      const responder = new NativeResponder('test-session', undefined);

      await expect(responder.updateResponse('Hello')).resolves.not.toThrow();
    });

    it('accumulates response text from full-text updates', async () => {
      const responder = new NativeResponder('test-session', undefined);

      // updateResponse receives full accumulated text (matching SDK behavior)
      await responder.updateResponse('Hello ');
      await responder.updateResponse('Hello World');

      expect(responder.getAccumulatedResponse()).toBe('Hello World');
    });

    it('computes deltas from full accumulated text', async () => {
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };

      const responder = new NativeResponder('test-session', mockWs as any);

      await responder.updateResponse('Hello ');
      await responder.updateResponse('Hello World');

      expect(mockWs.send).toHaveBeenCalledTimes(2);
      expect(mockWs.send).toHaveBeenNthCalledWith(
        1,
        JSON.stringify({ type: 'text_delta', content: 'Hello ' }),
      );
      expect(mockWs.send).toHaveBeenNthCalledWith(
        2,
        JSON.stringify({ type: 'text_delta', content: 'World' }),
      );
    });

    it('skips send when text has not changed', async () => {
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };

      const responder = new NativeResponder('test-session', mockWs as any);

      await responder.updateResponse('Hello');
      await responder.updateResponse('Hello'); // duplicate (from onText after onTextDelta)

      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendNotice', () => {
    it('sends notice to WebSocket', async () => {
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };

      const responder = new NativeResponder('test-session', mockWs as any);
      await responder.sendNotice('Context compacted');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'notice', content: 'Context compacted' }),
      );
    });
  });
});
