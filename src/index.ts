// Core types and classes

export type { Config } from './config/config.js';
// Configuration
export { loadConfig } from './config/config.js';
export { ConfigStore } from './config/configStore.js';
export type {
  InstanceConfig,
  McpConfig,
  PluginConfig,
  SecretsReader,
} from './config/configTypes.js';
export type { SSMSecretsReaderOptions } from './config/secrets/index.js';
// Secrets management (for advanced configuration)
export {
  getSecretsReader,
  LocalSecretsReader,
  SSMSecretsReader,
} from './config/secrets/index.js';
export type {
  MainSessionRecord,
  ThreadSessionRecord,
} from './core/database.js';
export * from './core/index.js';
export { ClaudeSessionManagerSDK } from './core/sessionManagerSDK.js';
export type { SystemPromptConfig } from './core/types.js';
export type { DebugLogEntry } from './debug/index.js';
export { SessionLogger } from './debug/index.js';
// Native chat API
export * from './native/index.js';
// Debug utilities
export {
  BotError,
  ClaudeSessionError,
  DatabaseError,
} from './utils/errors.js';
// Utilities
export { Logger } from './utils/logger.js';
export type { RoomInfo, RoomMetadata } from './utils/roomPath.js';
export { getRoomDirectory, sanitizeRoomId } from './utils/roomPath.js';
export { sanitizeForPrompt } from './utils/sanitize.js';
export {
  endsAtSentenceBoundary,
  findLastSentenceBoundary,
  getResponsePreview,
} from './utils/text.js';
export type { WakeupServerConfig } from './wakeup/server.js';
// Wakeup server
export { createWakeupServer, startWakeupServer } from './wakeup/server.js';
