// src/core/sessionManagerUtils.ts
// Pure functions extracted from sessionManagerSDK for testability

import type { Platform, SessionStats } from './types.js';

/**
 * Build platform-specific environment variables for MCP servers and Claude subprocess.
 */
export function buildPlatformEnv(
  roomId: string,
  platform: Platform,
): Record<string, string> {
  return {
    MATRIX_ROOM_ID: roomId,
    ...(platform === 'native' ? { NATIVE_SESSION_ID: roomId } : {}),
    ...(platform === 'slack' ? { SLACK_CHANNEL_ID: roomId } : {}),
  };
}

/**
 * Parse log level from Claude Code's stderr output format: "timestamp [LEVEL] ..."
 * Returns the appropriate log level, defaulting to 'error' for unrecognized formats.
 */
export function parseStderrLogLevel(
  message: string,
): 'debug' | 'info' | 'warn' | 'error' {
  if (message.includes('[DEBUG]')) return 'debug';
  if (message.includes('[INFO]')) return 'info';
  if (message.includes('[WARN]')) return 'warn';
  return 'error';
}

/**
 * Resolve the final response text from streaming text and optional structured output.
 * Structured output takes priority when present.
 */
export function resolveResponseText(
  currentText: string,
  structuredOutput: unknown,
): string {
  if (structuredOutput === undefined) return currentText;
  return typeof structuredOutput === 'string'
    ? structuredOutput
    : JSON.stringify(structuredOutput);
}

/**
 * Check if an error message indicates a missing/stale session that should trigger retry.
 */
export function isSessionNotFoundError(errorMessage: string): boolean {
  return (
    errorMessage.includes('exited with code 1') ||
    errorMessage.includes('No conversation found') ||
    errorMessage.includes('ENOENT')
  );
}

/** Usage fields from the Claude SDK result message */
export interface QueryUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/**
 * Build a SessionStats object from SDK result fields.
 */
export function buildSessionStats(
  usage: QueryUsage,
  totalCostUsd: number,
  durationMs: number,
  compactionCount: number,
): SessionStats {
  return {
    contextTokens:
      (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0),
    outputTokens: usage.output_tokens || 0,
    costUsd: totalCostUsd,
    durationMs,
    compactionCount,
  };
}
