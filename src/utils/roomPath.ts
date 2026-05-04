// src/utils/roomPath.ts
// Utilities for per-room directory management

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Platform } from '../core/types.js';
import { Logger } from './logger.js';

const logger = new Logger('RoomPath');

/**
 * Room metadata stored in metadata.json for dashboard consumption.
 */
export interface RoomMetadata {
  platform: Platform;
  channelId: string;
  channelName: string;
  channelType?: 'dm' | 'channel';
  userDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Extended room information for creating better CLAUDE.md files.
 */
export interface RoomInfo {
  platform: Platform;
  channelId: string;
  channelName: string;
  /** For Slack DMs, the display name of the user we're chatting with */
  userDisplayName?: string;
  /** Channel type: 'dm' for direct messages, 'channel' for public/private channels */
  channelType?: 'dm' | 'channel';
}

/**
 * Sanitize a room/channel ID for use as a filesystem directory name.
 * Slack channel IDs look like: C0123456789 or D0123456789
 *
 * We convert to a safe format: c0123456789
 * - Remove leading special characters
 * - Replace : with _
 * - Lowercase everything
 * - Keep only alphanumeric, underscore, hyphen, and dot
 */
export function sanitizeRoomId(roomId: string): string {
  return roomId
    .replace(/^!/, '')
    .replace(/:/g, '_')
    .toLowerCase() // Lowercase
    .replace(/[^a-z0-9_.-]/g, '') // Keep only safe chars
    .replace(/^[.-]+/, '') // Don't start with . or -
    .substring(0, 100); // Limit length
}

function sanitizeRoomIdOrThrow(roomId: string): string {
  const sanitized = sanitizeRoomId(roomId);
  if (sanitized.length === 0) {
    throw new Error(
      'Room ID must contain at least one filesystem-safe character',
    );
  }
  return sanitized;
}

/**
 * Get the directory path for a room's Claude sessions.
 * Creates the directory and CLAUDE.md if they don't exist.
 *
 * @param baseDir - Base data directory (e.g., /data/slack)
 * @param roomId - Channel/room ID
 * @param platform - The platform this room belongs to (slack, native, email)
 * @param roomNameOrInfo - Either a simple room name string, or a RoomInfo object with full details
 */
export function getRoomDirectory(
  baseDir: string,
  roomId: string,
  platform: Platform,
  roomNameOrInfo?: string | RoomInfo,
): string {
  const sanitized = sanitizeRoomIdOrThrow(roomId);
  // Structure: {baseDir}/rooms/{platform}/{room-id}/
  const roomsDir = path.join(baseDir, 'rooms', platform);
  const roomDir = path.join(roomsDir, sanitized);

  // Ensure rooms/ directory exists with its CLAUDE.md
  if (!fs.existsSync(roomsDir)) {
    fs.mkdirSync(roomsDir, { recursive: true });
    createRoomsIndexClaudeMd(roomsDir, platform);
  } else if (!fs.existsSync(path.join(roomsDir, 'CLAUDE.md'))) {
    // Create index CLAUDE.md if rooms/ exists but CLAUDE.md doesn't
    createRoomsIndexClaudeMd(roomsDir, platform);
  }

  // Build RoomInfo for metadata
  const roomInfo: RoomInfo =
    typeof roomNameOrInfo === 'object'
      ? roomNameOrInfo
      : {
          platform: platform,
          channelId: roomId,
          channelName: roomNameOrInfo || roomId,
        };

  if (!fs.existsSync(roomDir)) {
    fs.mkdirSync(roomDir, { recursive: true });
    logger.info('Created room directory', { roomId, roomDir });

    // Create CLAUDE.md template for new rooms
    createRoomClaudeMd(roomDir, roomInfo);
  }

  // Always write/update metadata.json (keeps display names current)
  writeRoomMetadata(roomDir, roomInfo);

  return roomDir;
}

/**
 * Create a CLAUDE.md index file for the rooms/ directory.
 * Explains the directory structure and how to search chat history.
 */
function createRoomsIndexClaudeMd(roomsDir: string, platform: Platform): void {
  const claudeMdPath = path.join(roomsDir, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath)) {
    return;
  }

  let platformLabel: string;
  let idExample: string;
  let platformDescription: string;

  switch (platform) {
    case 'slack':
      platformLabel = 'Slack';
      idExample =
        'Slack channel IDs like `C0123456789` are lowercased to `c0123456789`';
      platformDescription = 'Slack chat sessions';
      break;
    case 'native':
      platformLabel = 'Native';
      idExample = 'Native session IDs like `native-session-123` are used as-is';
      platformDescription = 'Native chat API sessions';
      break;
    case 'email':
      platformLabel = 'Email';
      idExample =
        'Email thread IDs are SHA-256 hashes of the Message-ID header, truncated to 16 chars';
      platformDescription = 'Email conversation sessions';
      break;
  }

