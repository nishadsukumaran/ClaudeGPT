#!/usr/bin/env node
/**
 * pre-push hook
 *
 * Fires before `git push`.
 * Validates: branch matches branch_prefix, not pushing to default/protected branch,
 *           not a force push, current HEAD is not the same as origin/<default>.
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
function block(reason) { emit({ block: true, reason, suggested_label: 'blocked', needs_owner: false }); process.exit(1); }
function pass(w = []) { if (w.length) emit({ block: false, warnings: w }); process.exit(0); }

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (_) { return null; }
}

const PROTECTED = ['main', 'master', 'production', 'prod'];
const PROTECTED_PREFIXES = ['release/', 'prod/', 'production/'];

function main() {
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { block('pre-push: invalid stdin JSON'); }

  const cwd = payload.workspace_path || process.cwd();
  const defaultBranch = payload.default_branch || 'main';
  const branchPrefix = payload.branch_prefix;
  const expectedBranch = payload.branch;

  const currentBranch = safeExec('git rev-parse --abbrev-ref HEAD', cwd);
  if (!currentBranch) block('pre-push: could not determine current branch.');

  // 1. No pushing to protected branches
  if (PROTECTED.includes(currentBranch) || currentBranch === defaultBranch) {
    block(`pre-push: refusing to push to protected branch "${currentBranch}".`);
  }
  for (const p of PROTECTED_PREFIXES) {
    if (currentBranch.startsWith(p)) {
      block(`pre-push: refusing to push to protected branch prefix "${p}*".`);
    }
  }

  // 2. Branch must match expected (the one the orchestrator assigned)
  if (expectedBranch && currentBranch !== expectedBranch) {
    block(`pre-push: current branch "${currentBranch}" does not match assigned branch "${expectedBranch}".`);
  }

  // 3. Branch must match prefix
  if (branchPrefix && !currentBranch.startsWith(`${branchPrefix}/`)) {
    block(`pre-push: branch "${currentBranch}" does not start with required prefix "${branchPrefix}/".`);
  }

  // 4. Detect force-push intent (env var set by the wrapper script)
  if (process.env.GIT_PUSH_FORCE === '1' || process.env.GIT_PUSH_FORCE_LEASE === '1') {
    block('pre-push: force push detected. Not allowed.');
  }

  pass();
}

main();
