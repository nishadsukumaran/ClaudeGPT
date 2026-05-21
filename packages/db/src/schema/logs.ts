import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { logLevelEnum } from './enums.js';
import { agentRuns } from './runs.js';

export const runLogs = pgTable(
  'run_logs',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    level: logLevelEnum('level').notNull().default('info'),
    source: text('source').notNull(),
    message: text('message').notNull(),
    metadataJson: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('idx_run_logs_run_id').on(t.runId),
    levelIdx: index('idx_run_logs_level').on(t.level),
    createdIdx: index('idx_run_logs_created').on(t.createdAt),
  }),
);

export type RunLog = typeof runLogs.$inferSelect;
export type NewRunLog = typeof runLogs.$inferInsert;
