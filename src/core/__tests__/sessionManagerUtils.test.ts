import { describe, expect, it } from 'vitest';
import {
  buildPlatformEnv,
  buildSessionStats,
  isSessionNotFoundError,
  parseStderrLogLevel,
  resolveResponseText,
} from '../sessionManagerUtils.js';

describe('buildPlatformEnv', () => {
  it('should always include generic room and platform variables', () => {
    const env = buildPlatformEnv('room-123', 'email');
    expect(env.ROOM_ID).toBe('email:room-123');
    expect(env.PLATFORM).toBe('email');
  });

  it('should include NATIVE_SESSION_ID for native platform', () => {
    const env = buildPlatformEnv('native-session-abc', 'native');
    expect(env.ROOM_ID).toBe('native:native-session-abc');
    expect(env.PLATFORM).toBe('native');
    expect(env.NATIVE_SESSION_ID).toBe('native-session-abc');
  });

  it('should include SLACK_CHANNEL_ID for slack platform', () => {
    const env = buildPlatformEnv('C0123SLACK', 'slack');
    expect(env.ROOM_ID).toBe('slack:C0123SLACK');
    expect(env.PLATFORM).toBe('slack');
    expect(env.SLACK_CHANNEL_ID).toBe('C0123SLACK');
  });

  it('should not include platform-specific vars for email platform', () => {
    const env = buildPlatformEnv('inbox-thread', 'email');
    expect(env.NATIVE_SESSION_ID).toBeUndefined();
    expect(env.SLACK_CHANNEL_ID).toBeUndefined();
  });

  it('should not include SLACK_CHANNEL_ID for native platform', () => {
    const env = buildPlatformEnv('native-1', 'native');
    expect(env.SLACK_CHANNEL_ID).toBeUndefined();
  });
});

describe('parseStderrLogLevel', () => {
  it('should return debug for DEBUG messages', () => {
    expect(parseStderrLogLevel('2026-02-06T12:00:00Z [DEBUG] something')).toBe(
      'debug',
    );
  });

  it('should return info for INFO messages', () => {
    expect(parseStderrLogLevel('2026-02-06T12:00:00Z [INFO] started')).toBe(
      'info',
    );
  });

  it('should return warn for WARN messages', () => {
    expect(parseStderrLogLevel('2026-02-06T12:00:00Z [WARN] slow query')).toBe(
      'warn',
    );
  });

  it('should return error for unrecognized format', () => {
    expect(parseStderrLogLevel('some raw error output')).toBe('error');
  });

  it('should return error for empty string', () => {
    expect(parseStderrLogLevel('')).toBe('error');
  });
});

describe('resolveResponseText', () => {
  it('should return currentText when no structured output', () => {
    expect(resolveResponseText('hello world', undefined)).toBe('hello world');
  });

  it('should return string structured output directly', () => {
    expect(resolveResponseText('streaming text', 'structured answer')).toBe(
      'structured answer',
    );
  });

  it('should JSON.stringify object structured output', () => {
    const obj = { answer: 42, valid: true };
    expect(resolveResponseText('streaming', obj)).toBe(JSON.stringify(obj));
  });

  it('should JSON.stringify array structured output', () => {
    const arr = [1, 2, 3];
    expect(resolveResponseText('streaming', arr)).toBe(JSON.stringify(arr));
  });

  it('should return currentText when structured output is undefined', () => {
    expect(resolveResponseText('fallback text', undefined)).toBe(
      'fallback text',
    );
  });

  it('should handle empty string currentText with no structured output', () => {
    expect(resolveResponseText('', undefined)).toBe('');
  });
});

describe('isSessionNotFoundError', () => {
  it('should detect "exited with code 1"', () => {
    expect(isSessionNotFoundError('Process exited with code 1')).toBe(true);
  });

  it('should detect "No conversation found"', () => {
    expect(
      isSessionNotFoundError('No conversation found for session abc-123'),
    ).toBe(true);
  });

  it('should detect ENOENT', () => {
    expect(isSessionNotFoundError('ENOENT: no such file or directory')).toBe(
      true,
    );
  });

  it('should return false for unrelated errors', () => {
    expect(isSessionNotFoundError('Connection timeout')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isSessionNotFoundError('')).toBe(false);
  });

  it('should return false for rate limit errors', () => {
    expect(isSessionNotFoundError('Rate limit exceeded')).toBe(false);
  });
});

describe('buildSessionStats', () => {
  it('should build stats from usage fields', () => {
    const stats = buildSessionStats(
      { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 200 },
      0.05,
      1500,
      2,
    );
    expect(stats).toEqual({
      contextTokens: 150,
      outputTokens: 200,
      costUsd: 0.05,
      durationMs: 1500,
      compactionCount: 2,
    });
  });

  it('should handle missing optional usage fields', () => {
    const stats = buildSessionStats({}, 0, 0, 0);
    expect(stats).toEqual({
      contextTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
      compactionCount: 0,
    });
  });

  it('should handle zero cache tokens', () => {
    const stats = buildSessionStats(
      { input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 100 },
      0.01,
      800,
      0,
    );
    expect(stats.contextTokens).toBe(500);
  });

  it('should pass through compaction count as-is', () => {
    const stats = buildSessionStats(
      { input_tokens: 0, output_tokens: 0 },
      0,
      0,
      7,
    );
    expect(stats.compactionCount).toBe(7);
  });
});
