import { describe, expect, it } from 'vitest';
import type { ResolvedMcp } from '../../config/configTypes.js';
import { buildMcpServers, buildSdkEnv } from '../sessionManagerSDK.js';

interface UnknownResolvedMcp {
  id: string;
  type: string;
  url: string;
}

describe('buildMcpServers', () => {
  const platformEnv = {
    ROOM_ID: 'native:room',
    PLATFORM: 'native',
  };

  it('stdio MCP produces { command, args, env } shape (no type field)', () => {
    const mcps: ResolvedMcp[] = [
      {
        id: 'local',
        type: 'stdio' as const,
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'key123' },
      },
    ];

    const result = buildMcpServers(mcps, platformEnv);

    expect(result.local).toEqual({
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'key123', ...platformEnv },
    });
    expect(result.local).not.toHaveProperty('type');
  });

  it('remote HTTP MCP produces { type, url, headers } shape', () => {
    const mcps: ResolvedMcp[] = [
      {
        id: 'linear',
        type: 'http' as const,
        url: 'https://mcp.linear.app/mcp',
        headers: { Authorization: 'Bearer tok_abc' },
      },
    ];

    const result = buildMcpServers(mcps, platformEnv);

    expect(result.linear).toEqual({
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: 'Bearer tok_abc' },
    });
  });

  it('remote SSE MCP produces { type, url, headers } shape', () => {
    const mcps: ResolvedMcp[] = [
      {
        id: 'notion',
        type: 'sse' as const,
        url: 'https://mcp.notion.com/sse',
        headers: { Authorization: 'Bearer ntn_abc' },
      },
    ];

    const result = buildMcpServers(mcps, platformEnv);

    expect(result.notion).toEqual({
      type: 'sse',
      url: 'https://mcp.notion.com/sse',
      headers: { Authorization: 'Bearer ntn_abc' },
    });
  });

  it('stdio env includes platformEnv; remote does not', () => {
    const mcps: ResolvedMcp[] = [
      {
        id: 'local',
        type: 'stdio' as const,
        command: 'node',
        args: ['server.js'],
        env: {},
      },
      {
        id: 'remote',
        type: 'http' as const,
        url: 'https://mcp.example.com/mcp',
        headers: {},
      },
    ];

    const result = buildMcpServers(mcps, platformEnv);

    expect(result.local.env).toEqual(platformEnv);
    expect(result.remote).not.toHaveProperty('env');
  });

  it('mixed array produces correct shapes for each type', () => {
    const mcps: ResolvedMcp[] = [
      {
        id: 'stdio1',
        type: 'stdio' as const,
        command: 'node',
        args: ['a.js'],
        env: { A: '1' },
      },
      {
        id: 'http1',
        type: 'http' as const,
        url: 'https://mcp.example.com/mcp',
        headers: { Auth: 'Bearer tok' },
      },
      {
        id: 'sse1',
        type: 'sse' as const,
        url: 'https://mcp.example.com/sse',
        headers: {},
      },
    ];

    const result = buildMcpServers(mcps, platformEnv);

    expect(Object.keys(result)).toHaveLength(3);
    expect(result.stdio1).toHaveProperty('command');
    expect(result.http1).toHaveProperty('url');
    expect(result.sse1).toHaveProperty('url');
    expect(result.http1.type).toBe('http');
    expect(result.sse1.type).toBe('sse');
  });

  it('unknown type value is silently skipped', () => {
    const mcps: UnknownResolvedMcp[] = [
      {
        id: 'weird',
        type: 'unknown-type',
        url: 'https://whatever.com',
      },
    ];

    const result = buildMcpServers(
      mcps as unknown as ResolvedMcp[],
      platformEnv,
    );

    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('buildSdkEnv', () => {
  it('includes platform env and debug flag while excluding broad host secrets', () => {
    const env = buildSdkEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/bot',
        AWS_SECRET_ACCESS_KEY: 'do-not-pass',
        GITHUB_TOKEN: 'do-not-pass',
        LINEAR_API_KEY: 'do-not-pass',
        ANTHROPIC_API_KEY: 'anthropic-key',
      },
      { ROOM_ID: 'native:abc', PLATFORM: 'native' },
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/bot',
      ANTHROPIC_API_KEY: 'anthropic-key',
      ROOM_ID: 'native:abc',
      PLATFORM: 'native',
      DEBUG_CLAUDE_AGENT_SDK: 'true',
    });
  });

  it('omits undefined allowlisted variables', () => {
    const env = buildSdkEnv({}, { ROOM_ID: 'email:inbox', PLATFORM: 'email' });

    expect(env).toEqual({
      ROOM_ID: 'email:inbox',
      PLATFORM: 'email',
      DEBUG_CLAUDE_AGENT_SDK: 'true',
    });
  });
});
