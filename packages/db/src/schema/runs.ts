import { pgTable, uuid, text, integer, timestamp, index, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { runStatusEnum } from './enums.js';
import { agentJobs } from './jobs.js';

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    jobId: uuid('job_id').notNull().references(() => agentJobs.id, { onDelete: 'cascade' }),
    status: runStatusEnum('status').notNull().default('queued'),
    branchName: text('branch_name'),
    commitSha: text('commit_sha'),
    prNumber: integer('pr_number'),
    promptSnapshot: text('prompt_snapshot'),
    resultSummary: text('result_summary'),
    errorMessage: text('error_message'),
    tokenUsage: integer('token_usage'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobIdx: index('idx_runs_job_id').on(t.jobId),
    statusIdx: index('idx_runs_status').on(t.status),
    createdIdx: index('idx_runs_created').on(t.createdAt),
  }),
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
