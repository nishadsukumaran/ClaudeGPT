import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('qa.prompt');

/**
 * Variables that get templated into the reviewer.md body.
 * Names match docs/07-worker-jobs.md §12.
 */
export interface PromptVars {
  projectName: string;
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prTitle: string;
  issueBody: string;
  prDiff: string;
  agentPolicy: string;
}

const REVIEWER_DOC_REL_PATH = 'agents/reviewer.md';

/**
 * Walk upwards from the current module looking for the repo root marker
 * (presence of the agents/ directory). This lets the package work both
 * when installed from source (workspace) and when bundled — tests can
 * also override by setting CLAUDEGPT_REPO_ROOT.
 */
function findRepoRoot(): string {
  const override = process.env.CLAUDEGPT_REPO_ROOT;
  if (override && fs.existsSync(path.join(override, REVIEWER_DOC_REL_PATH))) return override;

  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  // Walk up at most 8 levels to find the agents/ dir.
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, REVIEWER_DOC_REL_PATH))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to cwd — tests stub via env var.
  return process.cwd();
}

let cachedReviewerBody: string | null = null;

/**
 * Load the reviewer.md body (strips front-matter). Cached for the process.
 */
export function loadReviewerBody(): string {
  if (cachedReviewerBody) return cachedReviewerBody;
  const root = findRepoRoot();
  const reviewerPath = path.join(root, REVIEWER_DOC_REL_PATH);
  if (!fs.existsSync(reviewerPath)) {
    throw new Error(`reviewer.md not found at ${reviewerPath}; cannot build QA prompt.`);
  }
  const raw = fs.readFileSync(reviewerPath, 'utf8');
  // Strip optional YAML front-matter delimited by lines of '---'.
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  cachedReviewerBody = body.trim();
  log.debug({ reviewerPath, bytes: cachedReviewerBody.length }, 'Reviewer body loaded');
  return cachedReviewerBody;
}

/** For tests: re-read the file on next call. */
export function resetReviewerCache(): void {
  cachedReviewerBody = null;
}

/**
 * Build the full QA prompt. The reviewer.md body already instructs the model
 * to return JSON only — we append the templated context block below it.
 */
export function buildQaPrompt(vars: PromptVars): string {
  const reviewerBody = loadReviewerBody();
  const contextBlock = [
    '---',
    'CONTEXT',
    `Project: ${vars.projectName}`,
    `Issue: #${vars.issueNumber} - ${vars.issueTitle}`,
    `PR: #${vars.prNumber} - ${vars.prTitle}`,
    '',
    '---',
    'ISSUE BODY:',
    vars.issueBody || '(empty)',
    '',
    '---',
    'PR DIFF:',
    vars.prDiff || '(empty)',
    '',
    '---',
    'AGENT POLICY:',
    vars.agentPolicy || '(agent policy not present in repo)',
    '',
    '---',
    'Return ONLY the JSON object specified in the Output format section above. No prose, no markdown fences.',
  ].join('\n');

  // Template tokens (kept for parity with docs/07 §12 wording, even though we also build the structured block above).
  const headerTemplated = reviewerBody
    .replace(/\{\{projectName\}\}/g, vars.projectName)
    .replace(/\{\{issueNumber\}\}/g, String(vars.issueNumber))
    .replace(/\{\{issueTitle\}\}/g, vars.issueTitle)
    .replace(/\{\{prNumber\}\}/g, String(vars.prNumber))
    .replace(/\{\{prTitle\}\}/g, vars.prTitle)
    .replace(/\{\{issueBody\}\}/g, vars.issueBody || '(empty)')
    .replace(/\{\{prDiff\}\}/g, vars.prDiff || '(empty)')
    .replace(/\{\{agentPolicy\}\}/g, vars.agentPolicy || '(agent policy not present in repo)');

  return `${headerTemplated}\n\n${contextBlock}\n`;
}
