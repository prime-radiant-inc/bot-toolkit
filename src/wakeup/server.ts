// src/wakeup/server.ts
// HTTP server to receive wake-up calls from the scheduler service

import express, { type Express, type Router } from 'express';
import expressWs from 'express-ws';
import type { WebSocket } from 'ws';
import type { ContextStore } from '../core/contextStore.js';
import type { SessionDatabase } from '../core/database.js';
import type {
  MessageOrchestrator,
  PlatformAdapter,
  WakeupPayload,
} from '../core/types.js';
import { NativeResponder } from '../native/responder.js';
import { createNativeRoutes } from '../native/routes.js';
import type { NativeSessionManager } from '../native/sessionManager.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('WakeupServer');

export interface WakeupServerConfig {
  adapters: Map<string, PlatformAdapter>;
  contextStore?: ContextStore;
  /** Optional database for persistent wakeup idempotency tracking */
  database?: SessionDatabase;
  /** Optional additional routes to mount on the server (e.g., context routes) */
  additionalRoutes?: Router;
  /** Optional native session manager for native chat API support */
  nativeSessionManager?: NativeSessionManager;
  /** Optional orchestrator for native chat message handling */
  orchestrator?: MessageOrchestrator;
  /** Optional bearer token required for wakeup, notify, and native control routes */
  authToken?: string;
  /** Host the wakeup server will bind to. Defaults to loopback. */
  host?: string;
}

// Known platform prefixes for room_id parsing.
const KNOWN_PLATFORMS = ['slack', 'native', 'email'] as const;

function formatValidPlatforms(adapters: Map<string, PlatformAdapter>): string {
  const supported = KNOWN_PLATFORMS.filter((platform) =>
    adapters.has(platform),
  );
  return supported.length > 0
    ? supported.join(', ')
    : KNOWN_PLATFORMS.join(', ');
}

