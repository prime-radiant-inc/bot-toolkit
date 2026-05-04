// packages/bot-toolkit/src/core/__tests__/orchestrator.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationOrchestrator } from '../orchestrator.js';
import type { ITaskRegistry } from '../taskRegistry.types.js';
import type { IncomingMessage, SessionStats } from '../types.js';

// Unique ID counter to prevent thread lock collisions across tests
let idCounter = 0;
function uniqueId(prefix = 'msg'): string {
  return `${prefix}_${++idCounter}_${Date.now()}`;
}

function makeStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    contextTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    durationMs: 500,
    compactionCount: 0,
    ...overrides,
  };
}

function makeMockSessionManager(overrides: Record<string, unknown> = {}) {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      sessionId: 'sess_1',
      text: 'Response',
      stats: makeStats(),
    }),
    getSessionFromEvent: vi.fn().mockReturnValue(null),
    saveEventSession: vi.fn(),
    deleteEventSession: vi.fn(),
    ...overrides,
  };
}

function makeMockDatabase(overrides: Record<string, unknown> = {}) {
  return {
    isEventProcessed: vi.fn().mockReturnValue(false),
    markEventProcessed: vi.fn(),
    ...overrides,
  };
}

function makeMockLogger() {
  return {
    logIncoming: vi.fn(),
    logOutgoing: vi.fn(),
  };
}

function makeMockResponder(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    markProcessing: vi.fn(),
    clearProcessing: vi.fn(),
    setTyping: vi.fn(),
    updateResponse: vi.fn(),
    finalizeResponse: vi.fn(),
    sendNotice: vi.fn(),
    updateChannelStats: vi.fn(),
    markError: vi.fn(),
    sendFile: vi.fn(),
    createThreadStarter: vi.fn().mockResolvedValue('thread-id'),
    recordToolUse: vi.fn(),
  };
}

function makeMessage(
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    platform: 'matrix',
    channelId: 'room123',
    channelName: 'general',
    threadId: null,
    messageId: uniqueId(),
    senderId: 'user_1',
    text: 'Hello',
    attachments: [],
    ...overrides,
  };
}

function makeMockTaskRegistry(
  overrides: Partial<ITaskRegistry> = {},
): ITaskRegistry {
  return {
    register: vi.fn(),
    complete: vi.fn(),
    markError: vi.fn(),
    cancel: vi.fn(),
    heartbeat: vi.fn(),
    setHadVisibleOutput: vi.fn(),
    getActive: vi.fn().mockReturnValue([]),
    getRecent: vi.fn().mockReturnValue([]),
    getEntry: vi.fn().mockReturnValue(null),
    getLiveEntry: vi.fn().mockReturnValue(undefined),
    removeLiveEntry: vi.fn(),
    abortAll: vi.fn().mockResolvedValue(undefined),
    markInterruptedShutdown: vi.fn(),
    recoverInterruptedTasks: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    ...overrides,
  };
}

