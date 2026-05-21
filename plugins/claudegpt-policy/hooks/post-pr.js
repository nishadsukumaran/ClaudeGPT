#!/usr/bin/env node
/**
 * post-pr hook
 *
 * Fires after the PR is opened (or marked ready).
 * Writes a structured log entry, lets the orchestrator surface the PR link on the issue
 * and trigger the ClickUp sync follow-up job.
 *
 * This hook is informational and should never block.
 *
 * Exit code: always 0.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readStdin() { return fs.readFileSync(0, 'utf8'); }
function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

function main() {
  let payload;
  try { payload = JSON.parse(readStdin()); }
  catch {
    // Even on bad JSON, do not block.
    emit({ block: false, warnings: ['post-pr: invalid stdin JSON; continuing.'] });
    process.exit(0);
  }

  const cwd = payload.workspace_path || process.cwd();
  const logDir = path.join(cwd, '.claudegpt');
  fs.mkdirSync(logDir, { recursive: true });

  const entry = {
    ts: new Date().toISOString(),
    hook: 'post-pr',
    run_id: payload.run_id,
    pr_number: payload.pr_number,
    pr_url: payload.pr_url,
    branch: payload.branch,
    issue_number: payload.issue_number,
    files_changed: payload.diff_stats ? payload.diff_stats.files : null,
    lines_added: payload.diff_stats ? payload.diff_stats.additions : null,
    lines_deleted: payload.diff_stats ? payload.diff_stats.deletions : null,
  };
  fs.appendFileSync(path.join(logDir, 'hook-log.jsonl'), JSON.stringify(entry) + '\n');

  // Hand follow-up actions to the orchestrator via structured output.
  emit({
    block: false,
    followups: [
      { action: 'comment_issue', issue: payload.issue_number, body: `PR opened: ${payload.pr_url}` },
      { action: 'enqueue_job', type: 'clickup_sync', payload: { pr_number: payload.pr_number, issue_number: payload.issue_number, new_status: 'qa' } },
    ],
  });
  process.exit(0);
}

main();
