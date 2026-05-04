// src/core/sessionManagerSDK.ts

import {
  type McpSdkServerConfigWithInstance,
  type McpServerConfig,
  query,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import type { Config } from '../config/config.js';
import { ConfigStore } from '../config/configStore.js';
import type { ResolvedMcp } from '../config/configTypes.js';
import { getSecretsReader } from '../config/secrets/index.js';
import { Logger } from '../utils/logger.js';
import { getRoomDirectory } from '../utils/roomPath.js';
import type {
  MessageSession,
  MessageSessionStore,
} from './messageSessionStore.js';
import {
  buildPlatformEnv,
  buildSessionStats,
  isSessionNotFoundError,
  parseStderrLogLevel,
  resolveResponseText,
} from './sessionManagerUtils.js';
import type {
  ISessionManager,
  Platform,
  SessionCallbacks,
  SessionResult,
  SystemPromptConfig,
} from './types.js';

const logger = new Logger('ClaudeSessionManagerSDK');

const SDK_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

export function buildSdkEnv(
  sourceEnv: NodeJS.ProcessEnv,
  platformEnv: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of SDK_ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...platformEnv,
    DEBUG_CLAUDE_AGENT_SDK: 'true',
  };
}

/**
 * Build SDK-compatible mcpServers dict from resolved MCP configs.
 * Stdio MCPs get platformEnv merged into env; remote MCPs pass through as-is.
 */
export function buildMcpServers(
  enabledMcps: ResolvedMcp[],
  platformEnv: Record<string, string>,
): Record<string, McpServerConfig> {
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const mcp of enabledMcps) {
    if (mcp.type === 'stdio') {
      mcpServers[mcp.id] = {
        command: mcp.command,
        args: mcp.args,
        env: { ...mcp.env, ...platformEnv },
      };
    } else if (mcp.type === 'sse' || mcp.type === 'http') {
      mcpServers[mcp.id] = {
        type: mcp.type,
        url: mcp.url,
        headers: mcp.headers,
      };
    }
  }
  return mcpServers;
}

export class ClaudeSessionManagerSDK implements ISessionManager {
  private configStore: ConfigStore;
  private sdkServers: Record<string, McpSdkServerConfigWithInstance>;

  constructor(
    private config: Config,
    private sessionStore: MessageSessionStore,
    sdkServers?: Record<string, McpSdkServerConfigWithInstance>,
  ) {
    const secretsReader = getSecretsReader(config.claude.configDir);
    this.configStore = new ConfigStore(config.claude.configDir, secretsReader);
    this.sdkServers = sdkServers ?? {};
  }

  /**
   * Look up an existing session from a message event ID.
   * Used to find the session when user replies to a message.
   */
  getSessionFromEvent(eventId: string): MessageSession | null {
    return this.sessionStore.getSession(eventId);
  }

  /**
   * Delete a session mapping by event ID.
   * Used on the cancel path to clear session state so the next message starts fresh.
   */
  deleteEventSession(eventId: string): void {
    this.sessionStore.deleteSession(eventId);
  }

  /**
   * Save a message event's session mapping.
   * Call this for both user messages and bot responses.
   */
  saveEventSession(
    eventId: string,
    roomId: string,
    sessionId: string,
    contextTokens: number,
    compactionCount: number,
  ): void {
    this.sessionStore.saveSession(eventId, roomId, {
      sessionId,
      contextTokens,
      compactionCount,
    });
  }

