import { SSMClient } from '@aws-sdk/client-ssm';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { SSMSecretsReader } from '../ssm.js';

interface FakeGetParametersCommand {
  input: {
    Names: string[];
  };
}

interface FakeGetParametersResponse {
  Parameters: Array<{ Name: string; Value: string }>;
  InvalidParameters: string[];
}

type FakeSSMSend = Mock<
  (command: FakeGetParametersCommand) => Promise<FakeGetParametersResponse>
>;

type FakeSSMClient = SSMClient & { send: FakeSSMSend };

function createFakeSSMClientWithSend(send: FakeSSMSend): FakeSSMClient {
  const client = new SSMClient({ region: 'us-west-1' });
  client.send = send as unknown as SSMClient['send'];
  return Object.assign(client, { send });
}

/**
 * Minimal fake SSM client that mimics AWS SDK GetParametersCommand responses.
 * Tracks call count so we can verify caching prevents redundant fetches.
 */
function createFakeSSMClient(secrets: Record<string, string>): FakeSSMClient {
  const send = vi.fn(async (command: FakeGetParametersCommand) => {
    const names: string[] = command.input.Names;
    const Parameters: FakeGetParametersResponse['Parameters'] = [];
    const InvalidParameters: string[] = [];
    for (const name of names) {
      if (secrets[name] !== undefined) {
        Parameters.push({ Name: name, Value: secrets[name] });
      } else {
        InvalidParameters.push(name);
      }
    }
    return { Parameters, InvalidParameters };
  });

  return createFakeSSMClientWithSend(send);
}

