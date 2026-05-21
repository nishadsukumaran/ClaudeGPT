import { addLabels, removeLabel, commentOnIssue } from '@claudegpt/github';
import { getLogger } from '@claudegpt/shared';
import type { QaVerdict } from './parseResponse.js';

const log = getLogger('qa.applyVerdict');

/**
 * Standard labels written by QA. These names match the strategy in
 * docs/00-architecture.md §6.
 */
export const QA_LABELS = {
  approved: 'openai-approved',
  changesRequested: 'openai-changes-requested',
  rework: 'claude-rework',
} as const;

function renderPassComment(verdict: QaVerdict): string {
  const lines: string[] = [];
  lines.push('## OpenAI QA: passed');
  lines.push('');
  lines.push(verdict.summary);
  if (verdict.non_blocking_suggestions.length > 0) {
    lines.push('');
    lines.push('### Non-blocking suggestions');
    for (const s of verdict.non_blocking_suggestions) lines.push(`- ${s}`);
  }
  return lines.join('\n');
}

function renderFailComment(verdict: QaVerdict): string {
  const lines: string[] = [];
  lines.push('## OpenAI QA: changes requested');
  lines.push('');
  lines.push(verdict.summary);

  if (verdict.critical_issues.length > 0) {
    lines.push('');
    lines.push('### Critical issues');
    for (const ci of verdict.critical_issues) {
      const loc = ci.line != null ? `${ci.file}:${ci.line}` : ci.file;
      lines.push(`- **${loc}** — ${ci.issue}`);
    }
  }
  if (verdict.scope_violations.length > 0) {
    lines.push('');
    lines.push('### Scope violations');
    for (const s of verdict.scope_violations) lines.push(`- ${s}`);
  }
  if (verdict.security_concerns.length > 0) {
    lines.push('');
    lines.push('### Security concerns');
    for (const s of verdict.security_concerns) lines.push(`- ${s}`);
  }
  if (verdict.missing_tests.length > 0) {
    lines.push('');
    lines.push('### Missing tests');
    for (const s of verdict.missing_tests) lines.push(`- ${s}`);
  }
  if (verdict.non_blocking_suggestions.length > 0) {
    lines.push('');
    lines.push('### Non-blocking suggestions');
    for (const s of verdict.non_blocking_suggestions) lines.push(`- ${s}`);
  }
  lines.push('');
  lines.push('_This PR has been labelled `claude-rework`. The builder agent will be re-invoked to address the items above._');
  return lines.join('\n');
}

/**
 * Render the comment body for a given verdict. Exported for tests and previews.
 */
export function renderVerdictComment(verdict: QaVerdict): string {
  return verdict.result === 'pass' ? renderPassComment(verdict) : renderFailComment(verdict);
}

/**
 * Apply the verdict to the PR:
 *   pass  -> add `openai-approved`, remove `claude-rework` if present, post summary comment.
 *   fail  -> add `openai-changes-requested` + `claude-rework`, remove `openai-approved`, post full feedback.
 *
 * Comments first so the discussion has the body before label-driven workflows kick off.
 */
export async function applyVerdict(
  repo: string,
  prNumber: number,
  verdict: QaVerdict,
): Promise<void> {
  const body = renderVerdictComment(verdict);
  await commentOnIssue(repo, prNumber, body);
  log.info({ repo, prNumber, result: verdict.result }, 'QA comment posted');

  if (verdict.result === 'pass') {
    await addLabels(repo, prNumber, [QA_LABELS.approved]);
    await removeLabel(repo, prNumber, QA_LABELS.rework);
    await removeLabel(repo, prNumber, QA_LABELS.changesRequested);
  } else {
    await addLabels(repo, prNumber, [QA_LABELS.changesRequested, QA_LABELS.rework]);
    await removeLabel(repo, prNumber, QA_LABELS.approved);
  }
  log.info({ repo, prNumber, result: verdict.result }, 'QA labels applied');
}
