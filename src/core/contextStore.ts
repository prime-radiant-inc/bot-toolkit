// src/context/contextStore.ts
// Stores and retrieves the user's real-time context (location, phone state, health data)

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ContextStore');

// Derive wiki location from HOME - no separate env var needed
const KNOWLEDGE_DIR = process.env.HOME
  ? path.join(process.env.HOME, 'wiki')
  : undefined;
const DEFAULT_TIMEZONE = 'UTC';

interface TimezoneResult {
  timezone: string;
  configured: boolean;
}

// NOTE: This timezone validation logic is also in claude-pa-scheduler/src/mcp.ts
// If updating, consider updating both (or consolidating in future)
// Abbreviations that Intl accepts but don't handle DST correctly or are ambiguous
// BST = Bangladesh Standard Time (NOT British Summer Time!)
// IST = India Standard Time (NOT Irish Standard Time or Israel Standard Time!)
const REJECTED_ABBREVIATIONS = new Set([
  'PST',
  'PDT',
  'EST',
  'EDT',
  'CST',
  'CDT',
  'MST',
  'MDT',
  'GMT',
  'BST',
  'IST',
  'pst',
  'pdt',
  'est',
  'edt',
  'cst',
  'cdt',
  'mst',
  'mdt',
  'gmt',
  'bst',
  'ist',
]);

/**
 * Validate timezone string. Rejects abbreviations that don't handle DST correctly.
 * @param tz - timezone string to validate
 * @returns true if valid IANA timezone, false otherwise
 */