function makeOrchestrator(
  overrides: {
    sessionManager?: Record<string, unknown>;
    database?: Record<string, unknown>;
    logger?: Record<string, unknown>;
    contextStore?: Record<string, unknown>;
    taskRegistry?: ITaskRegistry;
  } = {},
) {
  const sessionManager = makeMockSessionManager(overrides.sessionManager);
  const database = makeMockDatabase(overrides.database);
  const logger = overrides.logger ?? makeMockLogger();
  const contextStore = overrides.contextStore;
  const taskRegistry = overrides.taskRegistry;

  const orchestrator = new ConversationOrchestrator({
    dataDir: '/tmp/test',
    sessionManager: sessionManager as any,
    database: database as any,
    conversationLogger: logger as any,
    ...(contextStore && { contextStore: contextStore as any }),
    ...(taskRegistry && { taskRegistry }),
  });

  return { orchestrator, sessionManager, database, logger, taskRegistry };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConversationOrchestrator', () => {
  describe('deduplication', () => {
    it('should skip already-processed messages', async () => {
      const { orchestrator, sessionManager } = makeOrchestrator({
        database: { isEventProcessed: vi.fn().mockReturnValue(true) },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      expect(responder.markProcessing).not.toHaveBeenCalled();
    });

    it('should mark message as processed immediately', async () => {
      const database = makeMockDatabase();
      const { orchestrator } = makeOrchestrator({ database });
      const responder = makeMockResponder();
      const msg = makeMessage();

      await orchestrator.handleMessage(msg, responder as any);

      expect(database.markEventProcessed).toHaveBeenCalledWith(
        msg.messageId,
        msg.channelId,
      );
    });

    it('should delegate isMessageProcessed to database', () => {
      const database = makeMockDatabase({
        isEventProcessed: vi.fn().mockReturnValue(true),
      });
      const { orchestrator } = makeOrchestrator({ database });

      expect(orchestrator.isMessageProcessed('evt_123')).toBe(true);
      expect(database.isEventProcessed).toHaveBeenCalledWith('evt_123');
    });
  });

  describe('slash commands', () => {
    it('should handle /new command without calling Claude', async () => {
      const { orchestrator, sessionManager } = makeOrchestrator();
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: '/new My Topic' }),
        responder as any,
      );

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      expect(responder.createThreadStarter).toHaveBeenCalledWith('My Topic');
    });

    it('should handle /clear command without calling Claude', async () => {
      const { orchestrator, sessionManager } = makeOrchestrator();
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: '/clear' }),
        responder as any,
      );

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      expect(responder.sendNotice).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
    });

    it('should handle /compact command without calling Claude', async () => {
      const { orchestrator, sessionManager } = makeOrchestrator();
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: '/compact' }),
        responder as any,
      );

      expect(sessionManager.sendMessage).not.toHaveBeenCalled();
      expect(responder.sendNotice).toHaveBeenCalledWith(
        expect.stringContaining('automatic'),
      );
    });

    it('should pass non-command messages to Claude', async () => {
      const { orchestrator, sessionManager } = makeOrchestrator();
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: 'just a normal message' }),
        responder as any,
      );

      expect(sessionManager.sendMessage).toHaveBeenCalled();
    });
  });

  describe('responder lifecycle', () => {
    it('should call markProcessing and setTyping(true) before sendMessage', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      const callOrder: string[] = [];
      responder.markProcessing.mockImplementation(async () => {
        callOrder.push('markProcessing');
      });
      responder.setTyping.mockImplementation(async (typing: boolean) => {
        callOrder.push(`setTyping(${typing})`);
      });
      sessionManager.sendMessage.mockImplementation(async () => {
        callOrder.push('sendMessage');
        return { sessionId: 'sess_1', text: 'ok', stats: makeStats() };
      });

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(callOrder.indexOf('markProcessing')).toBeLessThan(
        callOrder.indexOf('sendMessage'),
      );
      expect(callOrder.indexOf('setTyping(true)')).toBeLessThan(
        callOrder.indexOf('sendMessage'),
      );
    });

    it('should call finalizeResponse, setTyping(false), and clearProcessing after sendMessage', async () => {
      const { orchestrator } = makeOrchestrator();
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.finalizeResponse).toHaveBeenCalled();
      expect(responder.setTyping).toHaveBeenCalledWith(false);
      expect(responder.clearProcessing).toHaveBeenCalled();
    });

    it('should call updateChannelStats with session stats', async () => {
      const stats = makeStats({ contextTokens: 5000, compactionCount: 2 });
      const { orchestrator } = makeOrchestrator({
        sessionManager: {
          sendMessage: vi.fn().mockResolvedValue({
            sessionId: 'sess_1',
            text: 'ok',
            stats,
          }),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.updateChannelStats).toHaveBeenCalledWith(stats);
    });
  });

  describe('error handling', () => {
    it('should call markError and sendNotice on sendMessage failure', async () => {
      const { orchestrator } = makeOrchestrator({
        sessionManager: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Claude blew up')),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.markError).toHaveBeenCalled();
      expect(responder.sendNotice).toHaveBeenCalledWith(
        expect.stringContaining('error'),
      );
    });

    it('should stop typing and clear processing on error', async () => {
      const { orchestrator } = makeOrchestrator({
        sessionManager: {
          sendMessage: vi.fn().mockRejectedValue(new Error('fail')),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.setTyping).toHaveBeenCalledWith(false);
      expect(responder.clearProcessing).toHaveBeenCalled();
    });

    it('should not call finalizeResponse or updateChannelStats on error', async () => {
      const { orchestrator } = makeOrchestrator({
        sessionManager: {
          sendMessage: vi.fn().mockRejectedValue(new Error('fail')),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.finalizeResponse).not.toHaveBeenCalled();
      expect(responder.updateChannelStats).not.toHaveBeenCalled();
    });
  });

  describe('session resumption', () => {
    it('should look up existing session when threadId is present', async () => {
      const sessionManager = makeMockSessionManager({
        getSessionFromEvent: vi.fn().mockReturnValue({
          sessionId: 'existing_sess',
          compactionCount: 3,
        }),
      });
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ threadId: 'thread_root_1' }),
        responder as any,
      );

      expect(sessionManager.getSessionFromEvent).toHaveBeenCalledWith(
        'thread_root_1',
      );
      // 6th arg (resumeSession) should contain the existing session
      const callArgs = sessionManager.sendMessage.mock.calls[0];
      expect(callArgs?.[5]).toEqual({
        sessionId: 'existing_sess',
        compactionCount: 3,
      });
    });

    it('should not pass resumeSession when threadId is null', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ threadId: null }),
        responder as any,
      );

      expect(sessionManager.getSessionFromEvent).not.toHaveBeenCalled();
      // 6th arg (resumeSession) should be undefined
      const callArgs = sessionManager.sendMessage.mock.calls[0];
      expect(callArgs?.[5]).toBeUndefined();
    });

    it('should not pass resumeSession when no existing session found', async () => {
      const sessionManager = makeMockSessionManager({
        getSessionFromEvent: vi.fn().mockReturnValue(null),
      });
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ threadId: 'new_thread' }),
        responder as any,
      );

      // 6th arg (resumeSession) should be undefined
      const callArgs = sessionManager.sendMessage.mock.calls[0];
      expect(callArgs?.[5]).toBeUndefined();
    });
  });

  describe('session saving', () => {
    it('should eagerly save session with zero stats in onSessionStart', async () => {
      const saveCallArgs: unknown[][] = [];
      const sessionManager = makeMockSessionManager();
      sessionManager.saveEventSession.mockImplementation(
        (...args: unknown[]) => {
          saveCallArgs.push(args);
        },
      );
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('early_sess');
          return {
            sessionId: 'early_sess',
            text: 'ok',
            stats: makeStats({ contextTokens: 5000, compactionCount: 2 }),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ threadId: 'thread_eager' }),
        responder as any,
      );

      // First save should be the eager one with zero stats
      expect(saveCallArgs[0]).toEqual([
        'thread_eager',
        'room123',
        'early_sess',
        0,
        0,
      ]);
    });

    it('should upsert real stats after completion (two-phase save)', async () => {
      const saveCallArgs: unknown[][] = [];
      const sessionManager = makeMockSessionManager();
      sessionManager.saveEventSession.mockImplementation(
        (...args: unknown[]) => {
          saveCallArgs.push(args);
        },
      );
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('new_sess');
          return {
            sessionId: 'new_sess',
            text: 'ok',
            stats: makeStats({ contextTokens: 2000, compactionCount: 1 }),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ threadId: 'thread_42' }),
        responder as any,
      );

      // Should have been called twice: eager (zeros) + final (real stats)
      expect(saveCallArgs).toHaveLength(2);
      expect(saveCallArgs[0]).toEqual([
        'thread_42',
        'room123',
        'new_sess',
        0,
        0,
      ]);
      expect(saveCallArgs[1]).toEqual([
        'thread_42',
        'room123',
        'new_sess',
        2000,
        1,
      ]);
    });

    it('should eagerly save with messageId as threadRootId when threadId is null', async () => {
      const saveCallArgs: unknown[][] = [];
      const sessionManager = makeMockSessionManager();
      sessionManager.saveEventSession.mockImplementation(
        (...args: unknown[]) => {
          saveCallArgs.push(args);
        },
      );
      const msg = makeMessage({ threadId: null });
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_no_thread');
          return {
            sessionId: 'sess_no_thread',
            text: 'ok',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(msg, responder as any);

      // First save should use messageId as threadRootId
      expect(saveCallArgs[0]).toEqual([
        msg.messageId,
        'room123',
        'sess_no_thread',
        0,
        0,
      ]);
    });

    it('should preserve eager save when sendMessage throws after onSessionStart', async () => {
      const saveCallArgs: unknown[][] = [];
      const sessionManager = makeMockSessionManager();
      sessionManager.saveEventSession.mockImplementation(
        (...args: unknown[]) => {
          saveCallArgs.push(args);
        },
      );
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('doomed_sess');
          throw new Error('SIGTERM or network failure');
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ threadId: 'thread_doomed' }),
        responder as any,
      );

      // Eager save should be the ONLY save (post-completion never reached)
      expect(saveCallArgs).toHaveLength(1);
      expect(saveCallArgs[0]).toEqual([
        'thread_doomed',
        'room123',
        'doomed_sess',
        0,
        0,
      ]);
    });

    it('should not save session when onSessionStart is never invoked', async () => {
      // When sendMessage resolves without invoking onSessionStart
      // (e.g. sessionId undefined), no saves should happen
      const sessionManager = makeMockSessionManager({
        sendMessage: vi.fn().mockResolvedValue({
          sessionId: undefined,
          text: 'ok',
          stats: makeStats(),
        }),
      });
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      // No onSessionStart was invoked by the mock, AND result.sessionId is
      // undefined so the post-completion save is also skipped
      expect(sessionManager.saveEventSession).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log incoming message with attachment metadata', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({ logger });
      const responder = makeMockResponder();

      const msg = makeMessage({
        attachments: [
          {
            localPath: '/tmp/photo.jpg',
            originalName: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 12345,
          },
        ],
      });

      await orchestrator.handleMessage(msg, responder as any);

      expect(logger.logIncoming).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            { name: 'photo.jpg', mimeType: 'image/jpeg', size: 12345 },
          ],
        }),
      );
    });

    it('should log outgoing response with sessionId', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({
        logger,
        sessionManager: {
          sendMessage: vi.fn().mockResolvedValue({
            sessionId: 'sess_log',
            text: 'Hello!',
            stats: makeStats(),
          }),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(logger.logOutgoing).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello!',
          rawPayload: { sessionId: 'sess_log' },
        }),
      );
    });

    it('should not log outgoing when result has no text', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({
        logger,
        sessionManager: {
          sendMessage: vi.fn().mockResolvedValue({
            sessionId: 'sess_1',
            text: '',
            stats: makeStats(),
          }),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(logger.logOutgoing).not.toHaveBeenCalled();
    });

    it('should pass rawEvent to logIncoming when provided', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({ logger });
      const responder = makeMockResponder();
      const rawEvent = { type: 'm.room.message', event_id: '$xyz' };

      await orchestrator.handleMessage(
        makeMessage(),
        responder as any,
        rawEvent,
      );

      expect(logger.logIncoming).toHaveBeenCalledWith(
        expect.objectContaining({ rawEvent }),
      );
    });

    it('should pass empty object as rawEvent when not provided', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({ logger });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(logger.logIncoming).toHaveBeenCalledWith(
        expect.objectContaining({ rawEvent: {} }),
      );
    });

    it('should use senderName in logger when present', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({ logger });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ senderId: 'U123', senderName: 'Drew Ritter' }),
        responder as any,
      );

      expect(logger.logIncoming).toHaveBeenCalledWith(
        expect.objectContaining({ senderName: 'Drew Ritter' }),
      );
    });

    it('should fall back to senderId in logger when senderName is absent', async () => {
      const logger = makeMockLogger();
      const { orchestrator } = makeOrchestrator({ logger });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ senderId: 'U123' }),
        responder as any,
      );

      expect(logger.logIncoming).toHaveBeenCalledWith(
        expect.objectContaining({ senderName: 'U123' }),
      );
    });
  });

  describe('context building', () => {
    it('should append attachment info to message text', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          text: 'Check this file',
          attachments: [
            {
              localPath: '/tmp/doc.pdf',
              originalName: 'doc.pdf',
              mimeType: 'application/pdf',
              size: 99999,
            },
          ],
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).toContain('Check this file');
      expect(sentMessage).toContain('<attachment>');
      expect(sentMessage).toContain('doc.pdf');
      expect(sentMessage).toContain('application/pdf');
      expect(sentMessage).toContain('99999 bytes');
      expect(sentMessage).toContain('/tmp/doc.pdf');
    });

    it('should prepend context from contextStore', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        contextStore: {
          formatForClaude: vi
            .fn()
            .mockReturnValue('Timezone: US/Eastern\nTime: 3pm'),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: 'What time is it?' }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).toContain('<current-context>');
      expect(sentMessage).toContain('Timezone: US/Eastern');
      expect(sentMessage).toContain('</current-context>');
      expect(sentMessage).toContain('What time is it?');
      // Context should come before the message
      expect(sentMessage.indexOf('<current-context>')).toBeLessThan(
        sentMessage.indexOf('What time is it?'),
      );
    });

    it('should include outbox path even when contextStore returns empty string', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        contextStore: { formatForClaude: vi.fn().mockReturnValue('') },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: 'Hello' }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).toContain('<current-context>');
      expect(sentMessage).toContain('Outbox path:');
      expect(sentMessage).toContain('/outbox/');
      expect(sentMessage).toContain('Hello');
    });

    it('should prepend sender tag when senderName is present', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U123',
          senderName: 'Drew Ritter',
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).toContain('<sender id="U123">Drew Ritter</sender>');
      expect(sentMessage).toContain('Hello');
      // Sender tag should come before message text
      expect(sentMessage.indexOf('<sender')).toBeLessThan(
        sentMessage.indexOf('Hello'),
      );
    });

    it('should not include sender tag when senderName is absent', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: 'Hello' }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).not.toContain('<sender');
    });

    it('should place sender tag before context tag', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        contextStore: {
          formatForClaude: vi.fn().mockReturnValue('Timezone: US/Eastern'),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U123',
          senderName: 'Drew Ritter',
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage.indexOf('<sender')).toBeLessThan(
        sentMessage.indexOf('<current-context>'),
      );
      expect(sentMessage.indexOf('</current-context>')).toBeLessThan(
        sentMessage.indexOf('Hello'),
      );
    });

    it('should order sender, channel, context, message text, and attachments correctly', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        contextStore: {
          formatForClaude: vi.fn().mockReturnValue('Timezone: US/Eastern'),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U123',
          senderName: 'Drew Ritter',
          channelId: 'C12345',
          channelName: 'general',
          text: 'Check this file',
          attachments: [
            {
              localPath: '/tmp/doc.pdf',
              originalName: 'doc.pdf',
              mimeType: 'application/pdf',
              size: 1024,
            },
          ],
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;

      const senderIdx = sentMessage.indexOf('<sender');
      const channelIdx = sentMessage.indexOf('<channel');
      const contextIdx = sentMessage.indexOf('<current-context>');
      const textIdx = sentMessage.indexOf('Check this file');
      const attachmentIdx = sentMessage.indexOf('<attachment>');

      // All five sections must be present
      expect(senderIdx).not.toBe(-1);
      expect(channelIdx).not.toBe(-1);
      expect(contextIdx).not.toBe(-1);
      expect(textIdx).not.toBe(-1);
      expect(attachmentIdx).not.toBe(-1);

      // Order: sender → channel → context → message text → attachment
      expect(senderIdx).toBeLessThan(channelIdx);
      expect(channelIdx).toBeLessThan(contextIdx);
      expect(contextIdx).toBeLessThan(textIdx);
      expect(textIdx).toBeLessThan(attachmentIdx);
    });

    it('should include channel tag when channelName differs from channelId', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          channelId: 'C12345',
          channelName: 'general',
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).toContain('<channel id="C12345">#general</channel>');
    });

    it('should not include channel tag when channelName equals channelId', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          channelId: 'C12345',
          channelName: 'C12345',
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      expect(sentMessage).not.toContain('<channel');
    });

    it('should place channel tag between sender and context', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        contextStore: {
          formatForClaude: vi.fn().mockReturnValue('Timezone: US/Eastern'),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U123',
          senderName: 'Drew Ritter',
          channelId: 'C12345',
          channelName: 'general',
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;
      const senderIdx = sentMessage.indexOf('<sender');
      const channelIdx = sentMessage.indexOf('<channel');
      const contextIdx = sentMessage.indexOf('<current-context>');

      expect(senderIdx).not.toBe(-1);
      expect(channelIdx).not.toBe(-1);
      expect(contextIdx).not.toBe(-1);

      expect(senderIdx).toBeLessThan(channelIdx);
      expect(channelIdx).toBeLessThan(contextIdx);
    });

    it('should wrap delegate messages in <delegate-message> with delegation context', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U12345',
          senderName: 'Eden',
          senderRole: 'delegate',
          text: 'Can you help me with something?',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;

      // Should have delegate-message wrapper with sender attributes
      expect(sentMessage).toContain(
        '<delegate-message sender-id="U12345" sender-name="Eden">',
      );
      expect(sentMessage).toContain('</delegate-message>');

      // Should have delegation context
      expect(sentMessage).toContain('<delegation-context>');
      expect(sentMessage).toContain('</delegation-context>');
      expect(sentMessage).toContain('delegate, NOT your primary human partner');

      // Should NOT have a <sender> tag
      expect(sentMessage).not.toContain('<sender');

      // Message text should be inside the wrapper
      expect(sentMessage).toContain('Can you help me with something?');
      const openTag = sentMessage.indexOf('<delegate-message');
      const closeTag = sentMessage.indexOf('</delegate-message>');
      const textIdx = sentMessage.indexOf('Can you help me with something?');
      expect(openTag).toBeLessThan(textIdx);
      expect(textIdx).toBeLessThan(closeTag);
    });

    it('should not wrap primary user messages in <delegate-message>', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U123',
          senderName: 'Jesse',
          senderRole: 'primary',
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;

      // Should have normal sender tag
      expect(sentMessage).toContain('<sender id="U123">Jesse</sender>');
      // Should NOT have delegate wrapper
      expect(sentMessage).not.toContain('<delegate-message');
      expect(sentMessage).not.toContain('<delegation-context>');
    });

    it('should treat undefined senderRole as primary', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U123',
          senderName: 'Jesse',
          // senderRole is undefined (not set)
          text: 'Hello',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;

      // Should have normal sender tag
      expect(sentMessage).toContain('<sender id="U123">Jesse</sender>');
      // Should NOT have delegate wrapper
      expect(sentMessage).not.toContain('<delegate-message');
      expect(sentMessage).not.toContain('<delegation-context>');
    });

    it('should include channel and context tags within delegate wrapper', async () => {
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        contextStore: {
          formatForClaude: vi.fn().mockReturnValue('Timezone: US/Eastern'),
        },
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          senderId: 'U12345',
          senderName: 'Eden',
          senderRole: 'delegate',
          channelId: 'C12345',
          channelName: 'general',
          text: 'Hello from delegate',
        }),
        responder as any,
      );

      const sentMessage = sessionManager.sendMessage.mock
        .calls[0]![1] as string;

      const openTag = sentMessage.indexOf('<delegate-message');
      const closeTag = sentMessage.indexOf('</delegate-message>');
      const channelIdx = sentMessage.indexOf('<channel');
      const contextIdx = sentMessage.indexOf('<current-context>');
      const delegationCtxIdx = sentMessage.indexOf('<delegation-context>');

      // All sections present
      expect(openTag).not.toBe(-1);
      expect(closeTag).not.toBe(-1);
      expect(channelIdx).not.toBe(-1);
      expect(contextIdx).not.toBe(-1);
      expect(delegationCtxIdx).not.toBe(-1);

      // Everything is inside the delegate-message wrapper
      expect(openTag).toBeLessThan(delegationCtxIdx);
      expect(openTag).toBeLessThan(channelIdx);
      expect(openTag).toBeLessThan(contextIdx);
      expect(channelIdx).toBeLessThan(closeTag);
      expect(contextIdx).toBeLessThan(closeTag);
    });
  });

  describe('callbacks', () => {
    it('should wire onText callback to responder.updateResponse', async () => {
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onText('Hello world');
          return {
            sessionId: 'sess_1',
            text: 'Hello world',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.updateResponse).toHaveBeenCalledWith('Hello world');
    });

    it('should wire onToolUse callback to responder.recordToolUse', async () => {
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onToolUse('Read', { file_path: '/foo.ts' });
          return { sessionId: 'sess_1', text: 'ok', stats: makeStats() };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.recordToolUse).toHaveBeenCalledWith('Read', {
        file_path: '/foo.ts',
      });
    });

    it('should wire onFileSend callback to responder.sendFile', async () => {
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onFileSend('/tmp/output.png');
          return { sessionId: 'sess_1', text: 'ok', stats: makeStats() };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.sendFile).toHaveBeenCalledWith('/tmp/output.png');
    });

    it('should wire onCompaction callback to responder.sendNotice', async () => {
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onCompaction({ preTokens: 150000, trigger: 'auto' });
          return { sessionId: 'sess_1', text: 'ok', stats: makeStats() };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.sendNotice).toHaveBeenCalledWith(
        expect.stringContaining('150k tokens'),
      );
    });

    it('should not crash if responder lacks recordToolUse', async () => {
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onToolUse('Read', {});
          return { sessionId: 'sess_1', text: 'ok', stats: makeStats() };
        },
      );
      const { orchestrator } = makeOrchestrator({ sessionManager });
      // Responder WITHOUT recordToolUse
      const responder = makeMockResponder();
      delete (responder as any).recordToolUse;

      // Should not throw
      await orchestrator.handleMessage(makeMessage(), responder as any);
    });
  });

  describe('outbox processing', () => {
    it('should send outbox files via responder.sendFile after session completes', async () => {
      const { orchestrator } = makeOrchestrator();
      const responder = makeMockResponder();

      // Create outbox with a file in the room directory
      const fs = await import('node:fs');
      const path = await import('node:path');
      const roomDir = '/tmp/test/rooms/matrix/room123';
      const outboxDir = path.join(roomDir, 'outbox');
      fs.mkdirSync(outboxDir, { recursive: true });
      fs.writeFileSync(path.join(outboxDir, 'report.csv'), 'data');

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.sendFile).toHaveBeenCalledWith(
        path.join(outboxDir, 'report.csv'),
        'report.csv',
      );

      // File should be moved to sent/
      const sentDir = path.join(outboxDir, 'sent');
      const sentFiles = fs.readdirSync(sentDir);
      expect(sentFiles).toHaveLength(1);
      expect(sentFiles[0]).toMatch(/^\d+-report\.csv$/);

      // Cleanup
      fs.rmSync(roomDir, { recursive: true, force: true });
    });

    it('should not crash session when outbox sendFile fails', async () => {
      const { orchestrator } = makeOrchestrator();
      const responder = makeMockResponder();
      responder.sendFile.mockRejectedValue(new Error('upload failed'));

      // Create outbox with a file
      const fs = await import('node:fs');
      const path = await import('node:path');
      const roomDir = '/tmp/test/rooms/matrix/room123';
      const outboxDir = path.join(roomDir, 'outbox');
      fs.mkdirSync(outboxDir, { recursive: true });
      fs.writeFileSync(path.join(outboxDir, 'bad-file.txt'), 'data');

      // Should complete without throwing
      await orchestrator.handleMessage(makeMessage(), responder as any);

      // Processing should still be cleared
      expect(responder.clearProcessing).toHaveBeenCalled();
      expect(responder.setTyping).toHaveBeenCalledWith(false);

      // Cleanup
      fs.rmSync(roomDir, { recursive: true, force: true });
    });
  });

  describe('thread locking', () => {
    it('should serialize messages on the same thread', async () => {
      const callOrder: string[] = [];
      let resolveFirst: () => void;
      const firstMessageBlocks = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const sessionManager = makeMockSessionManager();
      let callCount = 0;
      sessionManager.sendMessage.mockImplementation(async () => {
        callCount++;
        const myCall = callCount;
        callOrder.push(`start_${myCall}`);
        if (myCall === 1) {
          await firstMessageBlocks;
        }
        callOrder.push(`end_${myCall}`);
        return { sessionId: `sess_${myCall}`, text: 'ok', stats: makeStats() };
      });

      const { orchestrator } = makeOrchestrator({ sessionManager });
      const threadId = uniqueId('thread');

      const msg1 = makeMessage({ threadId, text: 'first' });
      const msg2 = makeMessage({ threadId, text: 'second' });

      const responder1 = makeMockResponder();
      const responder2 = makeMockResponder();

      // Fire both messages concurrently
      const p1 = orchestrator.handleMessage(msg1, responder1 as any);
      const p2 = orchestrator.handleMessage(msg2, responder2 as any);

      // Let the event loop tick so p2 hits the lock
      await new Promise((r) => setTimeout(r, 10));

      // First message should be in-progress, second should be waiting
      expect(callOrder).toEqual(['start_1']);

      // Release first message
      resolveFirst!();
      await p1;
      await p2;

      // Second message should only start AFTER first completes
      expect(callOrder).toEqual(['start_1', 'end_1', 'start_2', 'end_2']);
    });

    it('should not block messages on different threads', async () => {
      let resolveFirst: () => void;
      const firstBlocks = new Promise<void>((r) => {
        resolveFirst = r;
      });

      const sessionManager = makeMockSessionManager();
      let callCount = 0;
      sessionManager.sendMessage.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) await firstBlocks;
        return {
          sessionId: `sess_${callCount}`,
          text: 'ok',
          stats: makeStats(),
        };
      });

      const { orchestrator } = makeOrchestrator({ sessionManager });

      const msg1 = makeMessage({ threadId: uniqueId('threadA') });
      const msg2 = makeMessage({ threadId: uniqueId('threadB') });

      const p1 = orchestrator.handleMessage(msg1, makeMockResponder() as any);
      const p2 = orchestrator.handleMessage(msg2, makeMockResponder() as any);

      // Give p2 a chance to start
      await new Promise((r) => setTimeout(r, 10));

      // Both should have been called (different threads, no lock contention)
      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(2);

      resolveFirst!();
      await p1;
      await p2;
    });

    it('should release lock even when sendMessage throws', async () => {
      const sessionManager = makeMockSessionManager();
      let callCount = 0;
      sessionManager.sendMessage.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('first message fails');
        return { sessionId: 'sess_2', text: 'ok', stats: makeStats() };
      });

      const { orchestrator } = makeOrchestrator({ sessionManager });
      const threadId = uniqueId('thread_err');

      const msg1 = makeMessage({ threadId });
      const msg2 = makeMessage({ threadId });

      // First message fails
      await orchestrator.handleMessage(msg1, makeMockResponder() as any);
      // Second message should still proceed (lock was released)
      await orchestrator.handleMessage(msg2, makeMockResponder() as any);

      expect(sessionManager.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('task registry integration', () => {
    it('should work without taskRegistry (backward compat)', async () => {
      const { orchestrator } = makeOrchestrator();
      const responder = makeMockResponder();

      // Should not throw when no taskRegistry configured
      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.finalizeResponse).toHaveBeenCalled();
    });

    it('should register task in onSessionStart callback', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_reg');
          return {
            sessionId: 'sess_reg',
            text: 'ok',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({ text: 'do something' }),
        responder as any,
      );

      expect(taskRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess_reg',
          roomId: 'room123',
          platform: 'matrix',
          origin: 'user',
          promptPreview: expect.stringContaining('do something'),
        }),
        expect.objectContaining({
          abortController: expect.any(AbortController),
          sessionPromise: expect.any(Promise),
        }),
      );
    });

    it('should call heartbeat on onTextDelta', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_hb');
          await callbacks.onTextDelta('some text');
          await callbacks.onTextDelta('some more text');
          return {
            sessionId: 'sess_hb',
            text: 'some more text',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(taskRegistry.heartbeat).toHaveBeenCalledWith('sess_hb');
      expect(taskRegistry.heartbeat).toHaveBeenCalledTimes(2);
    });

    it('should set onFirstOutput on responder that calls setHadVisibleOutput', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      let capturedOnFirstOutput: (() => void) | undefined;

      const responder = makeMockResponder();
      responder.setOnFirstOutput = vi.fn((cb: () => void) => {
        capturedOnFirstOutput = cb;
      });

      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_vis');
          // Simulate the responder firing onFirstOutput after session is started
          capturedOnFirstOutput?.();
          return {
            sessionId: 'sess_vis',
            text: 'ok',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(responder.setOnFirstOutput).toHaveBeenCalled();
      expect(taskRegistry.setHadVisibleOutput).toHaveBeenCalledWith('sess_vis');
    });

    it('should complete task with stats on successful sendMessage', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const stats = makeStats({ contextTokens: 5000, costUsd: 0.05 });
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_ok');
          return {
            sessionId: 'sess_ok',
            text: 'done',
            stats,
          };
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(taskRegistry.complete).toHaveBeenCalledWith('sess_ok', stats);
    });

    it('should markError on non-AbortError failure', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_err');
          throw new Error('Claude exploded');
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(taskRegistry.markError).toHaveBeenCalledWith(
        'sess_err',
        undefined,
      );
      expect(taskRegistry.complete).not.toHaveBeenCalled();
    });

    it('should removeLiveEntry in finally block', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_fin');
          return {
            sessionId: 'sess_fin',
            text: 'ok',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(taskRegistry.removeLiveEntry).toHaveBeenCalledWith('sess_fin');
    });

    it('should removeLiveEntry even when sendMessage throws', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_err_fin');
          throw new Error('boom');
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      expect(taskRegistry.removeLiveEntry).toHaveBeenCalledWith('sess_err_fin');
    });

    it('should pass abortController to sendMessage options', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      // sendMessage should be called with options containing abortController
      const lastCallArgs = sessionManager.sendMessage.mock.calls[0];
      // args: roomId, message, platform, channelName, callbacks, resumeSession, options
      const options = lastCallArgs?.[6];
      expect(options).toBeDefined();
      expect(options.abortController).toBeInstanceOf(AbortController);
    });

    describe('AbortError handling', () => {
      it('should not send error notice on AbortError', async () => {
        const taskRegistry = makeMockTaskRegistry();
        const sessionManager = makeMockSessionManager();
        sessionManager.sendMessage.mockImplementation(
          async (
            _channelId: string,
            _text: string,
            _platform: string,
            _channelName: string,
            callbacks: any,
          ) => {
            await callbacks.onSessionStart('sess_abort');
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            throw abortError;
          },
        );
        const { orchestrator } = makeOrchestrator({
          sessionManager,
          taskRegistry,
        });
        const responder = makeMockResponder();

        await orchestrator.handleMessage(makeMessage(), responder as any);

        // On abort: no error notice, no markError on responder
        expect(responder.sendNotice).not.toHaveBeenCalled();
        expect(responder.markError).not.toHaveBeenCalled();
      });

      it('should not write status to taskRegistry on AbortError', async () => {
        const taskRegistry = makeMockTaskRegistry();
        const sessionManager = makeMockSessionManager();
        sessionManager.sendMessage.mockImplementation(
          async (
            _channelId: string,
            _text: string,
            _platform: string,
            _channelName: string,
            callbacks: any,
          ) => {
            await callbacks.onSessionStart('sess_abort2');
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            throw abortError;
          },
        );
        const { orchestrator } = makeOrchestrator({
          sessionManager,
          taskRegistry,
        });
        const responder = makeMockResponder();

        await orchestrator.handleMessage(makeMessage(), responder as any);

        // cancel_task owns the status write, orchestrator must NOT write on AbortError
        expect(taskRegistry.complete).not.toHaveBeenCalled();
        expect(taskRegistry.markError).not.toHaveBeenCalled();
      });

      it('should clear MessageSessionStore on AbortError', async () => {
        const taskRegistry = makeMockTaskRegistry();
        const sessionManager = makeMockSessionManager();
        sessionManager.sendMessage.mockImplementation(
          async (
            _channelId: string,
            _text: string,
            _platform: string,
            _channelName: string,
            callbacks: any,
          ) => {
            await callbacks.onSessionStart('sess_abort3');
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            throw abortError;
          },
        );
        const { orchestrator } = makeOrchestrator({
          sessionManager,
          taskRegistry,
        });
        const responder = makeMockResponder();
        const threadId = uniqueId('thread_abort');

        await orchestrator.handleMessage(
          makeMessage({ threadId }),
          responder as any,
        );

        // Should delete session so next message starts fresh
        expect(sessionManager.deleteEventSession).toHaveBeenCalledWith(
          threadId,
        );
      });

      it('should still removeLiveEntry on AbortError', async () => {
        const taskRegistry = makeMockTaskRegistry();
        const sessionManager = makeMockSessionManager();
        sessionManager.sendMessage.mockImplementation(
          async (
            _channelId: string,
            _text: string,
            _platform: string,
            _channelName: string,
            callbacks: any,
          ) => {
            await callbacks.onSessionStart('sess_abort4');
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            throw abortError;
          },
        );
        const { orchestrator } = makeOrchestrator({
          sessionManager,
          taskRegistry,
        });
        const responder = makeMockResponder();

        await orchestrator.handleMessage(makeMessage(), responder as any);

        expect(taskRegistry.removeLiveEntry).toHaveBeenCalledWith(
          'sess_abort4',
        );
      });

      it('should still release thread lock on AbortError', async () => {
        const taskRegistry = makeMockTaskRegistry();
        const sessionManager = makeMockSessionManager();
        let callCount = 0;
        sessionManager.sendMessage.mockImplementation(
          async (
            _channelId: string,
            _text: string,
            _platform: string,
            _channelName: string,
            callbacks: any,
          ) => {
            callCount++;
            await callbacks.onSessionStart(`sess_lock_${callCount}`);
            if (callCount === 1) {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              throw abortError;
            }
            return {
              sessionId: `sess_lock_${callCount}`,
              text: 'ok',
              stats: makeStats(),
            };
          },
        );
        const { orchestrator } = makeOrchestrator({
          sessionManager,
          taskRegistry,
        });
        const threadId = uniqueId('thread_lock_abort');

        // First message aborted
        await orchestrator.handleMessage(
          makeMessage({ threadId }),
          makeMockResponder() as any,
        );
        // Second message should still proceed (lock was released)
        await orchestrator.handleMessage(
          makeMessage({ threadId }),
          makeMockResponder() as any,
        );

        expect(sessionManager.sendMessage).toHaveBeenCalledTimes(2);
      });
    });

    it('should not register/complete when onSessionStart never fires', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager({
        sendMessage: vi.fn().mockResolvedValue({
          sessionId: undefined,
          text: 'ok',
          stats: makeStats(),
        }),
      });
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(makeMessage(), responder as any);

      // No sessionId was captured so no registry calls should happen
      expect(taskRegistry.register).not.toHaveBeenCalled();
      expect(taskRegistry.complete).not.toHaveBeenCalled();
      expect(taskRegistry.removeLiveEntry).not.toHaveBeenCalled();
    });

    it('should include origin "scheduled" for wakeup messages', async () => {
      const taskRegistry = makeMockTaskRegistry();
      const sessionManager = makeMockSessionManager();
      sessionManager.sendMessage.mockImplementation(
        async (
          _channelId: string,
          _text: string,
          _platform: string,
          _channelName: string,
          callbacks: any,
        ) => {
          await callbacks.onSessionStart('sess_sched');
          return {
            sessionId: 'sess_sched',
            text: 'ok',
            stats: makeStats(),
          };
        },
      );
      const { orchestrator } = makeOrchestrator({
        sessionManager,
        taskRegistry,
      });
      const responder = makeMockResponder();

      await orchestrator.handleMessage(
        makeMessage({
          text: 'scheduled task',
          senderId: 'scheduler',
        }),
        responder as any,
        undefined, // rawEvent
        { origin: 'scheduled', schedulerJobId: 'job-42' },
      );

      expect(taskRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: 'scheduled',
          schedulerJobId: 'job-42',
        }),
        expect.anything(),
      );
    });
  });
});
