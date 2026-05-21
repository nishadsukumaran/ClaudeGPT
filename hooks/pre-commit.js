#!/usr/bin/env node
/**
 * pre-commit hook
 *
 * Fires before `git commit`.
 * Validates: no .env files, no path matches in blocked-paths.json, no obvious secrets in diff.
 *
 * Exit codes:
 *   0 = pass
 *   1 = block
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function readStdin() { return fs.readFileSync(0, 'utf8'); }
function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function block(reason, owner = false) {
  emit({ block: true, reason, suggested_label: owner ? 'needs-nishad' : 'blocked', needs_owner: owner });
  process.exit(1);
}
function pass(w = []) { if (w.length) emit({ block: false, warnings: w }); process.exit(0); }

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (_) { return null; }
}

function loadBlockedPaths(workspacePath) {
  const candidates = [
    path.join(workspacePath, '.claude/plugins/claudegpt-policy/policies/blocked-paths.json'),
    path.join(workspacePath, '.claudegpt/policies/blocked-paths.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch (_) {}
    }
  }
  return { patterns: ['.env', '.env.*', '*.pem', '*.key', 'secrets/**'], conditional: {} };
}

function globToRegex(glob) {
  // Tiny glob support: ** -> .*  *  -> [^/]*   . -> \.
  let s = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  s = s.replace(/\*\*/g, '__DOUBLESTAR__');
  s = s.replace(/\*/g, '[^/]*');
  s = s.replace(/__DOUBLESTAR__/g, '.*');
  return new RegExp('^' + s + '$');
}

// Coarse secret patterns. Real implementation should use gitleaks or trufflehog.
const SECRET_PATTERNS = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', re: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/ },
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{36,}\b/ },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9-_]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live key', re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Generic high-entropy assignment', re: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i },
];

function main() {
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { block('pre-commit: invalid stdin JSON'); }

  const cwd = payload.workspace_path || process.cwd();
  const labels = new Set(payload.issue_labels || []);

  // 1. List staged files
  const staged = (safeExec('git diff --cached --name-only', cwd) || '').split('\n').filter(Boolean);
  if (!staged.length) {
    block('pre-commit: nothing staged for commit.');
  }

  // 2. Path blocklist check
  const blocked = loadBlockedPaths(cwd);
  const patterns = (blocked.patterns || []).map(globToRegex);
  for (const file of staged) {
    for (const re of patterns) {
      if (re.test(file)) block(`pre-commit: staged file matches blocked path: ${file}`);
    }
  }

  // 3. Conditional paths — requires label
  for (const [pattern, rule] of Object.entries(blocked.conditional || {})) {
    const re = globToRegex(pattern);
    const matches = staged.filter((f) => re.test(f));
    if (!matches.length) continue;
    if (rule.startsWith('require_label:')) {
      const required = rule.split(':')[1];
      if (!labels.has(required)) {
        block(`pre-commit: files match "${pattern}" but issue lacks required label "${required}".`);
      }
    }
  }

  // 4. Secret scan on staged diff
  const diff = safeExec('git diff --cached', cwd) || '';
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(diff)) block(`pre-commit: potential secret detected (pattern: ${name}). Remove and use environment variables.`);
  }

  pass();
}

main();
