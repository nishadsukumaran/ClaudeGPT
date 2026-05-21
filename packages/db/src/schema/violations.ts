import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { violationTypeEnum } from './enums.js';
import { projects } from './projects.js';

export const policyViolations = pgTable(
  'policy_violations',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    repo: text('repo').notNull(),
    issueNumber: integer('issue_number'),
    prNumber: integer('pr_number'),
    violationType: violationTypeEnum('violation_type').notNull(),
    reason: text('reason').notNull(),
    payloadJson: jsonb('payload_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('idx_violations_type').on(t.violationType),
    projectIdx: index('idx_violations_project').on(t.projectId),
    createdIdx: index('idx_violations_created').on(t.createdAt),
  }),
);

export type PolicyViolation = typeof policyViolations.$inferSelect;
export type NewPolicyViolation = typeof policyViolations.$inferInsert;