function requireBearerToken(authToken: string): Router {
  const router = express.Router();

  router.use((req, res, next) => {
    const expected = `Bearer ${authToken}`;
    if (req.header('authorization') !== expected) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  return router;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function requireAuthForHost(host: string, authToken: string | undefined): void {
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      'authToken is required when wakeup server host is not loopback',
    );
  }
}

function parseRoomId(roomId: string): { platform: string; channelId: string } {
  // Check for known platform prefix (e.g., "slack:C12345" or "native:session-id")
  for (const platform of KNOWN_PLATFORMS) {
    const prefix = `${platform}:`;
    if (roomId.startsWith(prefix)) {
      return { platform, channelId: roomId.slice(prefix.length) };
    }
  }

  // No supported prefix - unknown format.
  return { platform: 'unknown', channelId: roomId };
}

export function createWakeupServer(config: WakeupServerConfig): Express {
  const {
    adapters,
    contextStore,
    database,
    additionalRoutes,
    nativeSessionManager,
    orchestrator,
    authToken,
  } = config;
  const host = config.host ?? '127.0.0.1';
  requireAuthForHost(host, authToken);

  const app = express();

  // Clean up old wakeup dedup entries on startup (24h TTL)
  if (database) {
    database.cleanOldWakeups(24 * 60 * 60 * 1000);
  }

  if (!database) {
    logger.warn(
      'No database configured for wakeup idempotency — dedup disabled',
    );
  }

  // Enable WebSocket support
  const wsApp = expressWs(app);

  // Increase body size limit for Health Auto Export which sends large payloads
  app.use(express.json({ limit: '10mb' }));

  const protectedRoutes = authToken ? requireBearerToken(authToken) : undefined;
  const authMiddleware = protectedRoutes ? [protectedRoutes] : [];

  // Mount additional routes if provided (e.g., context routes)
  if (additionalRoutes) {
    app.use(additionalRoutes);
    logger.info('Additional routes mounted');
  }

  app.post('/wakeup', ...authMiddleware, async (req, res) => {
    const payload = req.body as WakeupPayload & { room_id: string };

    const roomId = payload.room_id;
    if (typeof roomId !== 'string' || roomId.length === 0) {
      logger.error('Wakeup rejected: room_id is required', {
        job_id: payload.job_id,
      });
      res.status(400).json({
        status: 'error',
        error: 'room_id is required',
      });
      return;
    }

    if (
      typeof payload.idempotency_key !== 'string' ||
      payload.idempotency_key.length === 0
    ) {
      logger.error('Wakeup rejected: idempotency_key is required', {
        job_id: payload.job_id,
      });
      res.status(400).json({
        status: 'error',
        error: 'idempotency_key is required',
      });
      return;
    }

    // Parse platform from room_id (format: "platform:channelId")
    const { platform, channelId } = parseRoomId(roomId);

    const adapter = adapters.get(platform);
    if (!adapter) {
      logger.error('Unknown platform', { platform, roomId });
      res.status(400).json({
        status: 'error',
        error: `Unknown platform: ${platform}. Valid platforms: ${formatValidPlatforms(adapters)}`,
      });
      return;
    }

    // Idempotency check (only when database is configured)
    // Wrapped in try/catch so DB errors degrade to no-dedup rather than blocking wakeups
    if (database) {
      try {
        if (database.isWakeupProcessed(payload.idempotency_key)) {
          logger.info('Duplicate wakeup ignored', {
            key: payload.idempotency_key,
          });
          res.json({
            status: 'duplicate',
            idempotency_key: payload.idempotency_key,
          });
          return;
        }
        database.markWakeupProcessed(payload.idempotency_key);
      } catch (error) {
        logger.error(
          'Wakeup idempotency check failed, proceeding without dedup',
          {
            key: payload.idempotency_key,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    logger.info('Processing wakeup', {
      job_id: payload.job_id,
      prompt_length: payload.prompt.length,
      platform,
      channel_id: channelId,
      thread_id: payload.thread_id,
    });

    // Respond immediately - Claude processing happens async
    res.status(202).json({ status: 'accepted', job_id: payload.job_id });

    // Process async (don't block the webhook response)
    (async () => {
      try {
        // Inject real-time context if available
        let promptWithContext = payload.prompt;
        if (contextStore) {
          const contextString = contextStore.formatForClaude();
          if (contextString) {
            promptWithContext = `<current-context>\n${contextString}\n</current-context>\n\n${payload.prompt}`;
            logger.debug('Injected context into wakeup prompt', {
              contextLength: contextString.length,
            });
          }
        }

        // Delegate to the appropriate adapter
        await adapter.handleWakeup(channelId, {
          ...payload,
          prompt: promptWithContext,
        });

        logger.info('Wakeup completed successfully', {
          job_id: payload.job_id,
          platform,
        });
      } catch (error) {
        logger.error('Wakeup processing failed', {
          job_id: payload.job_id,
          platform,
          channel_id: channelId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    })().catch((error) => {
      logger.error('Unexpected error in wakeup async handler', {
        job_id: payload.job_id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  app.get('/health', (_req, res) => {
    const adapterStatus: Record<
      string,
      { configured: boolean; connected: boolean }
    > = {};

    for (const [platform, adapter] of adapters) {
      const connected =
        'isConnected' in adapter && typeof adapter.isConnected === 'function'
          ? (adapter as { isConnected: () => boolean }).isConnected()
          : true;

      adapterStatus[platform] = {
        configured: true,
        connected,
      };
    }

    res.status(200).json({
      status: 'ok',
      service: 'unified-bot-wakeup',
      adapters: adapterStatus,
    });
  });

  // Simple notification endpoint - sends a message to a room without Claude processing
  app.post('/notify', ...authMiddleware, async (req, res) => {
    const { room_id, message } = req.body;

    if (!room_id || !message) {
      res
        .status(400)
        .json({ status: 'error', error: 'room_id and message are required' });
      return;
    }

    const { platform, channelId } = parseRoomId(room_id);
    const adapter = adapters.get(platform);

    if (!adapter) {
      res.status(400).json({
        status: 'error',
        error: `Unknown platform: ${platform}. Valid platforms: ${formatValidPlatforms(adapters)}`,
      });
      return;
    }

    try {
      logger.info('Sending notification', {
        platform,
        channelId,
        message_length: message.length,
      });
      // For notifications, we create a simple wakeup that doesn't go through Claude
      // The adapter's handleWakeup will send the message directly
      await adapter.handleWakeup(channelId, {
        prompt: message,
        idempotency_key: `notify-${Date.now()}`,
        job_id: `notify-${Date.now()}`,
        room_id: room_id,
        scheduled_at: new Date().toISOString(),
        triggered_at: new Date().toISOString(),
      });
      res.json({ status: 'sent' });
    } catch (error) {
      logger.error('Failed to send notification', {
        room_id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  if (nativeSessionManager) {
    // Native WebSocket attach endpoint. Register before HTTP /native middleware so
    // WebSocket auth is handled by the attach route rather than the HTTP router.
    if (orchestrator) {
      wsApp.app.ws(
        '/native/sessions/:id/attach',
        async (ws: WebSocket, req) => {
          const rawId = req.params.id;
          const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;

          if (!sessionId) {
            ws.close(4000, 'Session ID is required');
            return;
          }

          if (authToken) {
            const expected = `Bearer ${authToken}`;
            if (req.headers.authorization !== expected) {
              ws.close(4001, 'Unauthorized');
              return;
            }
          }

          logger.info('WebSocket attach request', { sessionId });

          // Track state - handlers registered immediately, validation happens async
          let validated = false;
          let closed = false;

          // Register handlers immediately (synchronously) to avoid race conditions
          // Messages/close events that arrive before validation completes are handled safely
          ws.on('close', () => {
            closed = true;
            if (validated) {
              nativeSessionManager.detach(sessionId);
            }
          });

          ws.on('error', (error) => {
            logger.error('WebSocket error', { error, sessionId });
            closed = true;
            if (validated) {
              nativeSessionManager.detach(sessionId);
            }
          });

          ws.on('message', async (data) => {
            // Only process messages after validation and if not closed
            if (!validated || closed) return;

            try {
              const message = JSON.parse(data.toString());

              if (message.type === 'input') {
                const incomingMessage = {
                  platform: 'native' as const,
                  channelId: message.roomSlug || sessionId,
                  channelName:
                    message.roomName || message.roomSlug || 'Native Session',
                  threadId: sessionId,
                  messageId: `native-${Date.now()}`,
                  senderId: 'user',
                  text: message.text,
                  attachments: [],
                };

                const responder = new NativeResponder(sessionId, ws);
                await orchestrator.handleMessage(incomingMessage, responder);

                // Update session activity
                await nativeSessionManager.updateSessionActivity(sessionId);
              }
            } catch (error) {
              logger.error('Error handling WebSocket message', {
                error,
                sessionId,
              });
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Failed to process message',
                }),
              );
            }
          });

          // Now do async validation
          const session = await nativeSessionManager.getSession(sessionId);

          // Check if client disconnected during validation
          if (closed) {
            logger.info('Client disconnected during session validation', {
              sessionId,
            });
            return;
          }

          if (!session) {
            ws.close(4004, 'Session not found');
            return;
          }

          // Check for existing attachment - close old connection to prevent orphaned sockets
          const existingWs = nativeSessionManager.getAttachedSocket(sessionId);
          if (existingWs && existingWs !== ws && existingWs.readyState === 1) {
            logger.info('Closing existing WebSocket connection', {
              sessionId,
            });
            existingWs.close(4000, 'Replaced by new connection');
          }

          nativeSessionManager.attach(sessionId, ws);
          validated = true;

          // Send history on attach (TODO: implement history retrieval)
          ws.send(JSON.stringify({ type: 'history', messages: [] }));
        },
      );

      logger.info(
        'Native WebSocket endpoint mounted at /native/sessions/:id/attach',
      );
    }

    // Native chat API routes (HTTP)
    app.use(
      '/native',
      ...authMiddleware,
      createNativeRoutes(nativeSessionManager),
    );
    logger.info('Native HTTP routes mounted at /native');
  }

  return app;
}

export function startWakeupServer(
  config: WakeupServerConfig & { port: number },
): Promise<void> {
  const app = createWakeupServer(config);
  const host = config.host ?? '127.0.0.1';

  return new Promise((resolve) => {
    const onListening = () => {
      logger.info('Wakeup server listening', { port: config.port, host });
      resolve();
    };

    app.listen(config.port, host, onListening);
  });
}
