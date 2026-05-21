import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agentTypeEnum, agentProviderEnum, agentStatusEnum } from './enums.js';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  name: text('name').notNull().unique(),
  type: agentTypeEnum('type').notNull(),
  provider: agentProviderEnum('provider').notNull(),
  status: agentStatusEnum('status').notNull().default('enabled'),
  configJson: jsonb('config_json').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
