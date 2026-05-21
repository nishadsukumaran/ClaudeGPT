import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const githubEvents = pgTable(
  'github_events',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    eventType: text('event_type').notNull(),
    deliveryId: text('delivery_id').notNull().unique(),
    repo: text('repo').notNull(),
    sender: text('sender'),
    payloadJson: jsonb('payload_json').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    repoTypeIdx: index('idx_events_repo_type').on(t.repo, t.eventType),
    processedIdx: index('idx_events_processed').on(t.processedAt),
    createdIdx: index('idx_events_created').on(t.createdAt),
    deliveryIdx: uniqueIndex('idx_events_delivery').on(t.deliveryId),
  }),
);

export type GithubEvent = typeof githubEvents.$inferSelect;
export type NewGithubEvent = typeof githubEvents.$inferInsert;
