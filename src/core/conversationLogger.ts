// packages/bot-toolkit/src/core/conversationLogger.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '../utils/logger.js';
import { sanitizeRoomId } from '../utils/roomPath.js';
import type { Platform } from './types.js';

const logger = new Logger('ConversationLogger');

export interface StoredMessage {
  role: 'user' | 'assistant';
  senderId?: string;
  senderName: string;
  text: string;
  timestamp: string;
  messageId: string;
}

export interface IncomingLogEntry {
  platform: Platform;
  channelId: string;
  channelName: string;
  threadId: string | null;
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  rawEvent: unknown;
  attachments?: Array<{ name: string; mimeType: string; size: number }>;
}

export interface OutgoingLogEntry {
  platform: Platform;
  channelId: string;
  channelName: string;
  threadId: string | null;
  action: string;
  text: string;
  rawPayload: unknown;
  eventId?: string;
}

interface JsonlEntry {
  timestamp: string;
  direction: 'in' | 'out';
  messageId?: string;
  action?: string;
  message: {
    senderId?: string;
    senderName?: string;
    text: string;
    role: 'user' | 'assistant';
  };
  rawEvent?: unknown;
  rawPayload?: unknown;
}

/**
 * Unified conversation logger that writes both human-readable markdown
 * and machine-parseable JSONL files.
 *
 * Directory structure:
 *   {dataDir}/rooms/{platform}/{sanitizedChannelId}/chat-history/{date}/
 *     ├── main.md          # Main channel messages (human-readable)
 *     ├── main.jsonl       # Main channel messages (structured + raw events)
 *     ├── {threadId}.md    # Thread messages (human-readable)
 *     └── {threadId}.jsonl # Thread messages (structured + raw events)
 */
export class ConversationLogger {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Log an incoming message from a user.
   */
  async logIncoming(entry: IncomingLogEntry): Promise<void> {
    const fileBase = entry.threadId ?? 'main';

    try {
      const dir = this.ensureDir(entry.platform, entry.channelId);

      // Write markdown
      const mdContent = this.formatUserMarkdown(entry);
      fs.appendFileSync(path.join(dir, `${fileBase}.md`), mdContent);

      // Write JSONL
      const jsonlEntry: JsonlEntry = {
        timestamp: new Date().toISOString(),
        direction: 'in',
        messageId: entry.messageId,
        message: {
          senderId: entry.senderId,
          senderName: entry.senderName,
          text: entry.text,
          role: 'user',
        },
        rawEvent: entry.rawEvent,
      };
      fs.appendFileSync(
        path.join(dir, `${fileBase}.jsonl`),
        `${JSON.stringify(jsonlEntry)}\n`,
      );

      logger.debug('Logged incoming message', {
        platform: entry.platform,
        channelId: entry.channelId,
        threadId: entry.threadId,
        messageId: entry.messageId,
      });
    } catch (error) {
      logger.error('Failed to log incoming message', {
        platform: entry.platform,
        channelId: entry.channelId,
        messageId: entry.messageId,
        error,
      });
      // Don't rethrow - logging failures shouldn't block message handling
    }
  }

  /**
   * Log an outgoing message from the bot.
   */
  async logOutgoing(entry: OutgoingLogEntry): Promise<void> {
    const fileBase = entry.threadId ?? 'main';

    try {
      const dir = this.ensureDir(entry.platform, entry.channelId);

      // Write markdown
      const mdContent = this.formatAssistantMarkdown(entry);
      fs.appendFileSync(path.join(dir, `${fileBase}.md`), mdContent);

      // Write JSONL
      const jsonlEntry: JsonlEntry = {
        timestamp: new Date().toISOString(),
        direction: 'out',
        action: entry.action,
        message: {
          text: entry.text,
          role: 'assistant',
        },
        rawPayload: entry.rawPayload,
      };
      fs.appendFileSync(
        path.join(dir, `${fileBase}.jsonl`),
        `${JSON.stringify(jsonlEntry)}\n`,
      );

      logger.debug('Logged outgoing message', {
        platform: entry.platform,
        channelId: entry.channelId,
        threadId: entry.threadId,
        action: entry.action,
      });
    } catch (error) {
      logger.error('Failed to log outgoing message', {
        platform: entry.platform,
        channelId: entry.channelId,
        threadId: entry.threadId,
        action: entry.action,
        error,
      });
      // Don't rethrow - logging failures shouldn't block message handling
    }
  }

