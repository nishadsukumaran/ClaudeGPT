import type { NormalizedEvent } from '@claudegpt/github';

/**
 * Required section headers in a claude-ready issue body. See docs/00-architecture.md §7.
 * We require these four headers (markdown `## Header` lines) before allowing a build.
 */
export const REQUIRED_HEADERS = ['Objective', 'Scope', 'Out of Scope', 'Acceptance Criteria'] as const;

export interface FormatCheckResult {
  ok: boolean;
  missingHeaders: string[];
}

function getIssueBody(event: NormalizedEvent): string {
  const payload = event.raw as { issue?: { body?: string | null } } | null | undefined;
  return payload?.issue?.body ?? '';
}

/**
 * Verify the issue body has the four required section headers. Headers can be
 * `#`, `##`, `###`, or `####`. Match is case-insensitive on the header text.
 */
export function checkFormat(event: NormalizedEvent): FormatCheckResult {
  const body = getIssueBody(event);
  if (!body || body.trim().length === 0) {
    return { ok: false, missingHeaders: [...REQUIRED_HEADERS] };
  }

  const missing: string[] = [];
  for (const header of REQUIRED_HEADERS) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s{0,3}#{1,4}\\s+${escaped}\\b`, 'mi');
    if (!pattern.test(body)) missing.push(header);
  }

  return { ok: missing.length === 0, missingHeaders: missing };
}
