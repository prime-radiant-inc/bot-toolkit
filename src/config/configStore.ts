// src/config/configStore.ts

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import type {
  InstanceConfig,
  McpConfig,
  PluginConfig,
  RemoteMcpConfig,
  ResolvedMcp,
  ResolvedPlugin,
  SecretsReader,
} from './configTypes.js';

/** Pre-normalization MCP entry as it appears in instance.json */
interface RawMcpEntry {
  type?: string;
  enabled: boolean;
  envFrom?: string[];
  special?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** Pre-normalization instance.json structure */
interface RawInstanceConfig {
  mcps: Record<string, RawMcpEntry>;
  plugins: Record<string, PluginConfig>;
  knowledge?: string[];
}

function isRemoteMcp(mcp: McpConfig): mcp is RemoteMcpConfig {
  return mcp.type === 'sse' || mcp.type === 'http';
}

/**
 * Substitute ${SECRET_NAME} templates in header values using fetched secrets.
 * Returns resolved headers and any template variable names that had no matching secret.
 */
function resolveHeaderTemplates(
  headers: Record<string, string>,
  secrets: Record<string, string>,
): { resolved: Record<string, string>; unresolvedVars: string[] } {
  const resolved: Record<string, string> = {};
  const unresolvedVars: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = value.replace(/\$\{([\w.-]+)\}/g, (_, name) => {
      if (secrets[name] === undefined) {
        unresolvedVars.push(name);
        return '';
      }
      return secrets[name];
    });
  }
  return { resolved, unresolvedVars };
}

/**
 * ConfigStore reads MCP and plugin configuration from JSON files.
 * Configuration is hot-reloadable - changes are picked up on the next read.
 * Secrets are fetched via SecretsReader (supports file or SSM backends).
 */
export class ConfigStore {
  private configPath: string;
  private secretsReader: SecretsReader;
  private configCache: InstanceConfig | null = null;
  private configLastModified: number = 0;

  constructor(configDir: string, secretsReader: SecretsReader) {
    this.configPath = `${configDir}/instance.json`;
    this.secretsReader = secretsReader;
  }

  /**
   * Resolve paths that start with ~/ to the user's home directory.
   * Prefers process.env.HOME (explicitly set by container/deployment) over os.homedir().
   */
  private resolvePath(path: string): string {
    if (path.startsWith('~/')) {
      const home = process.env.HOME || os.homedir();
      return path.replace(/^~\//, `${home}/`);
    }
    return path;
  }

  /**
   * Load instance.json config, using cache if file hasn't changed.
   */
  private loadConfig(): InstanceConfig {
    const stat = existsSync(this.configPath)
      ? statSync(this.configPath).mtimeMs
      : 0;

    if (this.configCache && stat === this.configLastModified) {
      return this.configCache;
    }

    const raw = JSON.parse(
      readFileSync(this.configPath, 'utf-8'),
    ) as RawInstanceConfig;
    const config = this.normalizeConfig(raw);
    this.configCache = config;
    this.configLastModified = stat;
    return config;
  }

  /**
   * Normalize raw JSON into typed config.
   * - Defaults missing `type` to 'stdio' (backward compat with existing instance.json)
   * - Maps 'streamable-http' (MCP Registry convention) to 'http' (SDK convention)
   */
  private normalizeConfig(raw: RawInstanceConfig): InstanceConfig {
    const mcps: Record<string, McpConfig> = {};
    for (const [id, mcp] of Object.entries(raw.mcps)) {
      if (!mcp.type || mcp.type === 'stdio') {
        mcps[id] = { ...mcp, type: 'stdio' } as McpConfig;
      } else {
        const type = mcp.type === 'streamable-http' ? 'http' : mcp.type;
        mcps[id] = { ...mcp, type } as McpConfig;
      }
    }
    return { ...raw, mcps, knowledge: raw.knowledge ?? [] };
  }

  /**
   * Get all enabled MCPs with resolved secrets.
   * MCPs marked as 'special' are excluded (handled separately).
   * Stdio MCPs get env vars; remote MCPs get header template substitution.
   */
  async getEnabledMcps(): Promise<ResolvedMcp[]> {
    const config = this.loadConfig();

    // Collect all envFrom keys across enabled MCPs (both types use envFrom)
    const allKeys = new Set<string>();
    for (const mcp of Object.values(config.mcps)) {
      if (mcp.enabled && !mcp.special) {
        for (const key of mcp.envFrom || []) {
          allKeys.add(key);
        }
      }
    }

    // Batch fetch all secrets
    const secrets = await this.secretsReader.getAll([...allKeys]);

    // Build resolved MCPs
    const result: ResolvedMcp[] = [];
    for (const [id, mcp] of Object.entries(config.mcps)) {
      if (!mcp.enabled || mcp.special) continue;

      if (isRemoteMcp(mcp)) {
        // Remote MCP: substitute ${SECRET} templates in headers
        const { resolved, unresolvedVars } = resolveHeaderTemplates(
          mcp.headers ?? {},
          secrets,
        );

        if (unresolvedVars.length > 0) {
          console.warn(
            `[ConfigStore] Skipping remote MCP "${id}": unresolved template vars: ${unresolvedVars.join(', ')}`,
          );
          continue;
        }

        result.push({
          id,
          type: mcp.type,
          url: mcp.url,
          headers: resolved,
        });
      } else {
        // Stdio MCP: merge env + envFrom secrets, resolve ~ paths
        const env: Record<string, string> = { ...mcp.env };

        for (const key of mcp.envFrom || []) {
          if (secrets[key] !== undefined) {
            env[key] = secrets[key];
          }
        }

        // Resolve ${VAR} templates in env values using fetched secrets
        for (const [key, value] of Object.entries(env)) {
          env[key] = value.replace(/\$\{([\w.-]+)\}/g, (match, name) =>
            secrets[name] !== undefined ? secrets[name] : match,
          );
        }

        const resolvedArgs = mcp.args.map((arg) => this.resolvePath(arg));
        const resolvedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(env)) {
          resolvedEnv[key] = this.resolvePath(value);
        }

        result.push({
          id,
          type: 'stdio',
          command: this.resolvePath(mcp.command),
          args: resolvedArgs,
          env: resolvedEnv,
        });
      }
    }

    return result;
  }

  /**
   * Get all enabled plugins.
   */
  getEnabledPlugins(): ResolvedPlugin[] {
    const config = this.loadConfig();
    const result: ResolvedPlugin[] = [];

    for (const [id, plugin] of Object.entries(config.plugins)) {
      if (!plugin.enabled) continue;

      result.push({
        id,
        path: this.resolvePath(plugin.path),
      });
    }

    return result;
  }

  /**
   * Get knowledge directories (additionalDirectories for SDK).
   */
  getKnowledge(): string[] {
    const config = this.loadConfig();
    return (config.knowledge || []).map((dir) => this.resolvePath(dir));
  }

  /**
   * Enable or disable an MCP and persist to file.
   */
  setMcpEnabled(mcpId: string, enabled: boolean): void {
    const config = this.loadConfig();
    if (config.mcps[mcpId]) {
      config.mcps[mcpId].enabled = enabled;
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      this.configCache = null; // Invalidate cache
    }
  }

  /**
   * Enable or disable a plugin and persist to file.
   */
  setPluginEnabled(pluginId: string, enabled: boolean): void {
    const config = this.loadConfig();
    if (config.plugins[pluginId]) {
      config.plugins[pluginId].enabled = enabled;
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      this.configCache = null;
    }
  }
}
