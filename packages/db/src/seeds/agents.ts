import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';
import type { NewAgent } from '../schema/agents.js';

/**
 * Canonical agent rows. Each maps to one of the `agents/*.md` definitions.
 *
 * Auth fields document which subscription each agent runs against:
 *   - claude-cli: Claude Max via `claude` CLI (OAuth)
 *   - github-app: ChatGPT GitHub App (operator's ChatGPT Pro subscription).
 *                 The reviewer is a LISTENER — we react to ChatGPT's review
 *                 comments rather than invoking ChatGPT programmatically.
 */
export const AGENT_SEEDS: NewAgent[] = [
  {
    name: 'claude-builder',
    type: 'builder',
    provider: 'anthropic',
    status: 'enabled',
    configJson: {
      model: 'claude-sonnet-4-6',
      auth: 'claude-cli',
      role: 'builder',
      definition_path: 'agents/builder.md',
      temperature: 0.2,
      max_tokens_per_run: 200_000,
      max_minutes_per_run: 30,
    },
  },
  {
    name: 'openai-reviewer',
    type: 'reviewer',
    provider: 'openai',
    status: 'enabled',
    configJson: {
      model: 'chatgpt-github-app',
      auth: 'github-app',
      mode: 'listener',
      role: 'reviewer',
      definition_path: 'agents/reviewer.md',
      max_minutes_per_run: 30,
    },
  },
  {
    name: 'claude-rework',
    type: 'builder',
    provider: 'anthropic',
    status: 'enabled',
    configJson: {
      model: 'claude-sonnet-4-6',
      auth: 'claude-cli',
      role: 'rework',
      definition_path: 'agents/rework.md',
      temperature: 0.2,
      max_tokens_per_run: 150_000,
      max_minutes_per_run: 20,
    },
  },
  {
    name: 'clickup-sync',
    type: 'sync',
    provider: 'internal',
    status: 'enabled',
    configJson: {
      model: 'none',
      role: 'sync',
      definition_path: 'agents/sync.md',
    },
  },
  {
    name: 'release-prep',
    type: 'release',
    provider: 'openai',
    status: 'disabled',
    configJson: {
      model: 'chatgpt-github-app',
      auth: 'github-app',
      role: 'release',
      definition_path: 'agents/release.md',
      activation_status: 'not_yet_implemented',
    },
  },
];

/**
 * Upsert all canonical agent rows. Idempotent — safe to run on every boot.
 */
export async function seedAgents<TSchema extends Record<string, unknown> = typeof schema>(
  db: NodePgDatabase<TSchema>,
): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const agent of AGENT_SEEDS) {
    const result = await db
      .insert(schema.agents)
      .values(agent)
      .onConflictDoUpdate({
        target: schema.agents.name,
        set: {
          type: agent.type,
          provider: agent.provider,
          status: agent.status,
          configJson: agent.configJson ?? {},
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.agents.id });
    if (result.length > 0) inserted++;
  }
  return { inserted };
}
