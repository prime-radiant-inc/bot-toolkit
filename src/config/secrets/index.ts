// src/config/secrets/index.ts

import { Logger } from '../../utils/logger.js';
import type { SecretsReader } from '../configTypes.js';
import { LocalSecretsReader } from './local.js';
import { SSMSecretsReader } from './ssm.js';

export { LocalSecretsReader } from './local.js';
export type { SSMSecretsReaderOptions } from './ssm.js';
export { SSMSecretsReader } from './ssm.js';

const logger = new Logger('SecretsReader');

/**
 * Factory function to create the appropriate SecretsReader.
 * Uses SECRETS_BACKEND env var to select backend:
 * - 'ssm': AWS SSM Parameter Store (production)
 * - 'local' or unset: File-based (local development)
 */
export function getSecretsReader(configDir: string): SecretsReader {
  const backend = process.env.SECRETS_BACKEND || 'local';

  if (backend === 'ssm') {
    logger.info('Using SSM secrets backend', {
      instanceName: process.env.INSTANCE_NAME,
    });
    return new SSMSecretsReader();
  }

  logger.info('Using local secrets backend', {
    path: `${configDir}/secrets.json`,
  });
  return new LocalSecretsReader(`${configDir}/secrets.json`);
}
