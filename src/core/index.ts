// src/core/index.ts

export type {
  ActiveThread,
  EngagementConfig,
  EngagementReason,
} from './attentionTracker.js';
export { AttentionTracker } from './attentionTracker.js';
export type { BaseAdapterConfig } from './baseAdapter.js';
export { BaseAdapter } from './baseAdapter.js';
export type { ToolCall } from './baseResponder.js';
export { BaseResponder } from './baseResponder.js';
export type { Command, SlashCommand } from './commandHandler.js';
export { CommandHandler } from './commandHandler.js';
export { ContextStore } from './contextStore.js';
export type {
  IncomingLogEntry,
  OutgoingLogEntry,
  StoredMessage,
} from './conversationLogger.js';
export { ConversationLogger } from './conversationLogger.js';
export type { SessionRecord } from './database.js';
export { SessionDatabase } from './database.js';
export type { DelegateEntry } from './delegateStore.js';
export { getDelegates, isDelegate } from './delegateStore.js';
export type { MessageSession } from './messageSessionStore.js';
export { MessageSessionStore } from './messageSessionStore.js';
export type { OrchestratorConfig, TaskMetadata } from './orchestrator.js';
// Classes
export { ConversationOrchestrator } from './orchestrator.js';
export type { QueryUsage } from './sessionManagerUtils.js';
export {
  buildPlatformEnv,
  buildSessionStats,
  isSessionNotFoundError,
  parseStderrLogLevel,
  resolveResponseText,
} from './sessionManagerUtils.js';
export {
  buildActiveTaskResponse,
  buildRecentTaskResponse,
  formatRunningFor,
  TaskRegistry,
  truncatePromptPreview,
} from './taskRegistry.js';
export type {
  ActiveTaskInfo,
  ActiveTaskResponse,
  CancelResult,
  ITaskRegistry,
  LiveTaskEntry,
  RecentTaskInfo,
  RecentTaskResponse,
  TaskOrigin,
  TaskRegistration,
  TaskRegistryEntry,
  TaskStatus,
} from './taskRegistry.types.js';
export type { TaskToolsOptions } from './taskTools.js';
export { createTaskTools, createTaskToolsServer } from './taskTools.js';
// Types
export type {
  Attachment,
  CompactionInfo,
  IncomingMessage,
  ISessionManager,
  Platform,
  PlatformAdapter,
  PlatformResponder,
  SenderRole,
  SessionCallbacks,
  SessionResult,
  SessionStats,
  ThreadSession,
  WakeupPayload,
} from './types.js';
