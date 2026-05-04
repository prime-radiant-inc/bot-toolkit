import {
  createSdkMcpServer,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  BotToolkitMcpSdkServerConfigWithInstance,
  BotToolkitMcpServerConfig,
  BotToolkitTaskTool,
  BotToolkitTaskToolHandler,
  BotToolkitToolInputSchema,
} from './sdkTypes.js';

type ClaudeSdkToolDefinitions = Parameters<
  typeof createSdkMcpServer
>[0]['tools'];
type ClaudeSdkToolSchema = Parameters<typeof tool>[2];
type ClaudeSdkToolHandler = Parameters<typeof tool>[3];
type ClaudeSdkQueryOptions = NonNullable<
  Parameters<typeof query>[0]['options']
>;

type BotToolkitSdkContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown };

type BotToolkitSdkStreamEvent =
  | { type: 'content_block_start'; content_block?: { type?: string } }
  | { type: 'content_block_delta'; delta?: BotToolkitSdkTextDelta };

type BotToolkitSdkTextDelta = {
  type: 'text_delta';
  text: string;
};

type BotToolkitSdkMessage =
  | { type: 'system'; subtype: 'init'; session_id: string }
  | {
      type: 'system';
      subtype: 'compact_boundary';
      compact_metadata: { pre_tokens: number; trigger: 'manual' | 'auto' };
    }
  | {
      type: 'assistant';
      message?: { content?: BotToolkitSdkContentBlock[] };
    }
  | { type: 'stream_event'; event?: BotToolkitSdkStreamEvent }
  | {
      type: 'result';
      usage: {
        input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      };
      total_cost_usd?: number;
      duration_ms?: number;
      structured_output?: unknown;
    };

type BotToolkitSdkQuery = AsyncGenerator<BotToolkitSdkMessage, void> & {
  close(): void;
};

export function createBotToolkitTool(
  name: string,
  description: string,
  inputSchema: BotToolkitToolInputSchema,
  handler: BotToolkitTaskToolHandler,
): BotToolkitTaskTool {
  return tool(
    name,
    description,
    inputSchema as ClaudeSdkToolSchema,
    handler as ClaudeSdkToolHandler,
  ) as unknown as BotToolkitTaskTool;
}

export function createBotToolkitSdkMcpServer(
  name: string,
  tools: BotToolkitTaskTool[],
): BotToolkitMcpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name,
    tools: tools as unknown as ClaudeSdkToolDefinitions,
  }) as BotToolkitMcpSdkServerConfigWithInstance;
}

export function toClaudeMcpServers(
  servers: Record<string, BotToolkitMcpServerConfig>,
): Record<string, unknown> {
  return servers as unknown as Record<string, unknown>;
}

export function queryClaude(
  prompt: string,
  options: unknown,
): BotToolkitSdkQuery {
  return query({
    prompt,
    options: options as ClaudeSdkQueryOptions,
  }) as unknown as BotToolkitSdkQuery;
}
