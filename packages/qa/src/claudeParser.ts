/**
 * Use Claude (via the runner's CLI subprocess wrapper) to convert ChatGPT's
 * prose PR review into a structured QA verdict matching agents/reviewer.md.
 *
 * This is the bridge between "human-style review comment" and our existing
 * deterministic label/status machinery.
 *
 * Auth path: piggybacks on the Claude Code CLI (`claude` binary) already
 * configured for the builder. No extra credentials needed.
 */

import { getLogger } from '@claudegpt/shared';
import { invokeClaude } from '@claudegpt/runner';
import { parseQaResponse, type QaVerdict } from './parseResponse.js';

const log = getLogger('qa.claudeParser');

const PARSER_PROMPT = `You are a strict format converter. The user message contains a code-review
comment posted by ChatGPT's GitHub App on a pull request. Your job: read that
review and emit a single JSON object representing the verdict.

Exact shape required (no surrounding prose, no markdown fences):

{
  "result": "pass" | "fail",
  "summary": "string, 2-4 sentences capturing the reviewer's overall stance",
  "critical_issues": [{ "file": "path/to/file.ts", "line": 12, "issue": "description" }],
  "non_blocking_suggestions": ["string"],
  "security_concerns": ["string"],
  "missing_tests": ["string"],
  "scope_violations": ["string"]
}

Decision rules:
- If the reviewer requested specific code changes, blocked the merge, or flagged
  bugs/regressions/security holes -> result = "fail" and populate critical_issues.
- If the reviewer was broadly positive ("LGTM", "approved", "looks good") with at
  most nit-level suggestions -> result = "pass" and put nits in non_blocking_suggestions.
- When in doubt, fail. False-positive pass is worse than false-positive fail.

Output ONLY the JSON object. No fences, no explanation, no preamble.`;

export async function parseChatGptReview(reviewBody: string): Promise<QaVerdict> {
  const fullPrompt = `${PARSER_PROMPT}\n\n---\n\nREVIEW COMMENT:\n\n${reviewBody}`;

  log.info({ reviewLength: reviewBody.length }, 'Invoking Claude to parse ChatGPT review');

  const result = await invokeClaude({
    prompt: fullPrompt,
    // Short cap — this is a parse, not a build.
    timeoutMs: 90_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Claude parser CLI exited ${result.exitCode}`);
  }

  // parseQaResponse handles fence-stripping, JSON parsing, zod validation,
  // and the pass-without-critical-issues sanity check.
  const verdict = parseQaResponse(result.rawText);
  log.info(
    { verdict: verdict.result, criticalCount: verdict.critical_issues.length },
    'ChatGPT review parsed into structured verdict',
  );
  return verdict;
}
