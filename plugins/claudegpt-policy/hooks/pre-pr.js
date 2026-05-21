#!/usr/bin/env node
/**
 * pre-pr hook
 *
 * Fires before opening (or marking ready) a pull request.
 * Validates: all validation commands succeeded, file/line caps not exceeded,
 *           PR body template populated, branch has commits ahead of base.
 *
 * Exit codes:
 *   0 = pass
 *   1 = block
 */

'use strict';

const fs = require('node:fs');
const { execSync } = require('node:child_process');

function readStdin() { return fs.readFileSync(0, 'utf8'); }
function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function block(reason, owner = false) {
  emit({ block: true, reason, suggested_label: owner ? 'needs-nishad' : 'blocked', needs_owner: owner });
  process.exit(1);
}
function pass(w = []) { if (w.length) emit({ block: false, warnings: w }); process.exit(0); }

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (_) { return null; }
}

const REQUIRED_PR_SECTIONS = [
  'Summary',
  'Files Changed',
  'Tests Run',
  'Known Limitations',
  'Follow-Up Tasks',
  'Agent Notes',
];

function main() {
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { block('pre-pr: invalid stdin JSON'); }

  const cwd = payload.workspace_path || process.cwd();
  const limits = payload.limits || {};
  const validation = payload.validation_results || {};
  const prBody = payload.pr_body || '';
  const baseBranch = payload.default_branch || 'main';

  // 1. Validation chain must be all-pass
  for (const step of ['install', 'lint', 'typecheck', 'test', 'build']) {
    const v = validation[step];
    if (!v || v.status !== 'pass') {
      block(`pre-pr: validation step "${step}" did not pass (status: ${v ? v.status : 'missing'}).`);
    }
  }

  // 2. Branch must have commits ahead of base
  const ahead = safeExec(`git rev-list --count origin/${baseBranch}..HEAD`, cwd);
  if (!ahead || Number(ahead) === 0) {
    block(`pre-pr: branch has no commits ahead of origin/${baseBranch}.`);
  }

  // 3. Diff size caps
  const diffStat = safeExec(`git diff --shortstat origin/${baseBranch}..HEAD`, cwd) || '';
  const filesMatch = diffStat.match(/(\d+) files? changed/);
  const insertMatch = diffStat.match(/(\d+) insertions?/);
  const deleteMatch = diffStat.match(/(\d+) deletions?/);
  const fileCount = filesMatch ? Number(filesMatch[1]) : 0;
  const lineCount = (insertMatch ? Number(insertMatch[1]) : 0) + (deleteMatch ? Number(deleteMatch[1]) : 0);

  if (limits.maxFiles && fileCount > limits.maxFiles) {
    block(`pre-pr: PR touches ${fileCount} files, exceeds limit ${limits.maxFiles}. Owner approval required.`, true);
  }
  if (limits.maxLines && lineCount > limits.maxLines) {
    block(`pre-pr: PR has ${lineCount} line changes, exceeds limit ${limits.maxLines}. Owner approval required.`, true);
  }

  // 4. PR body template check
  const missing = REQUIRED_PR_SECTIONS.filter(
    (s) => !new RegExp(`^#+\\s+${s}\\b`, 'mi').test(prBody),
  );
  if (missing.length) {
    block(`pre-pr: PR body missing required sections: ${missing.join(', ')}`);
  }

  // 5. PR body must include "Closes #N"
  if (!/Closes\s+#\d+/.test(prBody)) {
    block('pre-pr: PR body must include "Closes #<issue_number>" to link the parent issue.');
  }

  pass();
}

main();
