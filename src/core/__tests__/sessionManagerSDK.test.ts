import { describe, expect, it } from 'vitest';
import { buildSdkEnv } from '../sessionManagerSDK.js';

describe('buildSdkEnv autoMemory', () => {
  const emptyPlatformEnv: Record<string, string> = {};

  it("sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 when autoMemory='disabled'", () => {
    const env = buildSdkEnv({}, emptyPlatformEnv, { autoMemory: 'disabled' });
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it("omits CLAUDE_CODE_DISABLE_AUTO_MEMORY when autoMemory='enabled'", () => {
    const env = buildSdkEnv({}, emptyPlatformEnv, { autoMemory: 'enabled' });
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
  });

  it('omits CLAUDE_CODE_DISABLE_AUTO_MEMORY when options absent (back-compat)', () => {
    const env = buildSdkEnv({}, emptyPlatformEnv);
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
  });
});