  /**
   * Get recent main channel context for a channel.
   * Used to build session context.
   */
  async getChannelContext(
    platform: Platform,
    channelId: string,
    limit: number = 100,
  ): Promise<StoredMessage[]> {
    const sanitized = sanitizeRoomId(channelId);
    const channelDir = path.join(
      this.dataDir,
      'rooms',
      platform,
      sanitized,
      'chat-history',
    );
    if (!fs.existsSync(channelDir)) {
      return [];
    }

    const allMessages: StoredMessage[] = [];
    const dateDirs = this.getDateDirs(channelDir);

    for (const dateDir of dateDirs) {
      const jsonlFile = path.join(dateDir, 'main.jsonl');
      if (fs.existsSync(jsonlFile)) {
        const messages = this.parseJsonlFile(jsonlFile);
        allMessages.push(...messages);
        if (allMessages.length >= limit) break;
      }
    }

    return allMessages.slice(-limit);
  }

  /**
   * Get thread context for session building.
   */
  async getThreadContext(
    platform: Platform,
    channelId: string,
    threadId: string,
    limit: number = 100,
  ): Promise<StoredMessage[]> {
    const sanitized = sanitizeRoomId(channelId);
    const channelDir = path.join(
      this.dataDir,
      'rooms',
      platform,
      sanitized,
      'chat-history',
    );
    if (!fs.existsSync(channelDir)) {
      return [];
    }

    const allMessages: StoredMessage[] = [];
    const dateDirs = this.getDateDirs(channelDir);

    for (const dateDir of dateDirs) {
      const jsonlFile = path.join(dateDir, `${threadId}.jsonl`);
      if (fs.existsSync(jsonlFile)) {
        const messages = this.parseJsonlFile(jsonlFile);
        allMessages.push(...messages);
      }
    }

    return allMessages.slice(-limit);
  }

  private ensureDir(platform: Platform, channelId: string): string {
    const dateStr = new Date().toISOString().split('T')[0] ?? 'unknown';
    const sanitized = sanitizeRoomId(channelId);
    const dir = path.join(
      this.dataDir,
      'rooms',
      platform,
      sanitized,
      'chat-history',
      dateStr,
    );
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private formatUserMarkdown(entry: IncomingLogEntry): string {
    const timestamp = new Date().toISOString();
    let content = `### ${timestamp} **${entry.senderName}**\n\n${entry.text}\n\n`;

    if (entry.attachments && entry.attachments.length > 0) {
      content += '**Attachments:**\n';
      for (const att of entry.attachments) {
        content += `- ${att.name} (${att.mimeType}, ${att.size} bytes)\n`;
      }
      content += '\n';
    }

    content += '---\n\n';
    return content;
  }

  private formatAssistantMarkdown(entry: OutgoingLogEntry): string {
    const timestamp = new Date().toISOString();
    return `### ${timestamp} **Assistant**\n\n${entry.text}\n\n---\n\n`;
  }

  private getDateDirs(channelDir: string): string[] {
    if (!fs.existsSync(channelDir)) return [];
    return fs
      .readdirSync(channelDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(channelDir, name));
  }

  private parseJsonlFile(filePath: string): StoredMessage[] {
    const messages: StoredMessage[] = [];
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry: JsonlEntry = JSON.parse(line);
        messages.push({
          role: entry.message.role,
          senderId: entry.message.senderId,
          senderName: entry.message.senderName ?? 'Assistant',
          text: entry.message.text,
          timestamp: entry.timestamp,
          messageId: entry.messageId ?? '',
        });
      } catch {
        logger.warn('Failed to parse JSONL line', { filePath });
      }
    }
    return messages;
  }
}
