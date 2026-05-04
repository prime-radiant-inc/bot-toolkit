// src/core/baseResponder.ts

import { endsAtSentenceBoundary } from '../utils/text.js';
import type { PlatformResponder, SessionStats } from './types.js';

/** Tool call record for display purposes only (never stored in conversation context). */
export interface ToolCall {
  name: string;
  input: unknown;
}

/**
 * Abstract base class for platform responders.
 * Handles common throttling logic, stats formatting, and tool call tracking.
 * Platform-specific implementations extend this and implement the abstract methods.
 */
export abstract class BaseResponder implements PlatformResponder {
  protected currentResponseId: string | null = null;

  /** The platform message ID of the current response (e.g. Slack ts). */
  get responseId(): string | null {
    return this.currentResponseId;
  }

  /** The latest response text (for post-processing like announcement previews). */
  get responseText(): string | null {
    return this.lastText;
  }

  protected lastUpdateTime = 0;
  protected lastText: string | null = null;
  protected readonly MIN_UPDATE_MS = 800;
  protected readonly MAX_UPDATE_MS = 4000;

  /** Whether this response has been cancelled. Checked first in updateResponse/finalizeResponse. */
  public cancelled = false;

  /** Callback invoked once when the first platform message is created. */
  protected onFirstOutputCallback?: () => void;

  protected toolCalls: ToolCall[] = [];
  protected static readonly MAX_TOOL_DISPLAY = 30;

  /**
   * Check if we should throttle this update.
   * Uses sentence-boundary-aware logic:
   * - Never update faster than MIN_UPDATE_MS
   * - Always update after MAX_UPDATE_MS (prevents staleness)
   * - Between min and max, only update at sentence boundaries
   */
  protected shouldThrottle(text: string): boolean {
    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;

    if (!this.currentResponseId) {
      this.lastUpdateTime = now;
      return false;
    }

    if (elapsed < this.MIN_UPDATE_MS) return true;

    if (elapsed >= this.MAX_UPDATE_MS) {
      this.lastUpdateTime = now;
      return false;
    }

    if (endsAtSentenceBoundary(text)) {
      this.lastUpdateTime = now;
      return false;
    }

    return true;
  }

  /**
   * Format session stats into a channel topic string.
   * Note: Assumes 200k context window (Claude 3.5 Sonnet/Opus default).
   * TODO: Make context window configurable via SessionStats or constructor.
   */
  public formatStatsTopic(stats: SessionStats): string {
    const contextK = Math.round(stats.contextTokens / 1000);
    // Assumes 200k context window - may need adjustment for other models
    const contextPercent = Math.round((stats.contextTokens / 200000) * 100);
    return `📊 ${contextK}k/200k (${contextPercent}%) | $${stats.costUsd.toFixed(2)} | SDK`;
  }

  /**
   * Record a tool call for display in the final message.
   * Called by orchestrator's onToolUse callback via duck typing.
   */
  recordToolUse(name: string, input: unknown): void {
    this.toolCalls.push({ name, input });
  }

  /**
   * Extract a short summary from tool input for display.
   */
  protected summarizeInput(input: unknown): string {
    if (!input || typeof input !== 'object') return '';
    try {
      const obj = input as Record<string, unknown>;
      const value =
        obj.file_path ??
        obj.path ??
        obj.pattern ??
        obj.command ??
        obj.query ??
        '';
      const str =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      return str.length > 60 ? `${str.slice(0, 57)}...` : str;
    } catch {
      return '';
    }
  }

  /**
   * Update the current response with new text.
   * Throttles rapid updates to avoid API rate limits.
   */
  async updateResponse(text: string): Promise<void> {
    if (this.cancelled) return;

    // Always track the latest text for finalizeResponse
    this.lastText = text;

    if (this.shouldThrottle(text)) {
      return;
    }

    if (this.currentResponseId) {
      await this.editMessage(text);
    } else {
      this.currentResponseId = await this.sendNewMessage(text);
      // Fire onFirstOutput callback when first platform message is created
      if (this.onFirstOutputCallback) {
        this.onFirstOutputCallback();
        this.onFirstOutputCallback = undefined;
      }
    }
  }

  /**
   * Force a final update, bypassing throttle.
   * Call this when the response is complete.
   */
  async finalizeResponse(): Promise<void> {
    if (this.cancelled) return;

    if (this.lastText && this.currentResponseId) {
      await this.editMessage(this.lastText);
    }
  }

  /** Set the onFirstOutput callback. */
  setOnFirstOutput(callback: () => void): void {
    this.onFirstOutputCallback = callback;
  }

  /** Append a cancellation notice to the current response or send a new message. */
  async appendCancellationNotice(text: string): Promise<void> {
    if (this.currentResponseId && this.lastText) {
      await this.editMessage(`${this.lastText}\n\n---\n${text}`);
    } else {
      this.currentResponseId = await this.sendNewMessage(text);
    }
  }

  // Abstract methods - platform-specific implementations required

  /** Add processing indicator (e.g., emoji reaction) */
  abstract markProcessing(): Promise<void>;

  /** Remove processing indicator */
  abstract clearProcessing(): Promise<void>;

  /** Add error indicator */
  abstract markError(): Promise<void>;

  /** Send an informational notice message */
  abstract sendNotice(text: string): Promise<void>;

  /** Send a file to the channel */
  abstract sendFile(localPath: string, filename?: string): Promise<void>;

  /** Set typing indicator */
  abstract setTyping(typing: boolean): Promise<void>;

  /** Update channel topic/description with stats */
  abstract updateChannelStats(stats: SessionStats): Promise<void>;

  /** Create a new thread and return its ID */
  abstract createThreadStarter(topic: string): Promise<string>;

  /** Platform sends a new message, returns message ID */
  protected abstract sendNewMessage(text: string): Promise<string>;

  /** Platform edits an existing message */
  protected abstract editMessage(text: string): Promise<void>;
}
