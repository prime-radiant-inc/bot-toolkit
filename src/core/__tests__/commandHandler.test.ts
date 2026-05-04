import { describe, expect, it, vi } from 'vitest';
import { CommandHandler } from '../commandHandler.js';
import type { PlatformResponder } from '../types.js';

describe('CommandHandler', () => {
  describe('parse', () => {
    const handler = new CommandHandler();

    it('should parse /new command', () => {
      const result = handler.parse('/new My Topic');
      expect(result).toEqual({ command: 'new', args: 'My Topic' });
    });

    it('should parse /new without args', () => {
      const result = handler.parse('/new');
      expect(result).toEqual({ command: 'new', args: '' });
    });

    it('should parse /clear command', () => {
      const result = handler.parse('/clear');
      expect(result).toEqual({ command: 'clear', args: '' });
    });

    it('should parse /compact command', () => {
      const result = handler.parse('/compact');
      expect(result).toEqual({ command: 'compact', args: '' });
    });

    it('should return null for non-commands', () => {
      expect(handler.parse('hello world')).toBeNull();
      expect(handler.parse('not/a/command')).toBeNull();
      expect(handler.parse('/unknown')).toBeNull();
    });
  });

  describe('handle', () => {
    it('should handle /new command', async () => {
      const handler = new CommandHandler();
      const responder = {
        createThreadStarter: vi.fn().mockResolvedValue('thread-123'),
      } as unknown as PlatformResponder;

      const handled = await handler.handle(
        { command: 'new', args: 'Test Topic' },
        responder,
      );

      expect(handled).toBe(true);
      expect(responder.createThreadStarter).toHaveBeenCalledWith('Test Topic');
    });

    it('should use default topic for /new without args', async () => {
      const handler = new CommandHandler();
      const responder = {
        createThreadStarter: vi.fn().mockResolvedValue('thread-123'),
      } as unknown as PlatformResponder;

      await handler.handle({ command: 'new', args: '' }, responder);

      expect(responder.createThreadStarter).toHaveBeenCalledWith(
        'New conversation',
      );
    });

    it('should handle /clear command', async () => {
      const handler = new CommandHandler();
      const responder = {
        sendNotice: vi.fn().mockResolvedValue(undefined),
      } as unknown as PlatformResponder;

      const handled = await handler.handle(
        { command: 'clear', args: '' },
        responder,
      );

      expect(handled).toBe(true);
      expect(responder.sendNotice).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
    });

    it('should handle /compact command', async () => {
      const handler = new CommandHandler();
      const responder = {
        sendNotice: vi.fn().mockResolvedValue(undefined),
      } as unknown as PlatformResponder;

      const handled = await handler.handle(
        { command: 'compact', args: '' },
        responder,
      );

      expect(handled).toBe(true);
      expect(responder.sendNotice).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
    });
  });
});
