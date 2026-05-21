import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agentJobs } from './jobs.js';

export const taskClaims = pgTable(
  'task_claims',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    repo: text('repo').notNull(),
    issueNumber: integer('issue_number').notNull(),
    jobId: uuid('job_id').notNull().references(() => agentJobs.id, { onDelete: 'cascade' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => ({
    repoIssueUnique: unique('uniq_claims_repo_issue').on(t.repo, t.issueNumber),
  }),
);

export type TaskClaim = typeof taskClaims.$inferSelect;
export type NewTaskClaim = typeof taskClaims.$inferInsert;