  const template = `# ${platformLabel} Rooms Directory

This directory contains per-room workspaces for ${platformDescription}.

**This is your sandbox.** You can freely create files and directories within your room.

## Write Boundaries

- **OK**: Write anywhere in your current room directory
- **OK**: Read from other rooms' chat-history, repos, MCP data
- **NOT OK**: Write to other rooms, infrastructure/, mcp-data/, repos/ (without telling the user)

See the main CLAUDE.md in claude-pa for full details on the data directory structure.

## Directory Structure

\`\`\`
rooms/
├── CLAUDE.md              # This file
├── <room-id-1>/
│   ├── CLAUDE.md          # Room-specific context and instructions
│   └── chat-history/
│       └── YYYY-MM-DD/    # Daily directories
│           └── HH-mm-<thread-id>.md  # Per-thread logs
└── ...
\`\`\`

## Room ID Format

${idExample} for filesystem safety.

## Chat History

Each room's \`chat-history/\` directory contains per-thread markdown files organized by date.

### Searching Chat History

\`\`\`bash
# Search all rooms for a topic
grep -r "search term" rooms/*/chat-history/

# Search a specific room
grep -r "search term" rooms/<room-id>/chat-history/

# Find conversations from a specific date
ls rooms/*/chat-history/2024-01-15/
\`\`\`

### Chat History Format

\`\`\`markdown
### 14:32 **User**

Message content here...

---

### 14:33 **Assistant**

Response content here...

---
\`\`\`

## Room Context

Each room's \`CLAUDE.md\` file can be edited to add:
- Room purpose and description
- Specific instructions or preferences for that conversation
- Links to relevant resources
`;

  fs.writeFileSync(claudeMdPath, template);
  logger.info('Created rooms index CLAUDE.md', { roomsDir, platform });
}

/**
 * Write or update room metadata to metadata.json.
 * This file is read by the dashboard for room display names and platform info.
 */
function writeRoomMetadata(roomDir: string, info: RoomInfo): void {
  const metadataPath = path.join(roomDir, 'metadata.json');
  const now = new Date().toISOString();

  let metadata: RoomMetadata;

  if (fs.existsSync(metadataPath)) {
    // Update existing metadata, preserving createdAt
    try {
      const existing = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8'),
      ) as RoomMetadata;
      metadata = {
        platform: info.platform,
        channelId: info.channelId,
        channelName: info.channelName,
        channelType: info.channelType,
        userDisplayName: info.userDisplayName,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
    } catch {
      // If read fails, create new
      metadata = {
        platform: info.platform,
        channelId: info.channelId,
        channelName: info.channelName,
        channelType: info.channelType,
        userDisplayName: info.userDisplayName,
        createdAt: now,
        updatedAt: now,
      };
    }
  } else {
    metadata = {
      platform: info.platform,
      channelId: info.channelId,
      channelName: info.channelName,
      channelType: info.channelType,
      userDisplayName: info.userDisplayName,
      createdAt: now,
      updatedAt: now,
    };
  }

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  logger.info('Wrote room metadata', {
    roomDir,
    platform: info.platform,
    channelName: info.channelName,
  });
}

/**
 * Create a CLAUDE.md file for a new room with a default template.
 */
function createRoomClaudeMd(roomDir: string, info: RoomInfo): void {
  const claudeMdPath = path.join(roomDir, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath)) {
    return; // Don't overwrite existing
  }

  const createdAt = new Date().toISOString().split('T')[0];

  // Determine platform label using switch statement
  let platformLabel: string;
  switch (info.platform) {
    case 'slack':
      platformLabel = 'Slack';
      break;
    case 'native':
      platformLabel = 'Native';
      break;
    case 'email':
      platformLabel = 'Email';
      break;
  }

  // Build a descriptive title
  let title: string;
  if (info.platform === 'native') {
    title = 'Native Chat Session';
  } else if (info.channelType === 'dm' && info.userDisplayName) {
    title = `${platformLabel} DM with ${info.userDisplayName}`;
  } else if (info.channelName && info.channelName !== info.channelId) {
    title = `${platformLabel}: #${info.channelName}`;
  } else {
    title = `${platformLabel} Channel`;
  }

  // Build metadata section
  const metadataLines = [
    `Platform: ${platformLabel}`,
    `Channel ID: \`${info.channelId}\``,
  ];

  if (info.channelName && info.channelName !== info.channelId) {
    metadataLines.push(`Channel Name: ${info.channelName}`);
  }

  if (info.channelType) {
    metadataLines.push(
      `Type: ${info.channelType === 'dm' ? 'Direct Message' : 'Channel'}`,
    );
  }

  if (info.userDisplayName) {
    metadataLines.push(`User: ${info.userDisplayName}`);
  }

  metadataLines.push(`Created: ${createdAt}`);

  // Native gets extra purpose content; others get placeholder
  let purposeSection: string;
  if (info.platform === 'native') {
    purposeSection = `This is a native chat API session.

Use this interface to:
- Test bot behavior without affecting production chat platforms
- Debug specific features or prompts
- Tune Claude's responses
- Develop and test new functionality

Commands:
- \`/new <topic>\` - Start a new conversation thread`;
  } else {
    purposeSection = "<!-- Describe this room's purpose -->";
  }

  const template = `# ${title}

${metadataLines.join('\n')}

## Purpose

${purposeSection}

## Context

<!-- Add any room-specific context or instructions for Claude -->

## Chat History

Historical chat messages are stored in the \`chat-history/\` directory, organized by date and thread.
`;

  fs.writeFileSync(claudeMdPath, template);
  logger.info('Created CLAUDE.md for room', { roomDir, info });
}
