// src/config/configTypes.ts

/**
 * MCP server configuration in instance.json (post-normalization).
 * Discriminated union on the `type` field.
 */
interface McpConfigBase {
  enabled: boolean;
  envFrom?: string[];
  special?: boolean;
}

export interface StdioMcpConfig extends McpConfigBase {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface RemoteMcpConfig extends McpConfigBase {
  type: 'sse' | 'http';
  url: string;
  headers?: Record<string, string>;
}

export type McpConfig = StdioMcpConfig | RemoteMcpConfig;

/**
 * Plugin configuration in instance.json
 */
export interface PluginConfig {
  enabled: boolean;
  path: string;
  special?: boolean;
}

/**
 * Full instance configuration structure
 */
export interface InstanceConfig {
  mcps: Record<string, McpConfig>;
  plugins: Record<string, PluginConfig>;
  knowledge: string[];
}

/**
 * Secrets file structure
 */
export type SecretsConfig = Record<string, string>;

/**
 * Resolved MCP configs ready for SDK.
 * Discriminated union on the `type` field.
 */
export interface ResolvedStdioMcp {
  id: string;
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ResolvedRemoteMcp {
  id: string;
  type: 'sse' | 'http';
  url: string;
  headers: Record<string, string>;
}

export type ResolvedMcp = ResolvedStdioMcp | ResolvedRemoteMcp;

/**
 * Resolved plugin config ready for SDK
 */
export interface ResolvedPlugin {
  id: string;
  path: string;
}

/**
 * Interface for reading secrets from various backends.
 * Implementations: LocalSecretsReader (file), SSMSecretsReader (AWS)
 */
export interface SecretsReader {
  /**
   * Fetch multiple secrets by name.
   * @param names - Array of secret names to fetch
   * @returns Record mapping secret names to values (missing secrets omitted)
   */
  getAll(names: string[]): Promise<Record<string, string>>;
}
