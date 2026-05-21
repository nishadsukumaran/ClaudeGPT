import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projectStatus } from './enums.js';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    githubRepo: text('github_repo').notNull().unique(),
    clickupFolderId: text('clickup_folder_id'),
    defaultBranch: text('default_branch').notNull().default('main'),
    status: projectStatus('status').notNull().default('active'),
    configJson: jsonb('config_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('idx_projects_status').on(t.status),
    repoIdx: uniqueIndex('idx_projects_github_repo').on(t.githubRepo),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
