// src/config/paths.ts
// Centralized path configuration for claude-pa-matrix-bot
// Paths are derived from environment variables with backwards-compatible defaults

// Base paths from environment (with backwards-compatible defaults)
const PA_DATA = process.env.SEN_PA_DATA_DIR || '/app/data/pa';
const SCHEDULER_DATA =
  process.env.SEN_SCHEDULER_DATA_DIR || '/app/data/scheduler';
const SHARED_DATA = process.env.SEN_SHARED_DATA_DIR || '/app/data/shared';

export const paths = {
  pa: {
    root: PA_DATA,
    infrastructure: `${PA_DATA}/infrastructure`,
    sessionsDb: `${PA_DATA}/infrastructure/sessions.db`,
    repos: `${PA_DATA}/repos`,
    rooms: `${PA_DATA}/rooms`,
    config: `${PA_DATA}/config`,
    mcpData: `${PA_DATA}/mcp-data`,
    browserSessions: `${PA_DATA}/browser-sessions`,
    wiki: `${PA_DATA}/wiki`,
    conduit: `${PA_DATA}/conduit`,
    matrixSync: `${PA_DATA}/matrix-sync.json`,
  },
  scheduler: {
    root: SCHEDULER_DATA,
    infrastructure: `${SCHEDULER_DATA}/infrastructure`,
    schedulerDb: `${SCHEDULER_DATA}/infrastructure/scheduler.db`,
  },
  shared: {
    root: SHARED_DATA,
    tailscale: {
      pa: `${SHARED_DATA}/tailscale/pa`,
      scheduler: `${SHARED_DATA}/tailscale/scheduler`,
      dashboard: `${SHARED_DATA}/tailscale/dashboard`,
    },
  },
};

/**
 * Helper for room-specific paths.
 * @param roomName - The sanitized room name/ID
 * @param subdir - Optional subdirectory within the room
 */
export function roomPath(roomName: string, subdir?: string): string {
  const base = `${paths.pa.rooms}/${roomName}`;
  return subdir ? `${base}/${subdir}` : base;
}

/**
 * Get the base data directory for PA (the root of PA's data mount).
 * This is useful for backwards compatibility with code that expects DATA_DIRECTORY.
 */
export function getDataDirectory(): string {
  return PA_DATA;
}
