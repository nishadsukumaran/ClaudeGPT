import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { jobTypeEnum, jobStatusEnum } from './enums.js';
import { projects } from './projects.js';
import { agents } from './agents.js';

export const agentJobs = pgTable(
  'agent_jobs',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
    jobType: jobTypeEnum('job_type').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(100),
    githubRepo: text('github_repo').notNull(),
    githubIssueNumber: integer('github_issue_number'),
    githubPrNumber: integer('github_pr_number'),
    clickupTaskId: text('clickup_task_id'),
    payloadJson: jsonb('payload_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('idx_jobs_status').on(t.status),
    projectStatusIdx: index('idx_jobs_project_status').on(t.projectId, t.status),
    issueIdx: index('idx_jobs_issue').on(t.githubRepo, t.githubIssueNumber),
    prIdx: index('idx_jobs_pr').on(t.githubRepo, t.githubPrNumber),
    createdIdx: index('idx_jobs_created').on(t.createdAt),
  }),
);

export type AgentJob = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;
