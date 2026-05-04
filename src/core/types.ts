// src/core/types.ts

export type Platform = 'matrix' | 'slack' | 'native' | 'email';

export type SenderRole = 'primary' | 'delegate';

export interface IncomingMessage {
  platform: Platform;
  channelId: string;
  channelName: string;
  threadId: string | null;
  messageId: string;
  senderId: string;
  senderName?: string;
  senderRole?: SenderRole;
  text: string;
  attachments: Attachment[];
}

export interface Attachment {
  localPath: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface SessionStats {
  contextTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  compactionCount: number;
}

export interface PlatformResponder {
  markProcessing(): Promise<void>;
  clearProcessing(): Promise<void>;
  markError(): Promise<void>;

  updateResponse(text: string): Promise<void>;
  finalizeResponse(): Promise<void>;

  sendNotice(text: string): Promise<void>;
  sendFile(localPath: string, filename?: string): Promise<void>;

  setTyping(typing: boolean): Promise<void>;
  updateChannelStats(stats: SessionStats): Promise<void>;

  createThreadStarter(topic: string): Promise<string>;

  /** Whether this response has been cancelled. */
  cancelled: boolean;

  /** Append a cancellation notice to the current response or send a new message. */
  appendCancellationNotice(text: string): Promise<void>;
}

export interface PlatformAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleWakeup(channelId: string, payload: WakeupPayload): Promise<void>;

  /** Stop accepting new messages but keep platform client connected. */
  stopListening(): Promise<void>;

  /** Send a recovery notice to a channel/thread (for crash recovery notifications). */
  sendRecoveryNotice(
    channelId: string,
    threadId: string | null,
    text: string,
  ): Promise<void>;
}

export interface WakeupPayload {
  idempotency_key: string;
  job_id: string;
  prompt: string;
  room_id: string;
  thread_id?: string;
  session_id?: string; // SDK session ID for resumption
  scheduled_at: string;
  triggered_at: string;
}

// Session management types (from claude/types.ts)

export interface SessionCallbacks {
  onSessionStart: (sessionId: string) => Promise<void>;
  onCompaction: (info: CompactionInfo) => Promise<void>;
  onText: (text: string) => Promise<void>;
  onTextDelta: (text: string) => Promise<void>;
  onToolUse: (name: string, input: unknown) => Promise<void>;
  onFileSend: (localPath: string) => Promise<void>;
  onFirstOutput?: () => void;
}

export type SystemPromptConfig =
  | string
  | { type: 'preset'; preset: 'claude_code'; append?: string };

export interface CompactionInfo {
  preTokens: number;
  trigger: 'auto' | 'manual';
}

export interface SessionResult {
  sessionId: string | undefined;
  text: string;
  stats: SessionStats;
}

export interface ISessionManager {
  getSessionFromEvent(
    eventId: string,
  ): { sessionId: string; compactionCount: number } | null;

  saveEventSession(
    eventId: string,
    roomId: string,
    sessionId: string,
    contextTokens: number,
    compactionCount: number,
  ): void;

  deleteEventSession(eventId: string): void;

  sendMessage(
    roomId: string,
    userMessage: string,
    platform: Platform,
    contextName: string,
    callbacks: SessionCallbacks,
    resumeSession?: { sessionId: string; compactionCount: number },
    options?: {
      systemPrompt?: SystemPromptConfig;
      forkSession?: boolean;
      outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
      abortController?: AbortController;
    },
  ): Promise<SessionResult>;
}

export interface ThreadSession {
  sessionId: string;
  roomId: string;
  threadId: string | null;
  contextTokens: number;
  compactionCount: number;
  createdAt: number;
  lastActiveAt: number;
}
