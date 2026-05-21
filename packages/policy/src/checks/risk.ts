import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@claudegpt/shared';
import type { NormalizedEvent } from '@claudegpt/github';

const log = getLogger('policy.risk');

interface RiskKeywordsFile {
  version: number;
  description?: string;
  keywords: string[];
}

let cached: string[] | null = null;
let cachedPath: string | null = null;

/**
 * Resolve the canonical risk-keywords.json path. Defaults to
 * `<repo-root>/plugins/claudegpt-policy/policies/risk-keywords.json` discovered
 * by walking up from cwd. Override via `CLAUDEGPT_RISK_KEYWORDS_PATH` env var.
 */
function resolveDefaultPath(): string {
  const fromEnv = process.env.CLAUDEGPT_RISK_KEYWORDS_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const rel = path.join('plugins', 'claudegpt-policy', 'policies', 'risk-keywords.json');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), rel);
}

/**
 * Load and cache the keyword list from disk. Subsequent calls return the cache
 * unless `forceReload` or a different `filePath` is supplied.
 */
export function loadRiskKeywords(opts?: { filePath?: string; forceReload?: boolean }): string[] {
  const filePath = opts?.filePath ?? resolveDefaultPath();
  if (cached && cachedPath === filePath && !opts?.forceReload) return cached;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as RiskKeywordsFile;
    if (!Array.isArray(parsed.keywords)) {
      log.error({ filePath }, 'risk-keywords.json missing "keywords" array; defaulting to empty.');
      cached = [];
    } else {
      cached = parsed.keywords.map((k) => k.toLowerCase());
    }
    cachedPath = filePath;
    log.info({ filePath, count: cached.length }, 'Risk keywords loaded.');
    return cached;
  } catch (err) {
    log.error({ err, filePath }, 'Failed to load risk-keywords.json; defaulting to empty list.');
    cached = [];
    cachedPath = filePath;
    return cached;
  }
}

export interface RiskCheckResult {
  ok: boolean;
  matches: string[];
}

function getIssueText(event: NormalizedEvent): string {
  const payload = event.raw as { issue?: { title?: string | null; body?: string | null } } | null | undefined;
  const title = payload?.issue?.title ?? '';
  const body = payload?.issue?.body ?? '';
  return `${title}\n${body}`;
}

/**
 * Substring-match the issue title + body against the risk keyword list.
 * Any match flips ok=false and triggers `needs-nishad` upstream.
 */
export function checkRisk(event: NormalizedEvent, opts?: { filePath?: string }): RiskCheckResult {
  const keywords = loadRiskKeywords({ filePath: opts?.filePath });
  const haystack = getIssueText(event).toLowerCase();
  const matches: string[] = [];
  for (const kw of keywords) {
    if (kw && haystack.includes(kw)) matches.push(kw);
  }
  return { ok: matches.length === 0, matches };
}
