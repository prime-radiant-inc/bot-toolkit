// src/core/taskRegistry.types.ts

import type { Platform, SessionStats } from './types.js';

export type TaskOrigin = 'user' | 'scheduled';

export type TaskStatus =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'interrupted-shutdown'
  | 'error';

/** SQLite row shape for the task_registry table. */
export interface TaskRegistryEntry {
  session_id: string;
  instance_id: string;
  room_id: string;
  thread_id: string | null;
  platform: Platform;
  origin: TaskOrigin;
  scheduler_job_id: string | null;
  prompt_preview: string;
  status: TaskStatus;
  started_at: number; // epoch millis (Date.now())
  last_heartbeat_at: number | null;
  completed_at: number | null;
  final_input_tokens: number | null;
  final_output_tokens: number | null;
  final_cost_usd: number | null;
  had_visible_output: number; // 0 or 1 (SQLite boolean)
}

/** In-memory live references for an active task. */
export interface LiveTaskEntry {
  abortController: AbortController;
  cancelCallback: () => Promise<void>;
  sessionPromise: Promise<void>;
}

/** Input for registering a new task. */
export interface TaskRegistration {
  sessionId: string;
  roomId: string;
  threadId: string | null;
  platform: Platform;
  origin: TaskOrigin;
  schedulerJobId?: string;
  promptPreview: string;
}

/** Result from cancel_task tool. */
export interface CancelResult {
  status: 'cancelled' | 'already_completed' | 'not_found' | 'starting_up';
  promptPreview?: string;
  runningFor?: string;
  wasScheduled?: boolean;
  schedulerJobId?: string;
  message: string;
}

/** Single task in the active tasks tool response. */
export interface ActiveTaskInfo {
  id: string;
  room: string;
  thread_id: string | null;
  origin: TaskOrigin;
  prompt_preview: string;
  started_at: string; // ISO-8601
  running_for: string;
  scheduler_job_id: string | null;
}

/** Response from list_active_tasks tool. */
export interface ActiveTaskResponse {
  tasks: ActiveTaskInfo[];
  count: number;
}

/** Single task in the recent tasks tool response. */
export interface RecentTaskInfo {
  id: string;
  room: string;
  origin: TaskOrigin;
  prompt_preview: string;
  status: TaskStatus;
  started_at: string; // ISO-8601
  completed_at: string | null;
  duration: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

/** Response from list_recent_tasks tool. */
export interface RecentTaskResponse {
  tasks: RecentTaskInfo[];
  count: number;
}

/** Interface for the task registry, used by the orchestrator. */
export interface ITaskRegistry {
  /** Register a new active task. */
  register(entry: TaskRegistration, liveEntry: LiveTaskEntry): void;

  /** Mark a task as completed with final stats. */
  complete(sessionId: string, stats: SessionStats): void;

  /** Mark a task as errored. */
  markError(sessionId: string, stats?: SessionStats): void;

  /** Mark a task as cancelled (called by cancel_task tool only). */
  cancel(sessionId: string): void;

  /** Update heartbeat timestamp (throttled internally). */
  heartbeat(sessionId: string): void;

  /** Set had_visible_output = 1 for a task. */
  setHadVisibleOutput(sessionId: string): void;

  /** Get all active tasks for the current instance. */
  getActive(): TaskRegistryEntry[];

  /** Get recently completed tasks within the given time window. */
  getRecent(hours: number): TaskRegistryEntry[];

  /** Get a task entry from SQLite by session ID. */
  getEntry(sessionId: string): TaskRegistryEntry | null;

  /** Get the in-memory live entry for an active task. */
  getLiveEntry(sessionId: string): LiveTaskEntry | undefined;

  /** Remove a live entry from the in-memory map. */
  removeLiveEntry(sessionId: string): void;

  /** Abort all active sessions and await their completion. */
  abortAll(): Promise<void>;

  /** Mark all active tasks for this instance as interrupted-shutdown. */
  markInterruptedShutdown(): void;

  /** Recover tasks interrupted by a previous instance (30s delay, async). */
  recoverInterruptedTasks(
    adapters: Map<
      string,
      {
        sendRecoveryNotice(
          channelId: string,
          threadId: string | null,
          text: string,
        ): Promise<void>;
      }
    >,
  ): Promise<void>;

  /** Delete old completed/cancelled/error records. */
  cleanup(days?: number): void;
}
