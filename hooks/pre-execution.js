#!/usr/bin/env node
/**
 * pre-execution hook
 *
 * Fires before Claude Code is invoked.
 * Validates: branch name format, issue has required sections, issue not already claimed,
 *           project is active, risk keywords not present (would auto-route to needs-nishad).
 *
 * Exit codes:
 *   0 = pass
 *   1 = block (generic)
 *   2 = block with needs-nishad
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function blockGeneric(reason) {
  emit({ block: true, reason, suggested_label: 'blocked', needs_owner: false });
  process.exit(1);
}

function blockNeedsOwner(reason) {
  emit({ block: true, reason, suggested_label: 'needs-nishad', needs_owner: true });
  process.exit(2);
}

function pass(warnings = []) {
  if (warnings.length) emit({ block: false, warnings });
  process.exit(0);
}

function loadRiskKeywords(workspacePath) {
  const candidates = [
    path.join(workspacePath, '.claude/plugins/claudegpt-policy/policies/risk-keywords.json'),
    path.join(workspacePath, '.claudegpt/policies/risk-keywords.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8')).keywords || [];
      } catch (_) { /* fall through */ }
    }
  }
  return [];
}

function matchesRiskKeyword(text, keywords) {
  const lower = (text || '').toLowerCase();
  return keywords.find((kw) => lower.includes(kw.toLowerCase()));
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch (e) {
    blockGeneric('pre-execution: invalid stdin JSON');
  }

  const {
    branch,
    issue_number,
    issue_title,
    issue_body,
    branch_prefix,
    workspace_path,
    project_status,
    claim_state,
  } = payload;

  // 1. Project must be active
  if (project_status && project_status !== 'active') {
    blockGeneric(`Project status is "${project_status}" (expected "active").`);
  }

  // 2. Issue must not already be claimed
  if (claim_state === 'claimed_by_other') {
    blockGeneric(`Issue #${issue_number} already claimed by another run.`);
  }

  // 3. Branch name must match prefix
  if (!branch || !branch_prefix) {
    blockGeneric('pre-execution: missing branch or branch_prefix in payload.');
  }
  if (!branch.startsWith(`${branch_prefix}/`)) {
    blockGeneric(`Branch "${branch}" does not match required prefix "${branch_prefix}/".`);
  }

  // 4. Issue body must include required sections
  const requiredSections = ['Objective', 'Scope', 'Out of Scope', 'Acceptance Criteria'];
  const missing = requiredSections.filter(
    (s) => !new RegExp(`^#+\\s+${s}\\b`, 'mi').test(issue_body || ''),
  );
  if (missing.length) {
    blockGeneric(`Issue body missing required sections: ${missing.join(', ')}`);
  }

  // 5. Risk keyword scan -> needs-nishad
  const keywords = loadRiskKeywords(workspace_path || process.cwd());
  const haystack = `${issue_title || ''}\n${issue_body || ''}`;
  const hit = matchesRiskKeyword(haystack, keywords);
  if (hit) {
    blockNeedsOwner(`Risk keyword detected in issue: "${hit}". Owner approval required.`);
  }

  pass();
}

main();
