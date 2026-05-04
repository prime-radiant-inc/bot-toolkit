// src/core/baseAdapter.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '../utils/logger.js';
import { sanitizeForPrompt } from '../utils/sanitize.js';
import { isDelegate } from './delegateStore.js';
import type { ConversationOrchestrator } from './orchestrator.js';
import type {
  Attachment,
  IncomingMessage,
  Platform,
  PlatformAdapter,
  SenderRole,
  WakeupPayload,
} from './types.js';

const logger = new Logger('BaseAdapter');

export interface BaseAdapterConfig {
  orchestrator: ConversationOrchestrator;
  authorizedUsers: string[];
  dataDir: string;
}

/**
 * Abstract base class for platform adapters.
 * Provides common functionality for authorization, message building, and attachment handling.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  protected orchestrator: ConversationOrchestrator;
  protected authorizedUsers: string[];
  protected dataDir: string;

  /** The platform this adapter handles */
  abstract readonly platform: Platform;

  constructor(config: BaseAdapterConfig) {
    this.orchestrator = config.orchestrator;
    this.authorizedUsers = config.authorizedUsers;
    this.dataDir = config.dataDir;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract stopListening(): Promise<void>;
  abstract sendRecoveryNotice(
    channelId: string,
    threadId: string | null,
    text: string,
  ): Promise<void>;
  abstract handleWakeup(
    channelId: string,
    payload: WakeupPayload,
  ): Promise<void>;

  /**
   * Check if a sender is authorized to use this bot.
   * If authorizedUsers is empty, all users are allowed.
   * Users in the authorizedUsers list or registered as delegates are authorized.
   */
  protected isAuthorized(senderId: string): boolean {
    if (this.authorizedUsers.length === 0) {
      return true;
    }
    return (
      this.authorizedUsers.includes(senderId) ||
      isDelegate(senderId, this.platform)
    );
  }

  /**
   * Check if a sender is a delegate on this adapter's platform.
   * Subclasses use this to determine the sender's role.
   */
  protected checkIsDelegate(senderId: string): boolean {
    return isDelegate(senderId, this.platform);
  }

  /**
   * Send an unauthorized response to the user.
   * Override in subclasses to customize the response mechanism.
   */
  protected abstract sendUnauthorizedResponse(
    channelId: string,
    messageId: string,
    threadId: string | null,
  ): Promise<void>;

  /**
   * Check authorization and send response if unauthorized.
   * Returns true if authorized, false if not.
   */
  protected async checkAuthorizationAndRespond(
    senderId: string,
    channelId: string,
    messageId: string,
    threadId: string | null,
  ): Promise<boolean> {
    if (this.isAuthorized(senderId)) {
      return true;
    }

    logger.warn('Unauthorized user', { senderId, channelId });
    await this.sendUnauthorizedResponse(channelId, messageId, threadId);
    return false;
  }

  /**
   * Build an IncomingMessage from common parameters.
   * Attachments are added separately since download logic varies by platform.
   */
  protected buildIncomingMessage(params: {
    channelId: string;
    channelName: string;
    threadId: string | null;
    messageId: string;
    senderId: string;
    senderName?: string;
    senderRole?: SenderRole;
    text: string;
    attachments?: Attachment[];
  }): IncomingMessage {
    return {
      platform: this.platform,
      channelId: params.channelId,
      channelName: params.channelName,
      threadId: params.threadId,
      messageId: params.messageId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderRole: params.senderRole,
      text: params.text,
      attachments: (params.attachments ?? []).map((a) => ({
        ...a,
        originalName: sanitizeForPrompt(a.originalName),
      })),
    };
  }

  /**
   * Sanitize a filename for safe filesystem storage.
   * Prepends timestamp and removes unsafe characters.
   */
  protected sanitizeFilename(originalName: string): string {
    const timestamp = Date.now();
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${timestamp}-${safeName}`;
  }

  /**
   * Download an attachment using a platform-specific download function.
   */
  protected async downloadAttachment(
    url: string,
    originalName: string,
    roomDir: string,
    size: number,
    mimeType: string,
    downloadFn: (url: string, savePath: string) => Promise<void>,
  ): Promise<Attachment | null> {
    try {
      const downloadDir = path.join(roomDir, 'downloads');

      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      const safeFilename = this.sanitizeFilename(originalName);
      const localPath = path.join(downloadDir, safeFilename);

      await downloadFn(url, localPath);

      return {
        localPath,
        originalName,
        mimeType,
        size,
      };
    } catch (error) {
      logger.error('Failed to download attachment', {
        url,
        originalName,
        error,
      });
      return null;
    }
  }
}
