// packages/bot-toolkit/src/native/responder.ts

import type { WebSocket } from 'ws';
import type { PlatformResponder, SessionStats } from '../core/types.js';
import { Logger } from '../utils/logger.js';

const _logger = new Logger('NativeResponder');

export class NativeResponder implements PlatformResponder {
  public cancelled = false;
  private accumulatedResponse = '';

  constructor(
    private sessionId: string,
    private ws: WebSocket | undefined,
  ) {}

  private send(message: object): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async markProcessing(): Promise<void> {
    this.send({ type: 'thinking', active: true });
  }

  async clearProcessing(): Promise<void> {
    this.send({ type: 'thinking', active: false });
  }

  async markError(): Promise<void> {
    this.send({ type: 'error', message: 'An error occurred' });
  }

  async updateResponse(text: string): Promise<void> {
    // Both onText and onTextDelta pass the full accumulated text.
    // Compute the actual delta to send over WebSocket.
    const delta = text.slice(this.accumulatedResponse.length);
    this.accumulatedResponse = text;
    if (delta) {
      this.send({ type: 'text_delta', content: delta });
    }
  }

  async finalizeResponse(): Promise<void> {
    // No-op for native - text is streamed incrementally
  }

  async sendNotice(text: string): Promise<void> {
    this.send({ type: 'notice', content: text });
  }

  async sendFile(localPath: string, filename?: string): Promise<void> {
    this.send({
      type: 'file',
      path: localPath,
      filename: filename ?? localPath.split('/').pop(),
    });
  }

  async setTyping(typing: boolean): Promise<void> {
    this.send({ type: 'thinking', active: typing });
  }

  async updateChannelStats(stats: SessionStats): Promise<void> {
    this.send({
      type: 'complete',
      stats: {
        context_tokens: stats.contextTokens,
        output_tokens: stats.outputTokens,
        cost_usd: stats.costUsd,
        duration_ms: stats.durationMs,
      },
    });
  }

  async createThreadStarter(_topic: string): Promise<string> {
    // Native doesn't have threads - return session ID
    return this.sessionId;
  }

  async appendCancellationNotice(text: string): Promise<void> {
    this.send({ type: 'notice', content: `[Cancelled] ${text}` });
  }

  getAccumulatedResponse(): string {
    return this.accumulatedResponse;
  }

  clearAccumulatedResponse(): void {
    this.accumulatedResponse = '';
  }
}
