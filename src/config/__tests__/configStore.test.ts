import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../configStore.js';
import type { SecretsReader } from '../configTypes.js';

function createMockSecretsReader(
  secrets: Record<string, string> = {},
): SecretsReader {
  return {
    getAll: vi.fn(async (names: string[]) => {
      const result: Record<string, string> = {};
      for (const name of names) {
        if (secrets[name] !== undefined) {
          result[name] = secrets[name];
        }
      }
      return result;
    }),
  };
}

function writeConfig(configDir: string, config: Record<string, unknown>): void {
  writeFileSync(join(configDir, 'instance.json'), JSON.stringify(config));
}

describe('ConfigStore', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'configstore-test-'));
  });

  describe('getEnabledMcps - stdio regression', () => {
    it('returns only enabled, non-special MCPs', async () => {
      writeConfig(configDir, {
        mcps: {
          active: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
          },
          disabled: {
            enabled: false,
            command: 'node',
            args: ['disabled.js'],
          },
          special: {
            enabled: true,
            command: 'node',
            args: ['special.js'],
            special: true,
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      expect(mcps[0].id).toBe('active');
    });

    it('batch-fetches all envFrom keys and resolves them into env', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp1: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            envFrom: ['API_KEY'],
          },
          mcp2: {
            enabled: true,
            command: 'node',
            args: ['other.js'],
            envFrom: ['DB_URL'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { API_KEY: 'key123', DB_URL: 'postgres://...' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(2);
      const mcp1 = mcps.find((m) => m.id === 'mcp1')!;
      const mcp2 = mcps.find((m) => m.id === 'mcp2')!;
      expect(mcp1.env).toHaveProperty('API_KEY', 'key123');
      expect(mcp2.env).toHaveProperty('DB_URL', 'postgres://...');
    });

    it('merges static env with fetched envFrom secrets', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { STATIC_VAR: 'hello' },
            envFrom: ['SECRET_VAR'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { SECRET_VAR: 'secret123' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env).toEqual({
        STATIC_VAR: 'hello',
        SECRET_VAR: 'secret123',
      });
    });

    it('envFrom secret overwrites same-named key in static env', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { SHARED_KEY: 'static-value' },
            envFrom: ['SHARED_KEY'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { SHARED_KEY: 'secret-value' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env.SHARED_KEY).toBe('secret-value');
    });

    it('resolves ~/ in command, args, and env values', async () => {
      const originalHome = process.env.HOME;
      process.env.HOME = '/home/testuser';

      try {
        writeConfig(configDir, {
          mcps: {
            mcp: {
              enabled: true,
              command: '~/bin/server',
              args: ['~/data/config.json'],
              env: { DB_PATH: '~/var/db' },
            },
          },
          plugins: {},
          knowledge: [],
        });

        const store = new ConfigStore(configDir, createMockSecretsReader());
        const mcps = await store.getEnabledMcps();

        expect(mcps[0].command).toBe('/home/testuser/bin/server');
        expect(mcps[0].args[0]).toBe('/home/testuser/data/config.json');
        expect(mcps[0].env.DB_PATH).toBe('/home/testuser/var/db');
      } finally {
        process.env.HOME = originalHome;
      }
    });

    it('omits MCPs with missing secrets gracefully', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { STATIC: 'yes' },
            envFrom: ['MISSING_SECRET', 'FOUND_SECRET'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { FOUND_SECRET: 'found' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      // MCP is still returned, just without the missing secret
      expect(mcps).toHaveLength(1);
      expect(mcps[0].env).toEqual({
        STATIC: 'yes',
        FOUND_SECRET: 'found',
      });
      expect(mcps[0].env).not.toHaveProperty('MISSING_SECRET');
    });

    it('propagates SecretsReader rejection', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            envFrom: ['KEY'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const failingReader: SecretsReader = {
        getAll: vi.fn(async () => {
          throw new Error('SSM connection failed');
        }),
      };

      const store = new ConfigStore(configDir, failingReader);
      await expect(store.getEnabledMcps()).rejects.toThrow(
        'SSM connection failed',
      );
    });
  });

  describe('getEnabledMcps - remote MCP resolution', () => {
    it('resolves HTTP remote MCP with ${SECRET} template in headers', async () => {
      writeConfig(configDir, {
        mcps: {
          linear: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.linear.app/mcp',
            headers: { Authorization: 'Bearer ${LINEAR_API_KEY}' },
            envFrom: ['LINEAR_API_KEY'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { LINEAR_API_KEY: 'lin_api_abc123' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      const mcp = mcps[0] as any;
      expect(mcp.type).toBe('http');
      expect(mcp.url).toBe('https://mcp.linear.app/mcp');
      expect(mcp.headers).toEqual({
        Authorization: 'Bearer lin_api_abc123',
      });
    });

    it('returns empty headers object when remote MCP has no headers', async () => {
      writeConfig(configDir, {
        mcps: {
          public: {
            enabled: true,
            type: 'sse',
            url: 'https://public-mcp.example.com/sse',
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      const mcp = mcps[0] as any;
      expect(mcp.type).toBe('sse');
      expect(mcp.headers).toEqual({});
    });

    it('resolves multiple ${...} templates in one header value', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://api.example.com/mcp',
            headers: {
              Authorization: '${TOKEN_TYPE} ${TOKEN_VALUE}',
              'X-Api-Key': '${API_KEY}',
            },
            envFrom: ['TOKEN_TYPE', 'TOKEN_VALUE', 'API_KEY'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = {
        TOKEN_TYPE: 'Bearer',
        TOKEN_VALUE: 'tok_abc123',
        API_KEY: 'key_xyz',
      };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      const mcp = mcps[0] as any;
      expect(mcp.headers.Authorization).toBe('Bearer tok_abc123');
      expect(mcp.headers['X-Api-Key']).toBe('key_xyz');
    });

    it('does NOT apply ~/ path resolution to remote MCP URL', async () => {
      const originalHome = process.env.HOME;
      process.env.HOME = '/home/testuser';

      try {
        writeConfig(configDir, {
          mcps: {
            mcp: {
              enabled: true,
              type: 'http',
              url: 'https://example.com/~/mcp',
              headers: {},
            },
          },
          plugins: {},
          knowledge: [],
        });

        const store = new ConfigStore(configDir, createMockSecretsReader());
        const mcps = await store.getEnabledMcps();

        const mcp = mcps[0] as any;
        expect(mcp.url).toBe('https://example.com/~/mcp');
      } finally {
        process.env.HOME = originalHome;
      }
    });

    it('skips remote MCP when header template has unresolved secret', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://api.example.com/mcp',
            headers: { Authorization: 'Bearer ${MISSING_TOKEN}' },
            envFrom: ['MISSING_TOKEN'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const store = new ConfigStore(configDir, createMockSecretsReader());
        const mcps = await store.getEnabledMcps();

        expect(mcps).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('MISSING_TOKEN'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('empty-string secret does NOT trigger fail-safe skip', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://api.example.com/mcp',
            headers: { Authorization: '${EMPTY_TOKEN}' },
            envFrom: ['EMPTY_TOKEN'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { EMPTY_TOKEN: '' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      const mcp = mcps[0] as any;
      expect(mcp.headers.Authorization).toBe('');
    });
  });

  describe('getEnabledMcps - mixed config', () => {
    it('returns both stdio and remote MCPs with correct shapes', async () => {
      writeConfig(configDir, {
        mcps: {
          local: {
            enabled: true,
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { PORT: '3000' },
          },
          remote: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/mcp',
            headers: { 'X-Key': '${API_KEY}' },
            envFrom: ['API_KEY'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { API_KEY: 'key123' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(2);

      const stdio = mcps.find((m) => m.id === 'local')! as any;
      expect(stdio.type).toBe('stdio');
      expect(stdio.command).toBe('node');
      expect(stdio.args).toEqual(['server.js']);
      expect(stdio.env).toHaveProperty('PORT', '3000');

      const remote = mcps.find((m) => m.id === 'remote')! as any;
      expect(remote.type).toBe('http');
      expect(remote.url).toBe('https://mcp.example.com/mcp');
      expect(remote.headers).toEqual({ 'X-Key': 'key123' });
    });

    it('collects envFrom from both types in one batch fetch', async () => {
      writeConfig(configDir, {
        mcps: {
          stdio: {
            enabled: true,
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            envFrom: ['STDIO_SECRET'],
          },
          remote: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/mcp',
            headers: { Authorization: 'Bearer ${REMOTE_SECRET}' },
            envFrom: ['REMOTE_SECRET'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = {
        STDIO_SECRET: 'stdio_val',
        REMOTE_SECRET: 'remote_val',
      };
      const reader = createMockSecretsReader(secrets);
      const store = new ConfigStore(configDir, reader);
      const mcps = await store.getEnabledMcps();

      // Both secrets fetched in a single batch call
      expect(reader.getAll).toHaveBeenCalledTimes(1);
      expect(reader.getAll).toHaveBeenCalledWith(
        expect.arrayContaining(['STDIO_SECRET', 'REMOTE_SECRET']),
      );

      const stdio = mcps.find((m) => m.id === 'stdio')! as any;
      expect(stdio.env.STDIO_SECRET).toBe('stdio_val');

      const remote = mcps.find((m) => m.id === 'remote')! as any;
      expect(remote.headers.Authorization).toBe('Bearer remote_val');
    });

    it('skips disabled and special remote MCPs', async () => {
      writeConfig(configDir, {
        mcps: {
          disabledRemote: {
            enabled: false,
            type: 'http',
            url: 'https://disabled.example.com/mcp',
          },
          specialRemote: {
            enabled: true,
            type: 'sse',
            url: 'https://special.example.com/sse',
            special: true,
          },
          activeRemote: {
            enabled: true,
            type: 'http',
            url: 'https://active.example.com/mcp',
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      expect(mcps[0].id).toBe('activeRemote');
    });
  });

  describe('config normalization', () => {
    it('normalizes missing type to stdio', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      expect((mcps[0] as any).type).toBe('stdio');
    });

    it('normalizes streamable-http to http', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'streamable-http',
            url: 'https://mcp.example.com/mcp',
            headers: {},
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      const mcps = await store.getEnabledMcps();

      expect(mcps).toHaveLength(1);
      expect((mcps[0] as any).type).toBe('http');
    });
  });

  describe('getEnabledMcps - stdio env template resolution', () => {
    it('resolves ${VAR} templates in env values using fetched secrets', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { API_TOKEN: '${WORK_TOKEN}' },
            envFrom: ['WORK_TOKEN'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { WORK_TOKEN: 'tok_abc123' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env).toHaveProperty('API_TOKEN', 'tok_abc123');
      expect(mcps[0].env).toHaveProperty('WORK_TOKEN', 'tok_abc123');
    });

    it('resolves multiple ${...} templates in one env value', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { CONNECTION: '${PROTOCOL}://${HOST}' },
            envFrom: ['PROTOCOL', 'HOST'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { PROTOCOL: 'https', HOST: 'api.example.com' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env.CONNECTION).toBe('https://api.example.com');
    });

    it('leaves unresolved ${VAR} templates as-is', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { TOKEN: '${MISSING_SECRET}' },
            envFrom: ['MISSING_SECRET'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env.TOKEN).toBe('${MISSING_SECRET}');
    });

    it('does NOT recursively substitute ${...} in resolved secret values', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { TOKEN: '${SECRET}' },
            envFrom: ['SECRET'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { SECRET: '${NESTED_VALUE}' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env.TOKEN).toBe('${NESTED_VALUE}');
    });

    it('$VAR without braces passes through unchanged', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            env: { TOKEN: '$SECRET' },
            envFrom: ['SECRET'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { SECRET: 'resolved' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      expect(mcps[0].env.TOKEN).toBe('$SECRET');
    });

    it('does not template-resolve envFrom values themselves', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
            envFrom: ['MY_SECRET'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { MY_SECRET: '${SHOULD_NOT_RESOLVE}' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      // envFrom value inserted directly, not template-resolved
      expect(mcps[0].env.MY_SECRET).toBe('${SHOULD_NOT_RESOLVE}');
    });
  });

  describe('edge cases', () => {
    it('secret value containing ${...} is NOT recursively substituted', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/mcp',
            headers: { Authorization: '${TOKEN}' },
            envFrom: ['TOKEN'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { TOKEN: '${NESTED_VALUE}' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      const mcp = mcps[0] as any;
      expect(mcp.headers.Authorization).toBe('${NESTED_VALUE}');
    });

    it('URL containing ${...} is NOT template-substituted', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/${path}/mcp',
            headers: {},
            envFrom: ['path'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { path: 'replaced' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      const mcp = mcps[0] as any;
      expect(mcp.url).toBe('https://mcp.example.com/${path}/mcp');
    });

    it('hyphenated secret name ${MY-API-KEY} matches correctly', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/mcp',
            headers: { Authorization: 'Bearer ${MY-API-KEY}' },
            envFrom: ['MY-API-KEY'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { 'MY-API-KEY': 'key_abc' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      const mcp = mcps[0] as any;
      expect(mcp.headers.Authorization).toBe('Bearer key_abc');
    });

    it('partial template $SECRET (no braces) passes through unchanged', async () => {
      writeConfig(configDir, {
        mcps: {
          mcp: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/mcp',
            headers: { Authorization: 'Bearer $TOKEN' },
            envFrom: ['TOKEN'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const secrets = { TOKEN: 'replaced' };
      const store = new ConfigStore(
        configDir,
        createMockSecretsReader(secrets),
      );
      const mcps = await store.getEnabledMcps();

      const mcp = mcps[0] as any;
      expect(mcp.headers.Authorization).toBe('Bearer $TOKEN');
    });

    it('setMcpEnabled() preserves remote MCP fields during JSON round-trip', () => {
      writeConfig(configDir, {
        mcps: {
          remote: {
            enabled: true,
            type: 'http',
            url: 'https://mcp.example.com/mcp',
            headers: { Authorization: 'Bearer ${TOKEN}' },
            envFrom: ['TOKEN'],
          },
          stdio: {
            enabled: true,
            command: 'node',
            args: ['server.js'],
          },
        },
        plugins: {},
        knowledge: [],
      });

      const store = new ConfigStore(configDir, createMockSecretsReader());
      store.setMcpEnabled('remote', false);

      const written = JSON.parse(
        readFileSync(join(configDir, 'instance.json'), 'utf-8'),
      );
      expect(written.mcps.remote.enabled).toBe(false);
      expect(written.mcps.remote.type).toBe('http');
      expect(written.mcps.remote.url).toBe('https://mcp.example.com/mcp');
      expect(written.mcps.remote.headers).toEqual({
        Authorization: 'Bearer ${TOKEN}',
      });
      expect(written.mcps.remote.envFrom).toEqual(['TOKEN']);
      expect(written.mcps.stdio.enabled).toBe(true);
    });
  });
});
