import { getDb, schema } from '@claudegpt/db';
import { getLogger } from '@claudegpt/shared';
import type { ViolationType } from '@claudegpt/shared';

const log = getLogger('policy.violations');

export interface RecordViolationInput {
  projectId?: string | null;
  repo: string;
  issueNumber?: number | null;
  prNumber?: number | null;
  violationType: ViolationType;
  reason: string;
  payload?: Record<string, unknown>;
}

/**
 * Insert a row into `policy_violations`. Logs and swallows DB errors so a
 * violation-record failure cannot itself break the routing pipeline.
 */
export async function recordViolation(input: RecordViolationInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(schema.policyViolations).values({
      projectId: input.projectId ?? null,
      repo: input.repo,
      issueNumber: input.issueNumber ?? null,
      prNumber: input.prNumber ?? null,
      violationType: input.violationType,
      reason: input.reason,
      payloadJson: input.payload ?? {},
    });
  } catch (err) {
    log.error({ err, input }, 'Failed to record policy violation.');
  }
}