  async sendMessage(
    roomId: string,
    userMessage: string,
    platform: Platform,
    contextName: string,
    callbacks: SessionCallbacks,
    resumeSession?: { sessionId: string; compactionCount: number },
    options?: {
      systemPrompt?: SystemPromptConfig;
      forkSession?: boolean;
      outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
      abortController?: AbortController;
    },
  ): Promise<SessionResult> {
    const roomDir = getRoomDirectory(
      this.config.dataDirectory,
      roomId,
      platform,
      contextName,
    );

    logger.info('Sending message via SDK', {
      roomId,
      hasResumeSession: !!resumeSession,
      messageLength: userMessage.length,
    });

    // Build MCP servers dynamically from config (hot-reloadable!)
    // Include platform-specific env vars so scheduler MCP can determine room_id prefix
    const platformEnv = buildPlatformEnv(roomId, platform);

    const enabledMcps = await this.configStore.getEnabledMcps();
    const mcpServers: Record<string, McpServerConfig> = {
      ...buildMcpServers(enabledMcps, platformEnv),
      ...this.sdkServers,
    };

    // Build plugins dynamically from config
    const enabledPlugins = this.configStore.getEnabledPlugins();
    const plugins = enabledPlugins.map((p) => ({
      type: 'local' as const,
      path: p.path,
    }));

    logger.debug('Dynamic configuration loaded', {
      mcpCount: Object.keys(mcpServers).length,
      pluginCount: plugins.length,
      mcpIds: Object.keys(mcpServers),
      pluginIds: enabledPlugins.map((p) => p.id),
    });

    const queryOptions = {
      resume: resumeSession?.sessionId,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      cwd: roomDir,
      mcpServers,
      plugins,
      // Load settings from user (~/.claude/) and project (.claude/) directories
      // Required for skill discovery from ~/.claude/skills/ (personal skills)
      settingSources: ['user', 'project'] as SettingSource[],
      includePartialMessages: true,
      env: buildSdkEnv(process.env, platformEnv),
      // Capture stderr from Claude Code process for debugging
      stderr: (message: string) => {
        const level = parseStderrLogLevel(message);
        logger[level]('Claude Code stderr', { message, roomId });
      },
      // Pass through optional parameters
      ...(options?.abortController && {
        abortController: options.abortController,
      }),
      ...(options?.systemPrompt && { systemPrompt: options.systemPrompt }),
      ...(options?.forkSession && { forkSession: true }),
      ...(options?.outputFormat && {
        outputFormat: options.outputFormat,
        // Required beta header for structured outputs to work
        // See: https://github.com/anthropics/claude-code/issues/18935
        // Type cast needed because SDK types don't include this beta yet
        betas: [
          'structured-outputs-2025-11-13',
        ] as unknown as 'context-1m-2025-08-07'[],
      }),
    };

    let sessionId: string | undefined;
    let compactionCount = resumeSession?.compactionCount || 0;
    let currentText = '';

    // Store query object so we can call close() in finally block
    const queryObj = query({ prompt: userMessage, options: queryOptions });

    try {
      for await (const message of queryObj) {
        // Capture session ID on init
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
          await callbacks.onSessionStart(sessionId);
          logger.info('Session initialized', { sessionId, roomId });
        }

        // Handle compaction events
        if (
          message.type === 'system' &&
          message.subtype === 'compact_boundary'
        ) {
          compactionCount++;
          const compactMeta = message.compact_metadata;
          await callbacks.onCompaction({
            preTokens: compactMeta.pre_tokens,
            trigger: compactMeta.trigger,
          });
          logger.info('Compaction detected', { sessionId, compactionCount });
        }

        // Stream assistant text
        if (message.type === 'assistant' && message.message?.content) {
          // Extract all text from blocks (for non-streaming fallback)
          // Don't overwrite currentText - streaming deltas already accumulated it
          let blockText = '';
          for (const block of message.message.content) {
            if (block.type === 'text') {
              blockText += block.text;
            }
            if (block.type === 'tool_use') {
              await callbacks.onToolUse(block.name, block.input);
            }
          }

          // Use the more complete text - streaming might have been interrupted
          // blockText is authoritative from the API, currentText is from streaming
          if (blockText && blockText.length > currentText.length) {
            currentText = blockText;
          }

          // Send final text update
          if (currentText) {
            await callbacks.onText(currentText);
          }
        }

        // Handle streaming deltas
        if (message.type === 'stream_event') {
          const event = message.event;

          // Detect new text block starting - add separator if we already have content
          if (
            event?.type === 'content_block_start' &&
            event.content_block?.type === 'text'
          ) {
            if (currentText && !currentText.endsWith('\n')) {
              currentText += '\n\n';
            }
          }

          if (
            event?.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta'
          ) {
            currentText += event.delta.text;
            await callbacks.onTextDelta(currentText);
          }
        }

        // Final result
        if (message.type === 'result') {
          const stats = buildSessionStats(
            message.usage,
            message.total_cost_usd || 0,
            message.duration_ms || 0,
            compactionCount,
          );
          // When outputFormat is used, structured output is in message.structured_output
          // Otherwise use the accumulated text from streaming
          const structuredOutput = (message as { structured_output?: unknown })
            .structured_output;
          const responseText = resolveResponseText(
            currentText,
            structuredOutput,
          );
          if (structuredOutput !== undefined) {
            logger.debug('Using structured output', {
              sessionId,
              hasStructuredOutput: true,
            });
          }

          logger.info('Message completed', { sessionId, stats });

          // Detect stale session: if we tried to resume but got 0 tokens,
          // the session file is likely missing. Retry without resume.
          // Skip retry if abort was signaled (task was cancelled).
          if (
            resumeSession &&
            stats.contextTokens === 0 &&
            stats.outputTokens === 0 &&
            !options?.abortController?.signal.aborted
          ) {
            logger.warn(
              'Session appears stale (0 tokens with resume), retrying without resume',
              {
                roomId,
                staleSessionId: resumeSession.sessionId,
              },
            );
            return this.sendMessage(
              roomId,
              userMessage,
              platform,
              contextName,
              callbacks,
              undefined, // No resume session
              options,
            );
          }

          return {
            sessionId,
            text: responseText,
            stats,
          };
        }
      }

      throw new Error('Query ended without result message');
    } catch (error) {
      // Check if this is a "session not found" error when trying to resume
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.info('Caught error in sendMessage', {
        roomId,
        errorMessage,
        hasResumeSession: !!resumeSession,
        resumeSessionId: resumeSession?.sessionId,
      });

      // Skip retry if abort was signaled (task was cancelled)
      if (
        isSessionNotFoundError(errorMessage) &&
        resumeSession &&
        !options?.abortController?.signal.aborted
      ) {
        logger.warn('Session not found, retrying without resume', {
          roomId,
          staleSessionId: resumeSession.sessionId,
        });

        // Retry without resume - recursive call with resumeSession = undefined
        return this.sendMessage(
          roomId,
          userMessage,
          platform,
          contextName,
          callbacks,
          undefined, // No resume session
          options,
        );
      }

      logger.error('SDK query failed', { roomId, error });
      throw error;
    } finally {
      // Always close the query to clean up the underlying Claude process
      // This prevents zombie processes from accumulating
      queryObj.close();
    }
  }
}
