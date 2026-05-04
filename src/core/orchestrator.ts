// src/core/orchestrator.ts

import { processOutbox } from '../claude/outbox.js';
import { Logger } from '../utils/logger.js';
import { getRoomDirectory } from '../utils/roomPath.js';
import { CommandHandler } from './commandHandler.js';
import type { ContextStore } from './contextStore.js';
import type { ConversationLogger } from './conversationLogger.js';
import type { SessionDatabase } from './database.js';
import type {
  ITaskRegistry,
  LiveTaskEntry,
  TaskOrigin,
} from './taskRegistry.types.js';
import type {
  IncomingMessage,
  ISessionManager,
  PlatformResponder,
  SessionCallbacks,
} from './types.js';

const logger = new Logger('Orchestrator');

// Per-thread locks to prevent concurrent Claude sessions on the same thread
// Maps threadRootId -> Promise that resolves when current session completes
const threadLocks = new Map<string, Promise<void>>();

/** Metadata passed alongside a message for task tracking. */
export interface TaskMetadata {
  origin: TaskOrigin;
  schedulerJobId?: string;
}

export interface OrchestratorConfig {
  dataDir: string;
  sessionManager: ISessionManager;
  database: SessionDatabase;
  conversationLogger: ConversationLogger;
  contextStore?: ContextStore;
  taskRegistry?: ITaskRegistry;
}

export class ConversationOrchestrator {
  private sessionManager: ISessionManager;
  private database: SessionDatabase;
  private conversationLogger: ConversationLogger;
  private contextStore?: ContextStore;
  private commandHandler: CommandHandler;
  private dataDir: string;
  private taskRegistry?: ITaskRegistry;

  constructor(config: OrchestratorConfig) {
    this.dataDir = config.dataDir;
    this.sessionManager = config.sessionManager;
    this.database = config.database;
    this.conversationLogger = config.conversationLogger;
    this.contextStore = config.contextStore;
    this.taskRegistry = config.taskRegistry;
    this.commandHandler = new CommandHandler();
  }

  isMessageProcessed(messageId: string): boolean {
    return this.database.isEventProcessed(messageId);
  }