export function isValidTimezone(tz: unknown): tz is string {
  // Must be a non-empty string
  if (typeof tz !== 'string' || tz.trim() === '') {
    return false;
  }

  // Reject common abbreviations - they don't handle DST correctly
  // e.g., "PST" is always UTC-8, even in summer when Pacific is actually PDT (UTC-7)
  if (REJECTED_ABBREVIATIONS.has(tz)) {
    logger.debug('Timezone abbreviation rejected - must use IANA format', {
      provided: tz,
      hint: 'Use America/Los_Angeles for Pacific, America/New_York for Eastern, Europe/London for UK',
    });
    return false;
  }

  // Validate against Intl
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read user's timezone from ABOUT-MY-BOSS.md frontmatter.
 * Falls back to UTC with configured=false if not set.
 */
export function getUserTimezone(): TimezoneResult {
  if (!KNOWLEDGE_DIR) {
    logger.debug('HOME not set, cannot locate wiki for timezone', {
      fallback: DEFAULT_TIMEZONE,
    });
    return { timezone: DEFAULT_TIMEZONE, configured: false };
  }

  const prefsPath = path.join(KNOWLEDGE_DIR, 'ABOUT-MY-BOSS.md');

  // Check if file exists first
  if (!fs.existsSync(prefsPath)) {
    logger.debug('ABOUT-MY-BOSS.md not found, using default timezone', {
      path: prefsPath,
      fallback: DEFAULT_TIMEZONE,
    });
    return { timezone: DEFAULT_TIMEZONE, configured: false };
  }

  try {
    // Force YAML parsing to prevent code execution via gray-matter's JavaScript engine
    const { data } = matter(fs.readFileSync(prefsPath, 'utf-8'), {
      language: 'yaml',
    });
    const tz = data.timezone;

    // Handle YAML null explicitly
    if (tz === null || tz === 'null') {
      logger.debug('Timezone explicitly set to null in frontmatter', {
        fallback: DEFAULT_TIMEZONE,
      });
      return { timezone: DEFAULT_TIMEZONE, configured: false };
    }

    if (isValidTimezone(tz)) {
      return { timezone: tz, configured: true };
    }

    logger.debug('Timezone not in frontmatter or invalid, using default', {
      frontmatterTimezone: tz,
      fallback: DEFAULT_TIMEZONE,
    });
    return { timezone: DEFAULT_TIMEZONE, configured: false };
  } catch (error) {
    logger.debug('Failed to read timezone from preferences', {
      error,
      fallback: DEFAULT_TIMEZONE,
    });
    return { timezone: DEFAULT_TIMEZONE, configured: false };
  }
}

/**
 * Extract timezone abbreviation using formatToParts for robustness.
 * Avoids fragile string splitting that breaks on "Pacific Standard Time".
 */
export function getTimezoneAbbreviation(timezone: string, date: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}

export interface LocationContext {
  lat: number;
  lon: number;
  accuracy?: number;
  altitude?: number;
  velocity?: number;
  battery?: number;
  timestamp: string;
}

export interface PhoneContext {
  dnd_enabled?: boolean;
  focus_mode?: string;
  battery_percent?: number;
  timestamp: string;
}

export interface HealthContext {
  timestamp: string;
  sleep?: {
    duration_hours: number;
    in_bed_hours?: number;
    bedtime?: string;
    wake_time?: string;
    stages?: {
      deep_hours?: number;
      rem_hours?: number;
      light_hours?: number;
    };
  };
  activity?: {
    steps: number;
    active_calories: number;
    exercise_minutes: number;
    stand_hours: number;
  };
}

export interface UserContext {
  updated_at: string;
  location?: LocationContext;
  phone?: PhoneContext;
  health?: HealthContext;
}

const CONTEXT_FILE = 'user-context.json';
const OLD_CONTEXT_FILE = 'jesse-context.json'; // For migration from legacy filename

export class ContextStore {
  private filePath: string;
  private context: UserContext;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, CONTEXT_FILE);
    this.context = this.load();
  }

  private load(): UserContext {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data);
        logger.info('Loaded existing context', {
          updated_at: parsed.updated_at,
        });
        return parsed;
      }

      // MIGRATION: Check for old filename if new doesn't exist
      const oldPath = path.join(path.dirname(this.filePath), OLD_CONTEXT_FILE);
      if (fs.existsSync(oldPath)) {
        const data = fs.readFileSync(oldPath, 'utf-8');
        const parsed = JSON.parse(data);
        logger.info('Migrating context from old filename', {
          oldPath,
          newPath: this.filePath,
        });
        // Write to new location
        fs.writeFileSync(this.filePath, JSON.stringify(parsed, null, 2));
        // Remove old file
        fs.unlinkSync(oldPath);
        return parsed;
      }
    } catch (error) {
      logger.error('Failed to load context file, starting fresh', { error });
    }
    return { updated_at: new Date().toISOString() };
  }

  private save(): void {
    try {
      this.context.updated_at = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.context, null, 2));
      logger.debug('Context saved', { updated_at: this.context.updated_at });
    } catch (error) {
      logger.error('Failed to save context', { error });
    }
  }

  updateLocation(location: LocationContext): void {
    this.context.location = location;
    this.save();
    logger.info('Location updated', { lat: location.lat, lon: location.lon });
  }

  updatePhone(phone: PhoneContext): void {
    this.context.phone = phone;
    this.save();
    logger.info('Phone context updated', {
      dnd: phone.dnd_enabled,
      focus: phone.focus_mode,
    });
  }

  updateHealth(health: HealthContext): void {
    this.context.health = health;
    this.save();
    logger.info('Health context updated', {
      sleepHours: health.sleep?.duration_hours,
      steps: health.activity?.steps,
    });
  }

  getContext(): UserContext {
    return this.context;
  }

  // Format context as human-readable string for injection into Claude
  formatForClaude(): string {
    const parts: string[] = [];
    const now = new Date();
    const { timezone: userTimezone, configured } = getUserTimezone();
    const tzAbbrev = getTimezoneAbbreviation(userTimezone, now);

    // Explicit timezone statement (so Claude can answer "what's my timezone?")
    if (configured) {
      parts.push(`User timezone: ${userTimezone} (${tzAbbrev})`);
    } else {
      parts.push(
        `User timezone: ${userTimezone} (not configured - ask user for their timezone)`,
      );
    }

    // Always include current time - critical for scheduled wakeups where agent doesn't know when it was triggered
    const timeStr = now.toLocaleString('en-US', {
      timeZone: userTimezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
    parts.push(`Current time: ${timeStr}`);

    // Health context (if fresh - within 36 hours)
    if (this.context.health) {
      const healthTime = new Date(this.context.health.timestamp);
      const ageHours = (now.getTime() - healthTime.getTime()) / 1000 / 60 / 60;

      if (ageHours < 36) {
        const healthParts: string[] = [];

        // Sleep line
        if (this.context.health.sleep) {
          const s = this.context.health.sleep;
          let sleepLine = `Sleep: ${s.duration_hours.toFixed(1)}h`;

          if (s.bedtime && s.wake_time) {
            const bedtime = new Date(s.bedtime);
            const wakeTime = new Date(s.wake_time);
            const bedStr = bedtime
              .toLocaleTimeString('en-US', {
                timeZone: userTimezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })
              .toLowerCase()
              .replace(' ', '');
            const wakeStr = wakeTime
              .toLocaleTimeString('en-US', {
                timeZone: userTimezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })
              .toLowerCase()
              .replace(' ', '');
            sleepLine += ` (${bedStr}–${wakeStr})`;
          }

          if (s.stages) {
            const stageParts: string[] = [];
            if (s.stages.deep_hours)
              stageParts.push(`Deep ${s.stages.deep_hours.toFixed(1)}h`);
            if (s.stages.rem_hours)
              stageParts.push(`REM ${s.stages.rem_hours.toFixed(1)}h`);
            if (stageParts.length > 0) {
              sleepLine += ` | ${stageParts.join(', ')}`;
            }
          }

          healthParts.push(sleepLine);
        }

        // Activity line
        if (this.context.health.activity) {
          const a = this.context.health.activity;
          const activityLine = `Today: ${a.steps.toLocaleString()} steps, ${a.active_calories} cal, ${a.exercise_minutes} exercise, ${a.stand_hours} stand hrs`;
          healthParts.push(activityLine);
        }

        if (healthParts.length > 0) {
          parts.push('<health-context>');
          parts.push(...healthParts);
          parts.push('</health-context>');
        }
      }
    }

    // Location (if recent - within last hour)
    if (this.context.location) {
      const locTime = new Date(this.context.location.timestamp);
      const ageMinutes = (now.getTime() - locTime.getTime()) / 1000 / 60;
      if (ageMinutes < 60) {
        parts.push(
          `Location: ${this.context.location.lat.toFixed(4)}, ${this.context.location.lon.toFixed(4)} (${Math.round(ageMinutes)} min ago)`,
        );
      }
    }

    // Phone state (if recent - within last 30 min)
    if (this.context.phone) {
      const phoneTime = new Date(this.context.phone.timestamp);
      const ageMinutes = (now.getTime() - phoneTime.getTime()) / 1000 / 60;
      if (ageMinutes < 30) {
        const focusInfo = this.context.phone.focus_mode
          ? `Focus: ${this.context.phone.focus_mode}`
          : this.context.phone.dnd_enabled
            ? 'Do Not Disturb: ON'
            : 'Do Not Disturb: OFF';
        parts.push(`Phone: ${focusInfo}`);
      }
    }

    return parts.join('\n');
  }

  // Check if context is stale (no updates in last 2 hours)
  isStale(): boolean {
    const updated = new Date(this.context.updated_at);
    const ageHours = (Date.now() - updated.getTime()) / 1000 / 60 / 60;
    return ageHours > 2;
  }
}
