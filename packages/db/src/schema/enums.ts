import { pgEnum } from 'drizzle-orm/pg-core';

export const projectStatus = pgEnum('project_status', ['active', 'paused', 'archived']);

export const agentTypeEnum = pgEnum('agent_type', ['builder', 'reviewer', 'sync', 'release']);
export const agentProviderEnum = pgEnum('agent_provider', ['anthropic', 'openai', 'internal']);
export const agentStatusEnum = pgEnum('agent_status', ['enabled', 'disabled']);

export const jobTypeEnum = pgEnum('job_type', [
  'claude_implement_issue',
  'claude_rework_pr',
  'openai_qa_review',
  'clickup_sync',
  'vercel_deploy_check',
  'neon_migration_review',
  'release_prep',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
]);

export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'killed',
]);

export const mappingStatusEnum = pgEnum('mapping_status', [
  'open',
  'in_progress',
  'qa',
  'rework',
  'approved',
  'merged',
  'closed',
  'blocked',
]);

export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warn', 'error']);

export const violationTypeEnum = pgEnum('violation_type', [
  'unknown_repo',
  'untrusted_user',
  'invalid_label',
  'missing_acceptance',
  'blocked_task_type',
  'already_claimed',
  'limit_exceeded',
]);
