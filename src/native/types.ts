// packages/bot-toolkit/src/native/types.ts

import type { WebSocket } from 'ws';

export interface NativeSession {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  sdkSessionId?: string;
}

export interface NativeSessionMetadata {
  id: string;
  created_at: string;
  last_activity: string;
  sdk_session_id?: string;
}

export interface AttachedSession {
  ws: WebSocket;
  sessionId: string;
}

// WebSocket message types
export interface WSInputMessage {
  type: 'input';
  text: string;
  roomSlug?: string;
  roomName?: string;
}

export interface WSSignalMessage {
  type: 'signal';
  signal: 'interrupt';
}

export type WSClientMessage = WSInputMessage | WSSignalMessage;

export interface WSHistoryMessage {
  type: 'history';
  messages: Array<{ role: string; content: string; timestamp: string }>;
}

export interface WSMissedWakeupMessage {
  type: 'missed_wakeup';
  prompt: string;
  response: string;
  ran_at: string;
}

export interface WSTextDeltaMessage {
  type: 'text_delta';
  content: string;
}

export interface WSThinkingMessage {
  type: 'thinking';
  active: boolean;
}

export interface WSToolUseMessage {
  type: 'tool_use';
  name: string;
}

export interface WSCompleteMessage {
  type: 'complete';
  stats: {
    context_tokens: number;
    output_tokens: number;
    cost_usd: number;
    duration_ms: number;
  };
}

export interface WSErrorMessage {
  type: 'error';
  message: string;
}

export interface WSNoticeMessage {
  type: 'notice';
  content: string;
}

export interface WSFileMessage {
  type: 'file';
  path: string;
  filename?: string;
}

export type WSServerMessage =
  | WSHistoryMessage
  | WSMissedWakeupMessage
  | WSTextDeltaMessage
  | WSThinkingMessage
  | WSToolUseMessage
  | WSCompleteMessage
  | WSNoticeMessage
  | WSFileMessage
  | WSErrorMessage;
