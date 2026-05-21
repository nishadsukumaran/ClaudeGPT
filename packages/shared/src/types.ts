/**
 * Cross-cutting domain types. Mirrors the enums in docs/05-database-schema.md
 * and the API shapes in docs/06-api-specification.md.
 */

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type AgentType = 'builder' | 'reviewer' | 'sync' | 'release';
export type AgentProvider = 'anthropic' | 'openai' | 'internal';
export type AgentStatus = 'enabled' | 'disabled';

export type JobType =
  | 'claude_implement_issue'
  | 'claude_rework_pr'
  | 'openai_qa_review'
  | 'clickup_sync'
  | 'vercel_deploy_check'
  | 'neon_migration_review'
  | 'release_prep';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'killed';

export type MappingStatus =
  | 'open'
  | 'in_progress'
  | 'qa'
  | 'rework'
  | 'approved'
  | 'merged'
  | 'closed'
  | 'blocked';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ViolationType =
  | 'unknown_repo'
  | 'untrusted_user'
  | 'invalid_label'
  | 'missing_acceptance'
  | 'blocked_task_type'
  | 'already_claimed'
  | 'limit_exceeded';

/**
 * Standard pagination envelope.
 */
export interface Pagination {
  total: number;
  limit: number;
  offset: number;
}

export interface ListResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  request_id: string;
}
