import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs module
vi.mock('node:fs');

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  process.env = { ...originalEnv, HOME: '/test' };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('getDelegates', () => {
  it('returns delegates from valid frontmatter', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: America/Los_Angeles
delegates:
  - id: U12345ABC
    name: Eden
    platform: slack
  - id: U99999ZZZ
    name: Alex
    platform: matrix
---
# About My Boss
`);

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([
      { id: 'U12345ABC', name: 'Eden', platform: 'slack' },
      { id: 'U99999ZZZ', name: 'Alex', platform: 'matrix' },
    ]);
  });

  it('returns empty array when file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([]);
  });

  it('returns empty array when delegates field is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: America/Los_Angeles
---
# About My Boss
`);

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([]);
  });

  it('returns empty array for malformed YAML', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
: this is not valid: yaml: [
---
content
`);

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([]);
  });

  it('returns empty array when delegates is an empty array', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: America/Los_Angeles
delegates: []
---
# About My Boss
`);

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([]);
  });

  it('filters out malformed delegate entries', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
delegates:
  - id: U12345ABC
    name: Eden
    platform: slack
  - wrong_key: value
  - 42
  - id: U99999ZZZ
    name: Alex
    platform: matrix
---
`);

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([
      { id: 'U12345ABC', name: 'Eden', platform: 'slack' },
      { id: 'U99999ZZZ', name: 'Alex', platform: 'matrix' },
    ]);
  });

  it('returns empty array when HOME is not set', async () => {
    delete process.env.HOME;

    const { getDelegates } = await import('../delegateStore.js');
    const result = getDelegates();
    expect(result).toEqual([]);
  });
});

describe('isDelegate', () => {
  it('returns true for a matching delegate', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
delegates:
  - id: U12345ABC
    name: Eden
    platform: slack
---
`);

    const { isDelegate } = await import('../delegateStore.js');
    expect(isDelegate('U12345ABC', 'slack')).toBe(true);
  });

  it('returns false when userId matches but platform does not', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
delegates:
  - id: U12345ABC
    name: Eden
    platform: slack
---
`);

    const { isDelegate } = await import('../delegateStore.js');
    expect(isDelegate('U12345ABC', 'matrix')).toBe(false);
  });

  it('returns false when no delegates exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { isDelegate } = await import('../delegateStore.js');
    expect(isDelegate('U12345ABC', 'slack')).toBe(false);
  });
});
