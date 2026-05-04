export type BotToolkitMcpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type BotToolkitMcpSseServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};

export type BotToolkitMcpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

export type BotToolkitMcpSdkServerConfigWithInstance = {
  type: 'sdk';
  name: string;
  instance: unknown;
};

export type BotToolkitMcpServerConfig =
  | BotToolkitMcpStdioServerConfig
  | BotToolkitMcpSseServerConfig
  | BotToolkitMcpHttpServerConfig
  | BotToolkitMcpSdkServerConfigWithInstance;

export type BotToolkitToolContent = {
  type: 'text';
  text: string;
};

export type BotToolkitTaskToolHandler = (
  args: Record<string, unknown>,
  context: unknown,
) => Promise<{ content: BotToolkitToolContent[] }>;

export type BotToolkitToolInputSchema = Record<string, unknown>;

export interface BotToolkitTaskTool {
  name: string;
  handler: BotToolkitTaskToolHandler;
}
