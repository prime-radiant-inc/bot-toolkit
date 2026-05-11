import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

export interface Config {
  claude: {
    paDirectory: string;
    configDir: string; // Directory containing instance.json and secrets.json
  };
  database: {
    path: string;
  };
  dataDirectory: string; // Base directory for persistent data (room directories, etc.)
  timezone: string;
  useAgentSDK: boolean; // Feature flag: use Agent SDK instead of CLI spawning
  /** Controls the Claude Agent SDK's auto-memory feature.
   *  - 'enabled' (default) preserves current SDK behavior.
   *  - 'disabled' sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in the SDK subprocess
   *    env, removing the system-prompt memory section and the memory-write gate.
   *  Multi-tenant bots with their own memory architecture (wiki, learned
   *  behaviors) should set this to 'disabled'. Single-tenant per-user bots can
   *  leave it enabled. */
  autoMemory?: 'enabled' | 'disabled';
}

export function loadConfig(): Config {
  dotenv.config();

  const databasePath =
    process.env.DATABASE_PATH || './data/infrastructure/sessions.db';
  // Data directory is explicitly set or derived from DATABASE_PATH
  // With new structure: /app/data/infrastructure/sessions.db -> /app/data
  // (go up two levels from DB file to get to data root)
  const dataDirectory =
    process.env.DATA_DIRECTORY || path.dirname(path.dirname(databasePath));

  return {
    claude: {
      paDirectory: process.env.CLAUDE_PA_DIR || '',
      configDir:
        process.env.CONFIG_DIR || path.join(os.homedir(), 'etc', 'sen'),
    },
    database: {
      path: databasePath,
    },
    dataDirectory,
    timezone: process.env.TZ || 'America/Los_Angeles',
    useAgentSDK: process.env.USE_AGENT_SDK !== 'false', // SDK mode is default, set USE_AGENT_SDK=false for CLI mode
  };
}
