import type { NormalizedEvent } from '@claudegpt/github';
import type { ProjectConfig } from '@claudegpt/project-registry';
import type { ViolationType } from '@claudegpt/shared';
import { getLogger } from '@claudegpt/shared';
import { checkLabel } from './checks/label.js';
import { checkUser } from './checks/user.js';
import { checkFormat } from './checks/format.js';
import { checkRisk } from './checks/risk.js';

const log = getLogger('policy.engine');

export interface PolicyAllow {
  allow: true;
  appliedLabel: string;
  checksPassed: string[];
}

export interface PolicyDeny {
  allow: false;
  reason: string;
  suggestedLabel: string | null;
  needsOwner: boolean;
  violationType: ViolationType;
  details?: Record<string, unknown>;
}

export type PolicyDecision = PolicyAllow | PolicyDeny;

/**
 * Decide whether the orchestrator may act on this event.
 *
 * Order matters — cheap structural checks first, expensive content checks last.
 * On the first failure we return early with the matching violation classification
 * so the router can record it and label the issue accordingly.
 */
export function policyCheck(event: NormalizedEvent, project: ProjectConfig): PolicyDecision {
  const checksPassed: string[] = [];

  // 1. Label must match a recognized trigger.
  const labelRes = checkLabel(event, project);
  if (!labelRes.ok) {
    return {
      allow: false,
      reason: labelRes.appliedLabel
        ? `Label "${labelRes.appliedLabel}" is not a recognized trigger label for project "${project.projectId}".`
        : `No trigger label found on event ${event.eventType}.${event.action ?? ''}.`,
      suggestedLabel: project.labels.blocked,
      needsOwner: false,
      violationType: 'invalid_label',
      details: { applied: labelRes.appliedLabel, expected: labelRes.expectedLabels },
    };
  }
  const appliedLabel = labelRes.appliedLabel ?? project.trustedTriggerLabel;
  checksPassed.push('label_recognized');

  // 2. Sender must be a trusted user.
  const userRes = checkUser(event, project);
  if (!userRes.ok) {
    return {
      allow: false,
      reason: `Sender "${userRes.sender ?? '<unknown>'}" is not in trustedUsers for project "${project.projectId}".`,
      suggestedLabel: project.labels.needsOwner,
      needsOwner: true,
      violationType: 'untrusted_user',
      details: { sender: userRes.sender, trustedUsers: userRes.trustedUsers },
    };
  }
  checksPassed.push('user_trusted');

  // Issue-only checks (format + risk) apply when the event targets an issue.
  // `claude-rework` / `openai-qa` labels live on PRs and skip issue-body validation.
  const isIssueTrigger = event.eventType === 'issues' && appliedLabel === project.trustedTriggerLabel;

  if (isIssueTrigger) {
    // 3. Issue body must include the required section headers.
    const formatRes = checkFormat(event);
    if (!formatRes.ok) {
      return {
        allow: false,
        reason: `Issue body missing required sections: ${formatRes.missingHeaders.join(', ')}.`,
        suggestedLabel: project.labels.blocked,
        needsOwner: false,
        violationType: 'missing_acceptance',
        details: { missingHeaders: formatRes.missingHeaders },
      };
    }
    checksPassed.push('format_valid');

    // 4. Risk keyword scan -> needs-nishad.
    const riskRes = checkRisk(event);
    if (!riskRes.ok) {
      return {
        allow: false,
        reason: `Issue body matched risk keywords: ${riskRes.matches.join(', ')}.`,
        suggestedLabel: project.labels.needsOwner,
        needsOwner: true,
        violationType: 'blocked_task_type',
        details: { matches: riskRes.matches },
      };
    }
    checksPassed.push('risk_clear');
  }

  log.debug({ project: project.projectId, appliedLabel, checksPassed }, 'Policy allow.');
  return { allow: true, appliedLabel, checksPassed };
}