  async handleMessage(
    message: IncomingMessage,
    responder: PlatformResponder,
    rawEvent?: unknown,
    taskMeta?: TaskMetadata,
  ): Promise<void> {
    // Deduplication
    if (this.database.isEventProcessed(message.messageId)) {
      logger.debug('Skipping already processed message', {
        messageId: message.messageId,
      });
      return;
    }

    // Mark as processed immediately
    this.database.markEventProcessed(message.messageId, message.channelId);

    // Handle slash commands
    const slashCommand = this.commandHandler.parse(message.text);
    if (slashCommand) {
      await this.commandHandler.handle(slashCommand, responder);
      return;
    }

    // Determine thread root ID early for locking
    const threadRootId = message.threadId ?? message.messageId;

    // Wait for any existing session in this thread to complete
    // This prevents forking when a user sends a message while Claude is responding
    // We loop because multiple messages might be waiting - when a lock releases,
    // all waiters wake up, so we must re-check to ensure we're the one who got it
    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    let existingLock = threadLocks.get(threadRootId);
    while (existingLock) {
      logger.info('Waiting for existing thread session to complete', {
        threadRootId,
      });
      try {
        await existingLock;
      } catch {
        // Previous session failed, that's ok - we'll proceed
      }
      // Re-check: another waiter might have grabbed the lock while we were waking up
      existingLock = threadLocks.get(threadRootId);
    }

    // Now safe to acquire the lock - no one else has it
    threadLocks.set(threadRootId, lockPromise);

    // Create AbortController and deferred promise for task registry
    const abortController = this.taskRegistry
      ? new AbortController()
      : undefined;
    let deferredResolve: (() => void) | undefined;
    const sessionPromise = this.taskRegistry
      ? new Promise<void>((resolve) => {
          deferredResolve = resolve;
        })
      : undefined;

    // Track sessionId at this scope for finally/catch cleanup
    let currentSessionId: string | undefined;

    // Process with Claude
    try {
      await responder.markProcessing();
      await responder.setTyping(true);

      const roomDir = getRoomDirectory(
        this.dataDir,
        message.channelId,
        message.platform,
        message.channelName,
      );

      // Log incoming message
      await this.conversationLogger.logIncoming({
        platform: message.platform,
        channelId: message.channelId,
        channelName: message.channelName,
        threadId: message.threadId,
        messageId: message.messageId,
        senderId: message.senderId,
        senderName: message.senderName ?? message.senderId,
        text: message.text,
        rawEvent: rawEvent ?? {},
        attachments: message.attachments.map((a) => ({
          name: a.originalName,
          mimeType: a.mimeType,
          size: a.size,
        })),
      });

      // Build message with context
      const messageWithContext = this.buildMessageWithContext(message, roomDir);

      // Check for existing session
      let resumeSession:
        | { sessionId: string; compactionCount: number }
        | undefined;
      if (message.threadId) {
        const existing = this.sessionManager.getSessionFromEvent(
          message.threadId,
        );
        if (existing) {
          resumeSession = {
            sessionId: existing.sessionId,
            compactionCount: existing.compactionCount,
          };
        }
      }

      // Create callbacks that use the responder
      const callbacks = this.createCallbacks(
        responder,
        roomDir,
        threadRootId,
        message.channelId,
        message,
        taskMeta,
        abortController,
        sessionPromise,
        (sessionId) => {
          currentSessionId = sessionId;
        },
      );

      // Set onFirstOutput on responder for task visibility tracking
      if (this.taskRegistry && 'setOnFirstOutput' in responder) {
        const registry = this.taskRegistry;
        (
          responder as {
            setOnFirstOutput: (cb: () => void) => void;
          }
        ).setOnFirstOutput(() => {
          if (currentSessionId) {
            registry.setHadVisibleOutput(currentSessionId);
          }
        });
      }

      // Send to Claude
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        messageWithContext,
        message.platform,
        message.channelName,
        callbacks,
        resumeSession,
        abortController ? { abortController } : undefined,
      );

      // Log assistant response
      if (result.text) {
        await this.conversationLogger.logOutgoing({
          platform: message.platform,
          channelId: message.channelId,
          channelName: message.channelName,
          threadId: threadRootId,
          action: 'response',
          text: result.text,
          rawPayload: { sessionId: result.sessionId },
        });
      }

      // Finalize the response (ensures final text is sent, bypassing throttle)
      await responder.finalizeResponse();

      // Process outbox - send any files Claude wrote to outbox/
      await processOutbox(roomDir, (filePath, filename) =>
        responder.sendFile(filePath, filename),
      );

      // Stop typing, clear processing
      await responder.setTyping(false);
      await responder.clearProcessing();

      // Save session
      if (result.sessionId) {
        this.sessionManager.saveEventSession(
          threadRootId,
          message.channelId,
          result.sessionId,
          result.stats.contextTokens,
          result.stats.compactionCount,
        );
      }

      // Mark task complete in registry
      if (this.taskRegistry && currentSessionId) {
        this.taskRegistry.complete(currentSessionId, result.stats);
      }

      // Update channel stats
      await responder.updateChannelStats(result.stats);
    } catch (error) {
      const isAbortError =
        error instanceof Error && error.name === 'AbortError';

      if (isAbortError) {
        // Task was cancelled via cancel_task tool - no error messaging
        logger.info('Session aborted (cancelled)', {
          sessionId: currentSessionId,
          messageId: message.messageId,
        });
        await responder.setTyping(false);
        await responder.clearProcessing();

        // Clear session mapping so next message starts fresh
        if ('deleteEventSession' in this.sessionManager) {
          (
            this.sessionManager as { deleteEventSession: (id: string) => void }
          ).deleteEventSession(threadRootId);
        }

        // Do NOT write status to taskRegistry - cancel_task owns that
      } else {
        logger.error('Error handling message', {
          error,
          messageId: message.messageId,
        });
        await responder.setTyping(false);
        await responder.clearProcessing();
        await responder.markError();
        await responder.sendNotice(
          'Sorry, I encountered an error processing your message.',
        );

        // Mark task as errored in registry
        if (this.taskRegistry && currentSessionId) {
          this.taskRegistry.markError(currentSessionId, undefined);
        }
      }
    } finally {
      // Remove live entry from registry
      if (this.taskRegistry && currentSessionId) {
        this.taskRegistry.removeLiveEntry(currentSessionId);
      }

      // Resolve deferred promise (signals task completion to abortAll)
      deferredResolve?.();

      // Always release the lock when done
      if (threadLocks.get(threadRootId) === lockPromise) {
        releaseLock?.();
        threadLocks.delete(threadRootId);
      }
    }
  }

  private buildMessageWithContext(
    message: IncomingMessage,
    roomDir: string,
  ): string {
    let result = message.text;

    // Add attachment info
    for (const attachment of message.attachments) {
      result += `\n\n<attachment>\nFile: ${attachment.originalName}\nType: ${attachment.mimeType}\nSize: ${attachment.size} bytes\nLocal path: ${attachment.localPath}\n</attachment>`;
    }

    // Add real-time context
    const contextParts: string[] = [];
    if (this.contextStore) {
      const contextString = this.contextStore.formatForClaude();
      if (contextString) {
        contextParts.push(contextString);
      }
    }
    // Inject outbox path so Claude always uses the correct absolute path
    contextParts.push(`Outbox path: ${roomDir}/outbox/`);

    if (contextParts.length > 0) {
      result = `<current-context>\n${contextParts.join('\n')}\n</current-context>\n\n${result}`;
    }

    // Add channel tag (when name was resolved successfully)
    if (message.channelName !== message.channelId) {
      result = `<channel id="${message.channelId}">#${message.channelName}</channel>\n\n${result}`;
    }

    // Add sender identity or delegate wrapper (LAST step — ends up outermost)
    if (message.senderRole === 'delegate' && message.senderName) {
      const delegationContext =
        'This message is from a delegate, NOT your primary human partner. ' +
        "Be helpful but protective of your human partner's interests. " +
        'This person may not share the same priorities as your partner. ' +
        'When in doubt about a request, check with your human partner before acting.';
      result =
        `<delegate-message sender-id="${message.senderId}" sender-name="${message.senderName}">\n` +
        `<delegation-context>${delegationContext}</delegation-context>\n\n` +
        `${result}\n` +
        '</delegate-message>';
    } else if (message.senderName) {
      result = `<sender id="${message.senderId}">${message.senderName}</sender>\n\n${result}`;
    }

    return result;
  }

  private createCallbacks(
    responder: PlatformResponder,
    _roomDir: string,
    threadRootId: string,
    channelId: string,
    message: IncomingMessage,
    taskMeta: TaskMetadata | undefined,
    abortController: AbortController | undefined,
    sessionPromise: Promise<void> | undefined,
    onSessionIdCaptured: (sessionId: string) => void,
  ): SessionCallbacks {
    // Track sessionId locally for heartbeat calls
    let sessionId: string | undefined;

    return {
      onSessionStart: async (sid) => {
        // Handle stale-session retry: clean up previous registration
        if (sessionId && this.taskRegistry) {
          logger.warn(
            'Stale session retry detected, cleaning up previous task',
            {
              oldSessionId: sessionId,
              newSessionId: sid,
            },
          );
          this.taskRegistry.markError(sessionId);
          this.taskRegistry.removeLiveEntry(sessionId);
        }

        sessionId = sid;
        onSessionIdCaptured(sid);
        logger.info('Session started', { sessionId: sid });
        // Eagerly save session mapping so it survives SIGTERM during streaming
        this.sessionManager.saveEventSession(
          threadRootId,
          channelId,
          sid,
          0,
          0,
        );

        // Register with task registry
        if (this.taskRegistry && abortController && sessionPromise) {
          const cancelCallback = async () => {
            responder.cancelled = true;
            abortController.abort();
          };
          const liveEntry: LiveTaskEntry = {
            abortController,
            cancelCallback,
            sessionPromise,
          };
          this.taskRegistry.register(
            {
              sessionId: sid,
              roomId: message.channelId,
              threadId: message.threadId,
              platform: message.platform,
              origin: taskMeta?.origin ?? 'user',
              schedulerJobId: taskMeta?.schedulerJobId,
              promptPreview: message.text,
            },
            liveEntry,
          );
        }
      },
      onCompaction: async ({ preTokens, trigger }) => {
        const notice = `Context compacted (was ${Math.round(preTokens / 1000)}k tokens, trigger: ${trigger})`;
        await responder.sendNotice(notice);
      },
      onText: async (text) => {
        await responder.updateResponse(text);
      },
      onTextDelta: async (text) => {
        await responder.updateResponse(text);
        // Heartbeat on streaming activity
        if (this.taskRegistry && sessionId) {
          this.taskRegistry.heartbeat(sessionId);
        }
      },
      onToolUse: async (name, input) => {
        // Record for responders that surface tool calls in the platform UI.
        if ('recordToolUse' in responder) {
          (
            responder as { recordToolUse: (n: string, i: unknown) => void }
          ).recordToolUse(name, input);
        }
        logger.debug('Tool use', { name });
      },
      onFileSend: async (localPath) => {
        await responder.sendFile(localPath);
      },
    };
  }
}
