// packages/bot-toolkit/src/core/__tests__/conversationLogger.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationLogger } from '../conversationLogger.js';

const TEST_DIR = '/tmp/bot-toolkit-conversation-logger-test';

describe('ConversationLogger', () => {
  let logger: ConversationLogger;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    logger = new ConversationLogger(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('logIncoming', () => {
    it('should log main channel message to main.md and main.jsonl', async () => {
      await logger.logIncoming({
        platform: 'matrix',
        channelId: 'room123',
        channelName: 'general',
        threadId: null,
        messageId: 'evt_001',
        senderId: 'user_alice',
        senderName: 'Alice',
        text: 'Hello everyone!',
        rawEvent: { type: 'm.room.message', sender: '@alice:matrix.org' },
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const channelDir = path.join(
        TEST_DIR,
        'rooms',
        'matrix',
        'room123',
        'chat-history',
        dateStr,
      );

      // Check markdown file
      const mdFile = path.join(channelDir, 'main.md');
      expect(fs.existsSync(mdFile)).toBe(true);
      const mdContent = fs.readFileSync(mdFile, 'utf-8');
      expect(mdContent).toContain('Alice');
      expect(mdContent).toContain('Hello everyone!');

      // Check JSONL file
      const jsonlFile = path.join(channelDir, 'main.jsonl');
      expect(fs.existsSync(jsonlFile)).toBe(true);
      const jsonlContent = fs.readFileSync(jsonlFile, 'utf-8');
      const entry = JSON.parse(jsonlContent.trim());
      expect(entry.direction).toBe('in');
      expect(entry.message.text).toBe('Hello everyone!');
      expect(entry.rawEvent.type).toBe('m.room.message');
    });

    it('should log thread message to thread-specific files', async () => {
      await logger.logIncoming({
        platform: 'slack',
        channelId: 'C123',
        channelName: 'general',
        threadId: '1234567890.000001',
        messageId: '1234567890.000002',
        senderId: 'U456',
        senderName: 'Bob',
        text: 'Thread reply',
        rawEvent: { ts: '1234567890.000002', thread_ts: '1234567890.000001' },
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const channelDir = path.join(
        TEST_DIR,
        'rooms',
        'slack',
        'c123',
        'chat-history',
        dateStr,
      );

      // Check thread markdown file
      const mdFile = path.join(channelDir, '1234567890.000001.md');
      expect(fs.existsSync(mdFile)).toBe(true);
      const mdContent = fs.readFileSync(mdFile, 'utf-8');
      expect(mdContent).toContain('Bob');
      expect(mdContent).toContain('Thread reply');

      // Check thread JSONL file
      const jsonlFile = path.join(channelDir, '1234567890.000001.jsonl');
      expect(fs.existsSync(jsonlFile)).toBe(true);
    });
  });

  describe('logOutgoing', () => {
    it('should log outgoing message to thread files', async () => {
      await logger.logOutgoing({
        platform: 'matrix',
        channelId: 'room123',
        channelName: 'general',
        threadId: 'thread_001',
        action: 'send',
        text: 'Bot response',
        rawPayload: { body: 'Bot response', msgtype: 'm.text' },
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const channelDir = path.join(
        TEST_DIR,
        'rooms',
        'matrix',
        'room123',
        'chat-history',
        dateStr,
      );

      // Check thread markdown file has assistant message
      const mdFile = path.join(channelDir, 'thread_001.md');
      expect(fs.existsSync(mdFile)).toBe(true);
      const mdContent = fs.readFileSync(mdFile, 'utf-8');
      expect(mdContent).toContain('**Assistant**');
      expect(mdContent).toContain('Bot response');

      // Check JSONL has direction: out
      const jsonlFile = path.join(channelDir, 'thread_001.jsonl');
      const jsonlContent = fs.readFileSync(jsonlFile, 'utf-8');
      const entry = JSON.parse(jsonlContent.trim());
      expect(entry.direction).toBe('out');
      expect(entry.action).toBe('send');
    });
  });
});
