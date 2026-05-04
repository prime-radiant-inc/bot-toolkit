// src/utils/logger.ts
// JSON structured logging for Loki/Promtail ingestion

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

// Initialize log file directory if LOG_FILE env var is set
// File permissions: 0o640 (owner rw, group r, others none)
const LOG_FILE_MODE = 0o640;
const logFile = process.env.LOG_FILE;
if (logFile) {
  const dir = dirname(logFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o750 });
  }
}

export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...meta,
    };

    const output = JSON.stringify(entry);

    // Write to file if LOG_FILE is configured (for Promtail)
    if (logFile) {
      try {
        appendFileSync(logFile, `${output}\n`, { mode: LOG_FILE_MODE });
      } catch {
        // Silently fail file writes to avoid breaking the app
      }
    }

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'debug':
        if (process.env.DEBUG) {
          console.debug(output);
        }
        return;
      default:
        console.log(output);
    }
  }

  /**
   * Convert variadic args to a metadata object.
   * Handles both old-style `logger.info('msg', obj1, obj2)` and new-style `logger.info('msg', { key: value })`.
   */
  private argsToMeta(args: unknown[]): Record<string, unknown> | undefined {
    if (args.length === 0) return undefined;

    // If single object argument, use it directly as meta
    if (
      args.length === 1 &&
      typeof args[0] === 'object' &&
      args[0] !== null &&
      !(args[0] instanceof Error)
    ) {
      return args[0] as Record<string, unknown>;
    }

    // Otherwise, collect all args into a 'data' array
    return { data: args };
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, this.argsToMeta(args));
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, this.argsToMeta(args));
  }

  error(
    message: string,
    errorOrMeta?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    const errorMeta: Record<string, unknown> = { ...meta };

    // Handle different call patterns:
    // 1. logger.error('msg', error) - Error object directly
    // 2. logger.error('msg', { error, ...meta }) - object with error property
    // 3. logger.error('msg', { ...meta }) - object without error property

    if (errorOrMeta instanceof Error) {
      // Direct Error object
      errorMeta.error = errorOrMeta.message;
      errorMeta.stack = errorOrMeta.stack;
    } else if (typeof errorOrMeta === 'object' && errorOrMeta !== null) {
      const obj = errorOrMeta as Record<string, unknown>;
      if ('error' in obj) {
        // Object with error property
        const err = obj.error;
        if (err instanceof Error) {
          errorMeta.error = err.message;
          errorMeta.stack = err.stack;
        } else if (err !== undefined) {
          errorMeta.error = String(err);
        }
        // Copy other properties
        for (const [key, value] of Object.entries(obj)) {
          if (key !== 'error') {
            errorMeta[key] = value;
          }
        }
      } else {
        // Plain metadata object
        Object.assign(errorMeta, obj);
      }
    } else if (errorOrMeta !== undefined) {
      errorMeta.error = String(errorOrMeta);
    }

    this.log(
      'error',
      message,
      Object.keys(errorMeta).length > 0 ? errorMeta : undefined,
    );
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, this.argsToMeta(args));
  }
}
