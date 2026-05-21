import { pgTable, uuid, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { mappingStatusEnum } from './enums.js';
import { projects } from './projects.js';
import { agentJobs } from './jobs.js';
import { agentRuns } from './runs.js';

export const githubIssueMappings = pgTable(
  'github_issue_mappings',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    issueNumber: integer('issue_number').notNull(),
    clickupTaskId: text('clickup_task_id'),
    latestJobId: uuid('latest_job_id').references(() => agentJobs.id, { onDelete: 'set null' }),
    status: mappingStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    repoIssueUnique: unique('uniq_issue_map_repo_issue').on(t.repo, t.issueNumber),
    projectIdx: index('idx_issue_map_project').on(t.projectId),
    statusIdx: index('idx_issue_map_status').on(t.status),
  }),
);

export const githubPrMappings = pgTable(
  'github_pr_mappings',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    prNumber: integer('pr_number').notNull(),
    issueNumber: integer('issue_number'),
    latestQaRunId: uuid('latest_qa_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    status: mappingStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    repoPrUnique: unique('uniq_pr_map_repo_pr').on(t.repo, t.prNumber),
    projectIdx: index('idx_pr_map_project').on(t.projectId),
    statusIdx: index('idx_pr_map_status').on(t.status),
    issueIdx: index('idx_pr_map_issue').on(t.repo, t.issueNumber),
  }),
);

export const clickupMappings = pgTable(
  'clickup_mappings',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    githubRepo: text('github_repo').notNull(),
    githubIssueNumber: integer('github_issue_number'),
    githubPrNumber: integer('github_pr_number'),
    clickupTaskId: text('clickup_task_id').notNull(),
    clickupListId: text('clickup_list_id'),
    status: mappingStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('idx_clickup_map_task').on(t.clickupTaskId),
    issueIdx: index('idx_clickup_map_issue').on(t.githubRepo, t.githubIssueNumber),
    prIdx: index('idx_clickup_map_pr').on(t.githubRepo, t.githubPrNumber),
  }),
);

export type IssueMapping = typeof githubIssueMappings.$inferSelect;
export type PrMapping = typeof githubPrMappings.$inferSelect;
export type ClickupMapping = typeof clickupMappings.$inferSelect;
