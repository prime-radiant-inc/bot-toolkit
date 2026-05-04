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
