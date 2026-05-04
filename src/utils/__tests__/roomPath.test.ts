import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRoomDirectory, sanitizeRoomId } from '../roomPath.js';

const testBaseDir = '/tmp/test-room-path';

describe('getRoomDirectory', () => {
  beforeEach(() => {
    // Clean up before each test
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true });
    }
  });

  it('should use explicit platform for native rooms', () => {
    const roomDir = getRoomDirectory(
      testBaseDir,
      'native-room-1',
      'native',
      'Native Session',
    );
    const metadataPath = path.join(roomDir, 'metadata.json');

    expect(fs.existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.platform).toBe('native');
  });

  it('should use explicit platform for email rooms', () => {
    const roomDir = getRoomDirectory(
      testBaseDir,
      'email-thread-abc123',
      'email',
      'Email Thread',
    );
    const metadataPath = path.join(roomDir, 'metadata.json');

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.platform).toBe('email');
  });

  it('should use explicit platform for Slack rooms', () => {
    const roomDir = getRoomDirectory(testBaseDir, 'C12345', 'slack', 'general');
    const metadataPath = path.join(roomDir, 'metadata.json');

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.platform).toBe('slack');
  });

  it('should accept RoomInfo object with platform', () => {
    const roomInfo = {
      platform: 'native' as const,
      channelId: 'native-room-2',
      channelName: 'Test Native',
    };
    const roomDir = getRoomDirectory(
      testBaseDir,
      'native-room-2',
      'native',
      roomInfo,
    );
    const metadataPath = path.join(roomDir, 'metadata.json');

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.platform).toBe('native');
  });
});

describe('sanitizeRoomId', () => {
  it('should sanitize IDs with leading bang and colon delimiters', () => {
    expect(sanitizeRoomId('!abc123XYZ:legacy.org')).toBe(
      'abc123xyz_legacy.org',
    );
  });

  it('should sanitize Slack channel IDs', () => {
    expect(sanitizeRoomId('C0123456789')).toBe('c0123456789');
  });

  it('should handle native session IDs', () => {
    expect(sanitizeRoomId('native-session-123')).toBe('native-session-123');
  });

  it('throws when room ID sanitizes to empty', () => {
    expect(() =>
      getRoomDirectory(testBaseDir, '!!!', 'native', 'Invalid Room'),
    ).toThrow('Room ID must contain at least one filesystem-safe character');
  });
});

describe('rooms index CLAUDE.md', () => {
  const testBaseDir = '/tmp/test-rooms-index';

  beforeEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true });
    }
  });

  it('should create native-specific rooms index', () => {
    getRoomDirectory(testBaseDir, 'native-room', 'native', 'Native Session');
    const content = fs.readFileSync(
      path.join(testBaseDir, 'rooms', 'native', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toContain('Native Rooms Directory');
    expect(content).toContain('Native chat API sessions');
  });

  it('should create Slack-specific rooms index', () => {
    getRoomDirectory(testBaseDir, 'C12345', 'slack', 'general');
    const content = fs.readFileSync(
      path.join(testBaseDir, 'rooms', 'slack', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toContain('Slack Rooms Directory');
  });

  it('should create email-specific rooms index', () => {
    getRoomDirectory(testBaseDir, 'thread-abc123', 'email', 'Email Thread');
    const content = fs.readFileSync(
      path.join(testBaseDir, 'rooms', 'email', 'CLAUDE.md'),
      'utf-8',
    );
    expect(content).toContain('Email Rooms Directory');
    expect(content).toContain('Email conversation sessions');
  });
});

describe('room CLAUDE.md', () => {
  const testBaseDir = '/tmp/test-room-claudemd';

  beforeEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true });
    }
  });

  it('should create native-specific room CLAUDE.md', () => {
    const roomDir = getRoomDirectory(
      testBaseDir,
      'native-session-123',
      'native',
      'Native Session',
    );
    const content = fs.readFileSync(path.join(roomDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Native Chat Session');
    expect(content).toContain('native chat API session');
    expect(content).toContain('/new');
  });

  it('should create Slack DM room CLAUDE.md with user name', () => {
    const roomInfo = {
      platform: 'slack' as const,
      channelId: 'D12345',
      channelName: 'D12345',
      channelType: 'dm' as const,
      userDisplayName: 'John Doe',
    };
    const roomDir = getRoomDirectory(testBaseDir, 'D12345', 'slack', roomInfo);
    const content = fs.readFileSync(path.join(roomDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('John Doe');
    expect(content).toContain('Slack DM');
  });
});
