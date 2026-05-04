import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DOTENV_KEY = 'BOT_TOOLKIT_DOTENV_IMPORT_SIDE_EFFECT';

describe('config loading', () => {
  let originalCwd: string;
  let originalDotenvValue: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalDotenvValue = process.env[DOTENV_KEY];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-toolkit-config-'));
    process.chdir(tempDir);
    delete process.env[DOTENV_KEY];
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalDotenvValue === undefined) {
      delete process.env[DOTENV_KEY];
    } else {
      process.env[DOTENV_KEY] = originalDotenvValue;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('does not load .env when importing the package root', async () => {
    fs.writeFileSync(path.join(tempDir, '.env'), `${DOTENV_KEY}=from-dotenv\n`);

    await import('../../index.js');

    expect(process.env[DOTENV_KEY]).toBeUndefined();
  });

  it('loads .env when loadConfig is called', async () => {
    fs.writeFileSync(path.join(tempDir, '.env'), `${DOTENV_KEY}=from-dotenv\n`);

    const { loadConfig } = await import('../config.js');
    loadConfig();

    expect(process.env[DOTENV_KEY]).toBe('from-dotenv');
  });
});
