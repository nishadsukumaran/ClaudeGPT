import { z } from 'zod';

/**
 * Zod schema for the reviewer JSON output. Shape mirrors agents/reviewer.md
 * §"Output format" exactly. Any deviation fails validation.
 */
export const criticalIssueSchema = z.object({
  file: z.string().min(1),
  // The reviewer may omit `line` if it cannot pinpoint one. We accept null / undefined / number.
  line: z.union([z.number().int(), z.null()]).optional(),
  issue: z.string().min(1),
});

export const qaVerdictSchema = z.object({
  result: z.enum(['pass', 'fail']),
  summary: z.string().min(1),
  critical_issues: z.array(criticalIssueSchema).default([]),
  non_blocking_suggestions: z.array(z.string()).default([]),
  security_concerns: z.array(z.string()).default([]),
  missing_tests: z.array(z.string()).default([]),
  scope_violations: z.array(z.string()).default([]),
});

export type CriticalIssue = z.infer<typeof criticalIssueSchema>;
export type QaVerdict = z.infer<typeof qaVerdictSchema>;

/**
 * Strip surrounding code fences (```json ... ```) and leading/trailing prose
 * before JSON.parse. Defensive — we instruct the model to return JSON only,
 * but in practice models occasionally wrap in fences.
 */
function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence && fence[1]) return fence[1].trim();
  // Take the first { ... } object if there is leading/trailing prose.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export class QaParseError extends Error {
  public readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = 'QaParseError';
    this.raw = raw;
  }
}

/**
 * Parse and validate a raw model response. Returns the typed verdict or throws
 * QaParseError with the raw payload attached so callers can log it.
 *
 * Also enforces the decision rules from agents/reviewer.md §"Decision rules":
 * if critical_issues / scope_violations / security_concerns is non-empty then
 * result must be "fail". We do NOT mutate — we throw, because that's a
 * contract violation by the model and we want the caller to know.
 */
export function parseQaResponse(raw: string): QaVerdict {
  if (!raw || raw.trim().length === 0) {
    throw new QaParseError('Empty response from QA model', raw);
  }
  const jsonText = extractJsonBlock(raw);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (err) {
    throw new QaParseError(`QA response is not valid JSON: ${(err as Error).message}`, raw);
  }
  const result = qaVerdictSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new QaParseError(`QA response failed schema validation: ${issues}`, raw);
  }
  const verdict = result.data;

  // Reviewer-decision-rule sanity check.
  if (
    verdict.result === 'pass' &&
    (verdict.critical_issues.length > 0 || verdict.scope_violations.length > 0)
  ) {
    throw new QaParseError(
      'QA verdict says "pass" but has critical_issues or scope_violations; contract violation.',
      raw,
    );
  }

  return verdict;
}
