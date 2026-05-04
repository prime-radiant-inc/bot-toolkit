// src/config/secrets/ssm.ts

import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Logger } from '../../utils/logger.js';
import type { SecretsReader } from '../configTypes.js';

const logger = new Logger('SSMSecretsReader');

/** How long cached secrets remain valid before re-fetching from SSM. */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Options for constructing SSMSecretsReader. All optional for backward compat. */
export interface SSMSecretsReaderOptions {
  /** Injected SSM client (defaults to new SSMClient with region from env). */
  client?: SSMClient;
  /** SSM path prefix (defaults to env SSM_PATH_PREFIX or /sen/{INSTANCE_NAME}/). */
  pathPrefix?: string;
}

/**
 * AWS SSM Parameter Store secrets reader.
 * Caches fetched secrets in memory with a TTL to avoid redundant API calls.
 * Cache is invalidated when the TTL expires or the requested key set changes.
 */
export class SSMSecretsReader implements SecretsReader {
  private readonly client: SSMClient;
  private readonly pathPrefix: string;

  private cachedSecrets: Record<string, string> | null = null;
  private cachedKeyFingerprint: string | null = null;
  private cacheTimestamp: number = 0;

  constructor(options?: SSMSecretsReaderOptions) {
    // Client: injected or default
    this.client =
      options?.client ??
      new SSMClient({
        region: process.env.AWS_REGION ?? 'us-west-1',
      });

    // Path prefix: explicit option > env override > derived from INSTANCE_NAME
    if (options?.pathPrefix) {
      const prefix = options.pathPrefix;
      this.pathPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    } else {
      const instanceName = process.env.INSTANCE_NAME;
      if (!process.env.SSM_PATH_PREFIX && !instanceName) {
        throw new Error(
          'SSM secrets backend requires INSTANCE_NAME or SSM_PATH_PREFIX env var',
        );
      }
      const defaultPrefix = instanceName ? `/sen/${instanceName}/` : '/sen/';
      const prefix = process.env.SSM_PATH_PREFIX ?? defaultPrefix;
      this.pathPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    }
  }

  private buildPath(name: string): string {
    return `${this.pathPrefix}${name}`;
  }

  private extractName(path: string): string {
    return path.startsWith(this.pathPrefix)
      ? path.slice(this.pathPrefix.length)
      : path;
  }

  /**
   * Build a stable fingerprint from a set of key names for cache comparison.
   * Sorted so order doesn't matter.
   */
  private keyFingerprint(names: string[]): string {
    return [...names].sort().join('\0');
  }

  async getAll(names: string[]): Promise<Record<string, string>> {
    if (names.length === 0) return {};

    // Deduplicate keys to avoid redundant SSM requests and fingerprint instability
    const uniqueNames = [...new Set(names)];

    // Check cache: valid if TTL not expired and same key set
    const fingerprint = this.keyFingerprint(uniqueNames);
    const now = Date.now();
    if (
      this.cachedSecrets &&
      this.cachedKeyFingerprint === fingerprint &&
      now - this.cacheTimestamp < CACHE_TTL_MS
    ) {
      logger.info('SSM cache hit', { keys: uniqueNames.length });
      return { ...this.cachedSecrets };
    }

    const startTime = Date.now();
    const result: Record<string, string> = {};
    const allMissing: string[] = [];

    // Batch into groups of 10 (AWS API limit)
    const batches = this.chunk(uniqueNames, 10);

    for (const batch of batches) {
      try {
        const response = await this.client.send(
          new GetParametersCommand({
            Names: batch.map((n) => this.buildPath(n)),
            WithDecryption: true,
          }),
        );

        // Collect found parameters
        for (const param of response.Parameters || []) {
          if (param.Name && param.Value) {
            const name = this.extractName(param.Name);
            result[name] = param.Value;
          }
        }

        // Track missing (but don't log names - security)
        if (response.InvalidParameters?.length) {
          allMissing.push(...response.InvalidParameters);
        }
      } catch (error) {
        throw new Error(`SSM fetch failed: ${(error as Error).message}`);
      }
    }

    const durationMs = Date.now() - startTime;

    // Log fetch metrics (without secret names - security)
    logger.info('SSM fetch complete', {
      requested: uniqueNames.length,
      found: Object.keys(result).length,
      missing: allMissing.length,
      durationMs,
    });

    // Warn about missing secrets that may cause MCPs to fail
    if (allMissing.length > 0) {
      logger.warn('Some secrets not found in SSM - some MCPs may fail', {
        missingCount: allMissing.length,
      });
    }

    // Populate cache (shallow copy so callers can't mutate cached data)
    this.cachedSecrets = { ...result };
    this.cachedKeyFingerprint = fingerprint;
    this.cacheTimestamp = now;

    return result;
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