describe('SSMSecretsReader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('derives pathPrefix from INSTANCE_NAME when no options provided', async () => {
      process.env.INSTANCE_NAME = 'drew-prod';
      delete process.env.SSM_PATH_PREFIX;

      const client = createFakeSSMClient({
        '/sen/drew-prod/API_KEY': 'key123',
      });
      const reader = new SSMSecretsReader({ client });

      const result = await reader.getAll(['API_KEY']);

      expect(result).toEqual({ API_KEY: 'key123' });
    });

    it('SSM_PATH_PREFIX takes precedence over INSTANCE_NAME', async () => {
      process.env.INSTANCE_NAME = 'drew-prod';
      process.env.SSM_PATH_PREFIX = '/custom/path/';

      const client = createFakeSSMClient({
        '/custom/path/API_KEY': 'from_custom',
      });
      const reader = new SSMSecretsReader({ client });

      const result = await reader.getAll(['API_KEY']);

      expect(result).toEqual({ API_KEY: 'from_custom' });
    });

    it('SSM_PATH_PREFIX works without INSTANCE_NAME', async () => {
      delete process.env.INSTANCE_NAME;
      process.env.SSM_PATH_PREFIX = '/override/';

      const client = createFakeSSMClient({
        '/override/SECRET': 'val',
      });
      const reader = new SSMSecretsReader({ client });

      const result = await reader.getAll(['SECRET']);

      expect(result).toEqual({ SECRET: 'val' });
    });

    it('throws when neither INSTANCE_NAME nor SSM_PATH_PREFIX is set', () => {
      delete process.env.INSTANCE_NAME;
      delete process.env.SSM_PATH_PREFIX;

      expect(
        () => new SSMSecretsReader({ client: createFakeSSMClient({}) }),
      ).toThrow(
        'SSM secrets backend requires INSTANCE_NAME or SSM_PATH_PREFIX env var',
      );
    });

    it('appends trailing slash to SSM_PATH_PREFIX if missing', async () => {
      delete process.env.INSTANCE_NAME;
      process.env.SSM_PATH_PREFIX = '/no-slash';

      const client = createFakeSSMClient({
        '/no-slash/KEY': 'val',
      });
      const reader = new SSMSecretsReader({ client });

      const result = await reader.getAll(['KEY']);

      expect(result).toEqual({ KEY: 'val' });
    });

    it('appends trailing slash to options.pathPrefix if missing', async () => {
      const client = createFakeSSMClient({
        '/explicit/KEY': 'val',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/explicit',
      });

      const result = await reader.getAll(['KEY']);

      expect(result).toEqual({ KEY: 'val' });
    });

    it('options.pathPrefix takes precedence over env vars', async () => {
      process.env.INSTANCE_NAME = 'drew-prod';
      process.env.SSM_PATH_PREFIX = '/env-prefix/';

      const client = createFakeSSMClient({
        '/option-prefix/KEY': 'from_option',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/option-prefix/',
      });

      const result = await reader.getAll(['KEY']);

      expect(result).toEqual({ KEY: 'from_option' });
    });
  });

  describe('duplicate key deduplication', () => {
    it('deduplicates keys before fetching from SSM', async () => {
      const client = createFakeSSMClient({
        '/test/KEY': 'value',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const result = await reader.getAll(['KEY', 'KEY', 'KEY']);

      expect(result).toEqual({ KEY: 'value' });
      // Should only send KEY once, not three times
      const sentNames = client.send.mock.calls[0][0].input.Names;
      expect(sentNames).toEqual(['/test/KEY']);
    });

    it('duplicate keys produce same cache fingerprint as deduplicated', async () => {
      const client = createFakeSSMClient({
        '/test/KEY_A': 'a',
        '/test/KEY_B': 'b',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['KEY_A', 'KEY_B']);
      await reader.getAll(['KEY_A', 'KEY_A', 'KEY_B']);

      // Should be a cache hit, not a re-fetch
      expect(client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('basic fetch', () => {
    it('fetches secrets from SSM on first call', async () => {
      const client = createFakeSSMClient({
        '/test/API_KEY': 'key123',
        '/test/DB_URL': 'postgres://localhost',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const result = await reader.getAll(['API_KEY', 'DB_URL']);

      expect(result).toEqual({
        API_KEY: 'key123',
        DB_URL: 'postgres://localhost',
      });
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('returns empty record for empty names array without calling SSM', async () => {
      const client = createFakeSSMClient({});
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const result = await reader.getAll([]);

      expect(result).toEqual({});
      expect(client.send).not.toHaveBeenCalled();
    });

    it('omits missing secrets from result', async () => {
      const client = createFakeSSMClient({
        '/test/FOUND': 'value',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const result = await reader.getAll(['FOUND', 'MISSING']);

      expect(result).toEqual({ FOUND: 'value' });
      expect(result).not.toHaveProperty('MISSING');
    });
  });

  describe('TTL caching', () => {
    it('returns cached secrets on second call within TTL', async () => {
      const client = createFakeSSMClient({
        '/test/API_KEY': 'key123',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['API_KEY']);
      const result = await reader.getAll(['API_KEY']);

      expect(result).toEqual({ API_KEY: 'key123' });
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after TTL expires', async () => {
      const client = createFakeSSMClient({
        '/test/API_KEY': 'key123',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['API_KEY']);

      // Advance past 5-minute TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      await reader.getAll(['API_KEY']);

      expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('serves from cache just before TTL expires', async () => {
      const client = createFakeSSMClient({
        '/test/API_KEY': 'key123',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['API_KEY']);

      // Advance to just under 5-minute TTL
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);

      await reader.getAll(['API_KEY']);

      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('returns fresh values after TTL re-fetch', async () => {
      let currentValue = 'original';
      const client = createFakeSSMClientWithSend(
        vi.fn(async (command: FakeGetParametersCommand) => ({
          Parameters: command.input.Names.map((name: string) => ({
            Name: name,
            Value: currentValue,
          })),
          InvalidParameters: [],
        })),
      );
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const first = await reader.getAll(['SECRET']);
      expect(first.SECRET).toBe('original');

      currentValue = 'rotated';
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const second = await reader.getAll(['SECRET']);
      expect(second.SECRET).toBe('rotated');
    });
  });

  describe('cache invalidation on key set change', () => {
    it('busts cache when requested keys differ', async () => {
      const client = createFakeSSMClient({
        '/test/KEY_A': 'a',
        '/test/KEY_B': 'b',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['KEY_A']);
      await reader.getAll(['KEY_A', 'KEY_B']);

      expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('cache hit when same keys requested in different order', async () => {
      const client = createFakeSSMClient({
        '/test/KEY_A': 'a',
        '/test/KEY_B': 'b',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['KEY_B', 'KEY_A']);
      await reader.getAll(['KEY_A', 'KEY_B']);

      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('busts cache when a key is removed from the set', async () => {
      const client = createFakeSSMClient({
        '/test/KEY_A': 'a',
        '/test/KEY_B': 'b',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      await reader.getAll(['KEY_A', 'KEY_B']);
      await reader.getAll(['KEY_A']);

      expect(client.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('cache mutation safety', () => {
    it('caller mutating returned object does not corrupt cache', async () => {
      const client = createFakeSSMClient({
        '/test/API_KEY': 'key123',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const first = await reader.getAll(['API_KEY']);
      // Caller mutates the result
      first.API_KEY = 'CORRUPTED';
      first.INJECTED = 'evil';

      const second = await reader.getAll(['API_KEY']);

      expect(second.API_KEY).toBe('key123');
      expect(second).not.toHaveProperty('INJECTED');
      // Should have served from cache, not re-fetched
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('two sequential calls return independent objects', async () => {
      const client = createFakeSSMClient({
        '/test/SECRET': 'value',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const first = await reader.getAll(['SECRET']);
      const second = await reader.getAll(['SECRET']);

      expect(first).toEqual(second);
      expect(first).not.toBe(second); // Different object references
    });
  });

  describe('error recovery', () => {
    it('failed SSM fetch does not poison cache', async () => {
      let shouldFail = true;
      const client = createFakeSSMClientWithSend(
        vi.fn(async (command: FakeGetParametersCommand) => {
          if (shouldFail) {
            throw new Error('SSM connection timeout');
          }
          return {
            Parameters: command.input.Names.map((name: string) => ({
              Name: name,
              Value: 'recovered',
            })),
            InvalidParameters: [],
          };
        }),
      );
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      // First call fails
      await expect(reader.getAll(['KEY'])).rejects.toThrow(
        'SSM fetch failed: SSM connection timeout',
      );

      // Second call succeeds — cache should not contain stale/partial data
      shouldFail = false;
      const result = await reader.getAll(['KEY']);

      expect(result).toEqual({ KEY: 'recovered' });
      expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('successful fetch after failure is cached normally', async () => {
      let callCount = 0;
      const client = createFakeSSMClientWithSend(
        vi.fn(async (command: FakeGetParametersCommand) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('transient failure');
          }
          return {
            Parameters: command.input.Names.map((name: string) => ({
              Name: name,
              Value: 'value',
            })),
            InvalidParameters: [],
          };
        }),
      );
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      // First call fails
      await expect(reader.getAll(['KEY'])).rejects.toThrow();

      // Second call succeeds and populates cache
      await reader.getAll(['KEY']);
      // Third call should be cached
      await reader.getAll(['KEY']);

      expect(client.send).toHaveBeenCalledTimes(2); // Not 3
    });
  });

  describe('partial batch failure', () => {
    it('does not cache partial results when second batch fails', async () => {
      let failOnBatch2 = true;
      let batchInCall = 0;
      const client = createFakeSSMClientWithSend(
        vi.fn(async (command: FakeGetParametersCommand) => {
          batchInCall++;
          // Fail on 2nd batch of each getAll call when flag is set
          if (failOnBatch2 && batchInCall % 2 === 0) {
            throw new Error('batch 2 failed');
          }
          return {
            Parameters: command.input.Names.map((name: string) => ({
              Name: name,
              Value: 'resolved',
            })),
            InvalidParameters: [],
          };
        }),
      );
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      // Request >10 keys to trigger multi-batch (10 + 5)
      const keys = Array.from({ length: 15 }, (_, i) => `KEY_${i}`);

      // First attempt: batch 1 succeeds, batch 2 fails
      await expect(reader.getAll(keys)).rejects.toThrow(
        'SSM fetch failed: batch 2 failed',
      );

      // Retry: disable failure, both batches succeed
      failOnBatch2 = false;
      const result = await reader.getAll(keys);

      expect(Object.keys(result)).toHaveLength(15);
      // 2 batches from failed attempt + 2 batches from successful retry = 4
      expect(client.send).toHaveBeenCalledTimes(4);
    });
  });

  describe('all-missing result', () => {
    it('caches result even when all secrets are missing', async () => {
      const client = createFakeSSMClient({}); // No secrets exist
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      const first = await reader.getAll(['MISSING_A', 'MISSING_B']);
      const second = await reader.getAll(['MISSING_A', 'MISSING_B']);

      expect(first).toEqual({});
      expect(second).toEqual({});
      expect(client.send).toHaveBeenCalledTimes(1); // Cached the empty result
    });
  });

  describe('instance isolation', () => {
    it('separate instances do not share cache', async () => {
      const clientA = createFakeSSMClient({ '/a/SECRET': 'from_a' });
      const clientB = createFakeSSMClient({ '/b/SECRET': 'from_b' });

      const readerA = new SSMSecretsReader({
        client: clientA,
        pathPrefix: '/a/',
      });
      const readerB = new SSMSecretsReader({
        client: clientB,
        pathPrefix: '/b/',
      });

      const resultA = await readerA.getAll(['SECRET']);
      const resultB = await readerB.getAll(['SECRET']);

      expect(resultA).toEqual({ SECRET: 'from_a' });
      expect(resultB).toEqual({ SECRET: 'from_b' });
      expect(clientA.send).toHaveBeenCalledTimes(1);
      expect(clientB.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent calls', () => {
    it('concurrent calls both resolve correctly', async () => {
      const client = createFakeSSMClient({
        '/test/KEY': 'value',
      });
      const reader = new SSMSecretsReader({
        client,
        pathPrefix: '/test/',
      });

      // Fire two calls simultaneously
      const [resultA, resultB] = await Promise.all([
        reader.getAll(['KEY']),
        reader.getAll(['KEY']),
      ]);

      expect(resultA).toEqual({ KEY: 'value' });
      expect(resultB).toEqual({ KEY: 'value' });
      // Both may fetch (no dedup on in-flight), but both return correct data
    });
  });
});
