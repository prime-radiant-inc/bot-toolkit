// src/core/delegateStore.ts
// Reads delegate list from ABOUT-MY-BOSS.md frontmatter

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { Logger } from '../utils/logger.js';

const logger = new Logger('DelegateStore');

export interface DelegateEntry {
  id: string;
  name: string;
  platform: string;
}

/**
 * Read delegates from ABOUT-MY-BOSS.md frontmatter.
 * Re-reads on every call so edits take effect immediately.
 * Returns [] if file missing, field missing, or parse error.
 */
export function getDelegates(): DelegateEntry[] {
  const knowledgeDir = process.env.HOME
    ? path.join(process.env.HOME, 'wiki')
    : undefined;

  if (!knowledgeDir) {
    logger.debug('HOME not set, cannot locate wiki for delegates');
    return [];
  }

  const prefsPath = path.join(knowledgeDir, 'ABOUT-MY-BOSS.md');

  if (!fs.existsSync(prefsPath)) {
    logger.debug('ABOUT-MY-BOSS.md not found', { path: prefsPath });
    return [];
  }

  try {
    const { data } = matter(fs.readFileSync(prefsPath, 'utf-8'), {
      language: 'yaml',
    });

    if (!Array.isArray(data.delegates) || data.delegates.length === 0) {
      return [];
    }

    return data.delegates.filter(
      (d: unknown): d is DelegateEntry =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as DelegateEntry).id === 'string' &&
        typeof (d as DelegateEntry).name === 'string' &&
        typeof (d as DelegateEntry).platform === 'string',
    );
  } catch (error) {
    logger.debug('Failed to read delegates from preferences', { error });
    return [];
  }
}

/**
 * Check if a user is a delegate on the given platform.
 */
export function isDelegate(userId: string, platform: string): boolean {
  return getDelegates().some((d) => d.id === userId && d.platform === platform);
}
