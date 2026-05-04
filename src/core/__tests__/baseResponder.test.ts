import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseResponder } from '../baseResponder.js';
import type { SessionStats } from '../types.js';

// Concrete test implementation
class TestResponder extends BaseResponder {
  public sentMessages: string[] = [];
  public editedMessages: string[] = [];
  public processingMarked = false;
  public processingCleared = false;
  public errorMarked = false;

  async markProcessing(): Promise<void> {
    this.processingMarked = true;
  }

  async clearProcessing(): Promise<void> {
    this.processingCleared = true;
  }

  async markError(): Promise<void> {
    this.errorMarked = true;
  }

  async sendNotice(text: string): Promise<void> {
    this.sentMessages.push(`notice:${text}`);
  }

  async sendFile(localPath: string): Promise<void> {
    this.sentMessages.push(`file:${localPath}`);
  }

  async setTyping(): Promise<void> {}

  async updateChannelStats(): Promise<void> {}

  async createThreadStarter(topic: string): Promise<string> {
    return `thread-${topic}`;
  }

  protected async sendNewMessage(text: string): Promise<string> {
    this.sentMessages.push(text);
    return 'msg-1';
  }

  protected async editMessage(text: string): Promise<void> {
    this.editedMessages.push(text);
  }
}

describe('BaseResponder', () => {
  let responder: TestResponder;

  beforeEach(() => {
    responder = new TestResponder();
    vi.useFakeTimers();
  });

  describe('updateResponse', () => {
    it('sends new message on first call', async () => {
      await responder.updateResponse('Hello');

      expect(responder.sentMessages).toEqual(['Hello']);
      expect(responder.editedMessages).toEqual([]);
    });

    it('edits message on subsequent calls at sentence boundary after min interval', async () => {
      await responder.updateResponse('Hello');
      vi.advanceTimersByTime(900); // Past MIN_UPDATE_MS (800)
      await responder.updateResponse('Hello World. '); // Sentence boundary

      expect(responder.sentMessages).toEqual(['Hello']);
      expect(responder.editedMessages).toEqual(['Hello World. ']);
    });

    it('throttles rapid updates', async () => {
      await responder.updateResponse('A');
      await responder.updateResponse('AB');
      await responder.updateResponse('ABC');

      // Only first should go through, rest throttled
      expect(responder.sentMessages).toEqual(['A']);
      expect(responder.editedMessages).toEqual([]);
    });

    it('does not update mid-sentence between min and max interval', async () => {
      await responder.updateResponse('Hello');
      vi.advanceTimersByTime(1500); // Between MIN (800) and MAX (4000)
      await responder.updateResponse('Hello World continues');

      expect(responder.sentMessages).toEqual(['Hello']);
      expect(responder.editedMessages).toEqual([]);
    });

    it('forces update after maximum interval without sentence boundary', async () => {
      await responder.updateResponse('Hello');
      vi.advanceTimersByTime(4100); // Past MAX_UPDATE_MS (4000)
      await responder.updateResponse('Still going without punctuation');

      expect(responder.sentMessages).toEqual(['Hello']);
      expect(responder.editedMessages).toEqual([
        'Still going without punctuation',
      ]);
    });

    it('updates at paragraph boundary (double newline)', async () => {
      await responder.updateResponse('Hello');
      vi.advanceTimersByTime(900); // Past MIN
      await responder.updateResponse('First paragraph\n\n');

      expect(responder.sentMessages).toEqual(['Hello']);
      expect(responder.editedMessages).toEqual(['First paragraph\n\n']);
    });

    it('always tracks lastText for finalize', async () => {
      await responder.updateResponse('A');
      await responder.updateResponse('AB');
      await responder.updateResponse('ABC');

      await responder.finalizeResponse();

      expect(responder.editedMessages).toEqual(['ABC']);
    });
  });

  describe('finalizeResponse', () => {
    it('forces update bypassing throttle', async () => {
      await responder.updateResponse('Start');
      await responder.updateResponse('Final'); // Throttled

      await responder.finalizeResponse();

      expect(responder.editedMessages).toEqual(['Final']);
    });

    it('does nothing if no response started', async () => {
      await responder.finalizeResponse();

      expect(responder.editedMessages).toEqual([]);
    });
  });

  describe('responseId', () => {
    it('is null before any response', () => {
      expect(responder.responseId).toBeNull();
    });

    it('returns message ID after first updateResponse', async () => {
      await responder.updateResponse('Hello');

      expect(responder.responseId).toBe('msg-1');
    });
  });

  describe('cancelled flag', () => {
    it('blocks updateResponse — no message sent or lastText updated', async () => {
      responder.cancelled = true;
      await responder.updateResponse('Should not appear');

      expect(responder.sentMessages).toEqual([]);
      expect(responder.editedMessages).toEqual([]);
    });

    it('blocks finalizeResponse — no edit sent', async () => {
      await responder.updateResponse('Start');
      responder.cancelled = true;
      await responder.updateResponse('More'); // blocked
      await responder.finalizeResponse(); // blocked

      expect(responder.sentMessages).toEqual(['Start']);
      expect(responder.editedMessages).toEqual([]);
    });
  });

  describe('appendCancellationNotice', () => {
    it('edits existing response with notice appended', async () => {
      await responder.updateResponse('Working on it...');
      await responder.appendCancellationNotice('Task was cancelled.');

      expect(responder.editedMessages).toEqual([
        'Working on it...\n\n---\nTask was cancelled.',
      ]);
    });

    it('sends new message when no response exists', async () => {
      await responder.appendCancellationNotice('Task was cancelled.');

      expect(responder.sentMessages).toEqual(['Task was cancelled.']);
      expect(responder.responseId).toBe('msg-1');
    });
  });

  describe('onFirstOutput callback', () => {
    it('fires on first currentResponseId assignment', async () => {
      const callback = vi.fn();
      responder.setOnFirstOutput(callback);

      await responder.updateResponse('Hello');

      expect(callback).toHaveBeenCalledOnce();
    });

    it('fires only once across multiple updates', async () => {
      const callback = vi.fn();
      responder.setOnFirstOutput(callback);

      await responder.updateResponse('Hello');
      vi.advanceTimersByTime(2000);
      await responder.updateResponse('World');

      expect(callback).toHaveBeenCalledOnce();
    });

    it('does not fire if cancelled before first output', async () => {
      const callback = vi.fn();
      responder.setOnFirstOutput(callback);
      responder.cancelled = true;

      await responder.updateResponse('Hello');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('responseText', () => {
    it('is null before any response', () => {
      expect(responder.responseText).toBeNull();
    });

    it('returns latest text after updates', async () => {
      await responder.updateResponse('Hello');
      await responder.updateResponse('Hello World');

      expect(responder.responseText).toBe('Hello World');
    });
  });

  describe('formatStatsTopic', () => {
    it('formats stats correctly', () => {
      const stats: SessionStats = {
        contextTokens: 50000,
        outputTokens: 1000,
        costUsd: 0.25,
        durationMs: 5000,
        compactionCount: 0,
      };

      const result = responder.formatStatsTopic(stats);

      expect(result).toBe('📊 50k/200k (25%) | $0.25 | SDK');
    });

    it('rounds tokens correctly', () => {
      const stats: SessionStats = {
        contextTokens: 123456,
        outputTokens: 0,
        costUsd: 1.234,
        durationMs: 0,
        compactionCount: 0,
      };

      const result = responder.formatStatsTopic(stats);

      expect(result).toBe('📊 123k/200k (62%) | $1.23 | SDK');
    });
  });
});
