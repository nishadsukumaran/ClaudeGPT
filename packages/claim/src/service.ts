import { getDb, schema } from '@claudegpt/db';
import { getLogger } from '@claudegpt/shared';
import { and, eq, isNull } from 'drizzle-orm';

const log = getLogger('claim.service');

export interface ClaimSuccess {
  claimed: true;
  claimId: string;
}

export interface ClaimFailure {
  claimed: false;
  reason: 'already_claimed' | 'error';
  existingJobId?: string;
}

export type ClaimResult = ClaimSuccess | ClaimFailure;

/**
 * Postgres unique-violation SQLSTATE. We use this to convert a duplicate-key
 * error from the `uniq_claims_repo_issue` constraint into a clean `already_claimed`
 * result rather than propagating the raw DB error.
 */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === PG_UNIQUE_VIOLATION;
}

/**
 * Attempt to claim a task for a (repo, issueNumber) pair. The DB enforces the
 * one-claim-per-issue invariant via `uniq_claims_repo_issue`. A duplicate-key
 * error means another job already holds the claim.
 *
 * Note: the unique constraint is on (repo, issue_number) — it does not include
 * `released_at`. So if a previous claim was released, the row still occupies
 * the unique slot. Callers should `releaseTask` to free the slot first, or we
 * delete the released row inline before retrying. We choose the latter here
 * to keep the public API ergonomic.
 */
export async function claimTask(
  repo: string,
  issueNumber: number,
  jobId: string,
): Promise<ClaimResult> {
  const db = getDb();

  try {
    const [row] = await db
      .insert(schema.taskClaims)
      .values({ repo, issueNumber, jobId })
      .returning({ id: schema.taskClaims.id });
    log.info({ repo, issueNumber, jobId, claimId: row?.id }, 'Task claimed.');
    return { claimed: true, claimId: row?.id ?? '' };
  } catch (err) {
    if (!isUniqueViolation(err)) {
      log.error({ err, repo, issueNumber, jobId }, 'Unexpected error during claim insert.');
      return { claimed: false, reason: 'error' };
    }

    // Inspect the existing row. If it's already released, recycle the slot.
    const existing = await db
      .select({ id: schema.taskClaims.id, jobId: schema.taskClaims.jobId, releasedAt: schema.taskClaims.releasedAt })
      .from(schema.taskClaims)
      .where(and(eq(schema.taskClaims.repo, repo), eq(schema.taskClaims.issueNumber, issueNumber)))
      .limit(1);

    const prior = existing[0];
    if (prior && prior.releasedAt !== null) {
      await db.delete(schema.taskClaims).where(eq(schema.taskClaims.id, prior.id));
      try {
        const [row] = await db
          .insert(schema.taskClaims)
          .values({ repo, issueNumber, jobId })
          .returning({ id: schema.taskClaims.id });
        log.info({ repo, issueNumber, jobId, claimId: row?.id }, 'Task re-claimed after release.');
        return { claimed: true, claimId: row?.id ?? '' };
      } catch (retryErr) {
        log.error({ err: retryErr, repo, issueNumber }, 'Re-claim after release failed.');
        return { claimed: false, reason: 'error' };
      }
    }

    log.warn(
      { repo, issueNumber, existingJobId: prior?.jobId },
      'Task already claimed; new claim rejected.',
    );
    return { claimed: false, reason: 'already_claimed', existingJobId: prior?.jobId };
  }
}

export interface ReleaseResult {
  released: boolean;
}

/**
 * Mark the active claim for (repo, issueNumber) as released. No-op if no
 * unreleased claim exists.
 */
export async function releaseTask(repo: string, issueNumber: number): Promise<ReleaseResult> {
  const db = getDb();
  const updated = await db
    .update(schema.taskClaims)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(schema.taskClaims.repo, repo),
        eq(schema.taskClaims.issueNumber, issueNumber),
        isNull(schema.taskClaims.releasedAt),
      ),
    )
    .returning({ id: schema.taskClaims.id });

  if (updated.length === 0) {
    return { released: false };
  }
  log.info({ repo, issueNumber, claimId: updated[0]?.id }, 'Task released.');
  return { released: true };
}
