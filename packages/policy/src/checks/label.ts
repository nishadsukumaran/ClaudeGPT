import type { NormalizedEvent } from '@claudegpt/github';
import type { ProjectConfig } from '@claudegpt/project-registry';

/**
 * Determine which label triggered this event. For `*.labeled` actions, GitHub
 * sends a `label` object on the payload; that is the applied label. Fall back
 * to scanning `event.labels` if the payload shape is unexpected.
 */
export function extractTriggerLabel(event: NormalizedEvent): string | null {
  const payload = event.raw as { label?: { name?: string } } | null | undefined;
  const applied = payload?.label?.name;
  if (applied && typeof applied === 'string') return applied;
  return null;
}

export interface LabelCheckResult {
  ok: boolean;
  appliedLabel: string | null;
  expectedLabels: string[];
}

/**
 * Verify the applied label is one of the project's recognized trigger labels.
 * Returns ok=true when the label matches `trustedTriggerLabel`, `labels.rework`,
 * or `labels.qa` (the three labels that legitimately spawn agent jobs).
 */
export function checkLabel(event: NormalizedEvent, project: ProjectConfig): LabelCheckResult {
  const applied = extractTriggerLabel(event);
  const expected = [
    project.trustedTriggerLabel,
    project.labels.rework,
    project.labels.qa,
  ];
  return {
    ok: applied !== null && expected.includes(applied),
    appliedLabel: applied,
    expectedLabels: expected,
  };
}
