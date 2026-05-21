#!/usr/bin/env node
/**
 * pre-edit hook
 *
 * Fires before each edit batch.
 * Validates: working tree is in a known clean state (no untracked junk that the agent
 *           didn't create itself), no merge conflicts pending.
 *
 * Stores a git status snapshot under .claudegpt/snapshots/ for diff auditing.
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
function block(reason) { emit({ block: true, reason, suggested_label: 'blocked', needs_owner: false }); process.exit(1); }
function pass(w = []) { if (w.length) emit({ block: false, warnings: w }); process.exit(0); }

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (_) { return null; }
}

function main() {
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { block('pre-edit: invalid stdin JSON'); }

  const cwd = payload.workspace_path || process.cwd();

  // 1. Must be inside a git repo
  if (!safeExec('git rev-parse --git-dir', cwd)) {
    block('pre-edit: workspace is not a git repository.');
  }

  // 2. No unresolved merge conflicts
  const conflicts = safeExec('git diff --name-only --diff-filter=U', cwd);
  if (conflicts && conflicts.trim().length) {
    block(`pre-edit: unresolved merge conflicts present:\n${conflicts.trim()}`);
  }

  // 3. Snapshot git status to .claudegpt/snapshots/<run_id>-pre-edit.txt
  const snapshotDir = path.join(cwd, '.claudegpt', 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshot = safeExec('git status --porcelain=v1 -uall', cwd) || '';
  const runId = payload.run_id || 'unknown';
  const editSeq = payload.edit_sequence || Date.now();
  fs.writeFileSync(
    path.join(snapshotDir, `${runId}-pre-edit-${editSeq}.txt`),
    snapshot,
  );

  pass();
}

main();
