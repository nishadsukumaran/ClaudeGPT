import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('runner.prompt');

/**
 * Parsed agent definition file (agents/builder.md, agents/rework.md).
 */
export interface AgentDefinition {
  frontmatter: {
    name?: string;
    provider?: string;
    model?: string;
    role?: string;
    max_tokens_per_run?: number;
    max_minutes_per_run?: number;
    temperature?: number;
    [key: string]: unknown;
  };
  body: string;
}

/**
 * Minimal YAML-frontmatter parser. The agent files use a flat key-value subset
 * (strings, numbers, simple lists). We deliberately do not pull in a full YAML
 * dependency — the agent files are authored by us, not user input.
 */
function parseFrontmatter(raw: string): AgentDefinition {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const fmText = match[1] ?? '';
  const body = match[2] ?? '';
  const fm: Record<string, unknown> = {};

  let currentKey: string | null = null;
  const lines = fmText.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const listMatch = line.match(/^\s+-\s*(.+)$/);
    if (listMatch && currentKey) {
      const arr = (fm[currentKey] as unknown[]) ?? [];
      arr.push(listMatch[1]);
      fm[currentKey] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1] ?? '';
      const valueRaw = (kv[2] ?? '').trim();
      currentKey = key;
      if (valueRaw === '') {
        // Either a multiline scalar (not supported) or the start of a list.
        fm[key] = [];
      } else if (/^-?\d+(?:\.\d+)?$/.test(valueRaw)) {
        fm[key] = Number(valueRaw);
      } else if (valueRaw === 'true' || valueRaw === 'false') {
        fm[key] = valueRaw === 'true';
      } else {
        // Strip surrounding quotes if present.
        fm[key] = valueRaw.replace(/^["']|["']$/g, '');
      }
    }
  }

  return { frontmatter: fm as AgentDefinition['frontmatter'], body };
}

/**
 * Load and parse an agent definition file. Path is resolved relative to the
 * orchestrator working tree (process.cwd()), since agent files live in this
 * repo at `agents/`.
 */
export function loadAgentDefinition(relativePath: string): AgentDefinition {
  let abs: string;
  if (process.env.AGENTS_DIR) {
    const stripped = relativePath.replace(/^agents[\\/]/, '');
    abs = path.resolve(process.env.AGENTS_DIR, stripped);
  } else {
    abs = path.resolve(process.cwd(), relativePath);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  return parseFrontmatter(raw);
}

export interface PromptVariables {
  projectName: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  branchName: string;
  issueBody: string;
  /** Optional: for rework, the structured QA feedback object stringified. */
  qaFeedback?: string;
  /** Optional: for rework, the PR number. */
  prNumber?: number;
}

/**
 * Replace `{{var}}` placeholders. Unknown placeholders are left intact (so the
 * agent prompt can use literal braces if it wants).
 */
function template(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (key in vars) return vars[key] ?? '';
    return whole;
  });
}

/**
 * Build the final prompt sent to Claude. The prompt template lives in agents/builder.md
 * (or agents/rework.md) — we use the file body and template in the variables, then
 * append the rendering helper section from docs/07-worker-jobs.md §12.
 */
export function buildPrompt(args: {
  agentFile: string;
  variables: PromptVariables;
}): { prompt: string; agent: AgentDefinition } {
  const agent = loadAgentDefinition(args.agentFile);
  const v = args.variables;
  const stringVars: Record<string, string> = {
    projectName: v.projectName,
    repo: v.repo,
    issueNumber: String(v.issueNumber),
    issueTitle: v.issueTitle,
    branchName: v.branchName,
    issueBody: v.issueBody,
    qaFeedback: v.qaFeedback ?? '',
    prNumber: v.prNumber !== undefined ? String(v.prNumber) : '',
  };

  // The builder/rework markdown files do not themselves carry `{{var}}` slots;
  // they describe behavior. We compose the spec prompt from §12 and append the
  // agent body as the system-style instructions.
  const header =
    `You are Claude Code working under ClaudeGPT.\n\n` +
    `Project: {{projectName}}\n` +
    `Repository: {{repo}}\n` +
    `Issue: #{{issueNumber}} - {{issueTitle}}\n` +
    `Branch: {{branchName}}\n\n` +
    `Read the issue fully. Read CLAUDE.md and .claudegpt/agent-policy.md.\n\n` +
    `Implement only the requested scope.\n` +
    `Do not build out-of-scope features.\n` +
    `Do not modify secrets.\n` +
    `Do not commit .env files.\n` +
    `Do not perform destructive database operations.\n\n` +
    `Acceptance criteria must be satisfied before you stop.\n` +
    `Run lint, typecheck, tests, build before declaring done.\n\n` +
    `When complete, output a structured summary as JSON inside a fenced block:\n` +
    '```json\n' +
    `{\n` +
    `  "summary": "2-4 sentences",\n` +
    `  "files_changed": ["path/one", "path/two"],\n` +
    `  "tests_run": [{"command": "...", "result": "pass|fail"}],\n` +
    `  "known_limitations": ["..."],\n` +
    `  "followup_tasks": ["..."]\n` +
    `}\n` +
    '```\n\n';

  const reworkBlock = v.qaFeedback
    ? `---\nQA FEEDBACK (apply only the items listed here):\n${v.qaFeedback}\n\n`
    : '';

  const tail =
    `---\nAGENT GUIDANCE:\n${agent.body.trim()}\n\n` +
    `---\nISSUE BODY:\n{{issueBody}}\n`;

  const rendered = template(header + reworkBlock + tail, stringVars);
  log.debug({ length: rendered.length, agentFile: args.agentFile }, 'Prompt built');
  return { prompt: rendered, agent };
}
