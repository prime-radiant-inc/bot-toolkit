// src/config/secrets/local.ts

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { SecretsReader } from '../configTypes.js';

/**
 * File-based secrets reader for local development.
 * Reads from secrets.json, checks mtime for hot-reload.
 */
export class LocalSecretsReader implements SecretsReader {
  private secretsPath: string;
  private cache: Record<string, string> | null = null;
  private lastModified: number = 0;

  constructor(secretsPath: string) {
    this.secretsPath = secretsPath;
  }

  async getAll(names: string[]): Promise<Record<string, string>> {
    if (names.length === 0) return {};

    const secrets = this.loadSecrets();
    const result: Record<string, string> = {};

    for (const name of names) {
      if (secrets[name] !== undefined) {
        result[name] = secrets[name];
      }
    }

    return result;
  }

  private loadSecrets(): Record<string, string> {
    if (!existsSync(this.secretsPath)) {
      return {};
    }

    const stat = statSync(this.secretsPath);
    if (this.cache && stat.mtimeMs === this.lastModified) {
      return this.cache;
    }

    try {
      const content = readFileSync(this.secretsPath, 'utf-8');
      const secrets: Record<string, string> = JSON.parse(content);
      this.cache = secrets;
      this.lastModified = stat.mtimeMs;
      return secrets;
    } catch {
      return {};
    }
  }
}
