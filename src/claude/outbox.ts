import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Outbox');

/**
 * Process outbox directory - send any files to the chat platform and move to sent/.
 *
 * Claude writes files to {roomDir}/outbox/. After the session completes,
 * this function sends each file via the platform responder and moves
 * successfully sent files to outbox/sent/.
 */
export async function processOutbox(
  roomDir: string,
  sendFile: (filePath: string, filename?: string) => Promise<void>,
): Promise<void> {
  const outboxDir = path.join(roomDir, 'outbox');
  const sentDir = path.join(outboxDir, 'sent');

  // Nothing to do if outbox doesn't exist
  if (!fs.existsSync(outboxDir)) {
    return;
  }

  // Get files in outbox (excluding directories and sent/)
  const entries = fs.readdirSync(outboxDir);
  const files = entries.filter((name) => isSafeOutboxFile(outboxDir, name));

  if (files.length === 0) {
    return;
  }

  // Ensure sent/ directory exists
  fs.mkdirSync(sentDir, { recursive: true });

  // Send each file and move to sent/
  for (const file of files.sort()) {
    const filePath = path.join(outboxDir, file);

    try {
      logger.info('Sending file from outbox', { file });
      await sendFile(filePath, file);

      // Move to sent/ with timestamp prefix
      const sentPath = path.join(sentDir, `${Date.now()}-${file}`);
      fs.renameSync(filePath, sentPath);
      logger.info('File sent and moved to sent/', { file, sentPath });
    } catch (error) {
      logger.error('Failed to send file from outbox', { file, error });
      // Continue with other files even if one fails
    }
  }
}

function isSafeOutboxFile(outboxDir: string, name: string): boolean {
  if (name === 'sent') return false;

  const filePath = path.join(outboxDir, name);
  const stat = fs.lstatSync(filePath);
  return stat.isFile() && stat.nlink === 1;
}
