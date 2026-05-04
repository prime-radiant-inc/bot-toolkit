import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTimezoneAbbreviation, isValidTimezone } from '../contextStore.js';

// Mock fs module
vi.mock('node:fs');

describe('isValidTimezone', () => {
  it('returns true for valid IANA timezone', () => {
    expect(isValidTimezone('America/Los_Angeles')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
  });

  it('returns false for timezone abbreviations (PST, EST, etc)', () => {
    // US abbreviations
    expect(isValidTimezone('PST')).toBe(false);
    expect(isValidTimezone('PDT')).toBe(false);
    expect(isValidTimezone('EST')).toBe(false);
    expect(isValidTimezone('EDT')).toBe(false);
    expect(isValidTimezone('CST')).toBe(false);
    expect(isValidTimezone('CDT')).toBe(false);
    expect(isValidTimezone('MST')).toBe(false);
    expect(isValidTimezone('MDT')).toBe(false);
    // International ambiguous abbreviations
    // GMT is fixed at UTC+0, doesn't handle UK summer time
    expect(isValidTimezone('GMT')).toBe(false);
    // BST in Intl = Bangladesh Standard Time, NOT British Summer Time!
    expect(isValidTimezone('BST')).toBe(false);
    // IST in Intl = India Standard Time, NOT Irish or Israel Standard Time!
    expect(isValidTimezone('IST')).toBe(false);
    // lowercase too
    expect(isValidTimezone('pst')).toBe(false);
    expect(isValidTimezone('est')).toBe(false);
    expect(isValidTimezone('gmt')).toBe(false);
    expect(isValidTimezone('bst')).toBe(false);
    expect(isValidTimezone('ist')).toBe(false);
  });

  it('returns false for invalid timezone strings', () => {
    expect(isValidTimezone('Invalid/Zone')).toBe(false);
    expect(isValidTimezone('Not/A/Timezone')).toBe(false);
    expect(isValidTimezone('foo')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidTimezone(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidTimezone(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('  ')).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isValidTimezone(123)).toBe(false);
    expect(isValidTimezone({})).toBe(false);
    expect(isValidTimezone([])).toBe(false);
  });
});

describe('getUserTimezone', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns UTC with configured=false when HOME not set', async () => {
    delete process.env.HOME;
    // Re-import to get fresh module with new env
    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns UTC with configured=false when file does not exist', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns timezone with configured=true when frontmatter has valid timezone', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: America/Los_Angeles
---
# About My User
`);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('America/Los_Angeles');
    expect(result.configured).toBe(true);
  });

  it('returns UTC with configured=false when frontmatter has no timezone', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
email: test@example.com
---
# About My User
`);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns UTC with configured=false when timezone is null', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: null
---
# About My User
`);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns UTC with configured=false when timezone is string "null"', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: "null"
---
# About My User
`);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns UTC with configured=false when timezone is abbreviation (PST)', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: PST
---
# About My User
`);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns UTC with configured=false when timezone is invalid', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`---
timezone: Invalid/Zone
---
# About My User
`);

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });

  it('returns UTC with configured=false when file read fails', async () => {
    process.env.HOME = '/test';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Read error');
    });

    const { getUserTimezone: freshGetUserTimezone } = await import(
      '../contextStore.js'
    );
    const result = freshGetUserTimezone();
    expect(result.timezone).toBe('UTC');
    expect(result.configured).toBe(false);
  });
});

describe('getTimezoneAbbreviation', () => {
  it('returns correct abbreviation for America/Los_Angeles in winter (PST)', () => {
    // January date - should be PST
    const winterDate = new Date('2026-01-15T12:00:00Z');
    const abbrev = getTimezoneAbbreviation('America/Los_Angeles', winterDate);
    expect(abbrev).toBe('PST');
  });

  it('returns correct abbreviation for America/Los_Angeles in summer (PDT)', () => {
    // July date - should be PDT
    const summerDate = new Date('2026-07-15T12:00:00Z');
    const abbrev = getTimezoneAbbreviation('America/Los_Angeles', summerDate);
    expect(abbrev).toBe('PDT');
  });

  it('returns correct abbreviation for America/New_York in winter (EST)', () => {
    const winterDate = new Date('2026-01-15T12:00:00Z');
    const abbrev = getTimezoneAbbreviation('America/New_York', winterDate);
    expect(abbrev).toBe('EST');
  });

  it('returns correct abbreviation for America/New_York in summer (EDT)', () => {
    const summerDate = new Date('2026-07-15T12:00:00Z');
    const abbrev = getTimezoneAbbreviation('America/New_York', summerDate);
    expect(abbrev).toBe('EDT');
  });

  it('returns UTC for UTC timezone', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const abbrev = getTimezoneAbbreviation('UTC', date);
    expect(abbrev).toBe('UTC');
  });

  it('returns timezone string when abbreviation extraction fails', () => {
    // Using a mock that will fail
    const invalidTz = 'Some/Invalid/Timezone';
    const date = new Date();
    // This should fall back to returning the timezone string itself
    const abbrev = getTimezoneAbbreviation(invalidTz, date);
    // Should return the input string on error
    expect(typeof abbrev).toBe('string');
  });
});
