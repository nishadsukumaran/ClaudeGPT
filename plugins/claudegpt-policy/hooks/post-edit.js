#!/usr/bin/env node
/**
 * post-edit hook
 *
 * Fires after each edit batch.
 * Runs project formatter and linter against changed files (best-effort, non-fatal).
 *
 * Exit codes:
 *   0 = pass
 *   1 = warn (lint emitted warnings)
 *   2 = block (lint errors that should not be ignored)
 */

'use strict';

const fs = require('node:fs');
const { execSync } = require('node:child_process');

function readStdin() { return fs.readFileSync(0, 'utf8'); }
function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function block(reason) { emit({ block: true, reason, suggested_label: 'blocked', needs_owner: false }); process.exit(2); }
function pass(warnings = []) { emit({ block: false, warnings }); process.exit(warnings.length ? 1 : 0); }

function runCmd(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

function main() {
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { block('post-edit: invalid stdin JSON'); }

  const cwd = payload.workspace_path || process.cwd();
  const commands = payload.commands || {};
  const warnings = [];

  // Formatter — non-fatal, best effort
  if (commands.format) {
    const r = runCmd(commands.format, cwd);
    if (!r.ok) warnings.push(`format command failed (non-fatal): ${commands.format}`);
  }

  // Linter — warnings are warnings, errors block only if config says strict
  if (commands.lint) {
    const r = runCmd(commands.lint, cwd);
    if (!r.ok) {
      if (payload.lint_strict) {
        block(`lint failed:\n${r.out.slice(0, 2000)}`);
      } else {
        warnings.push(`lint emitted issues (non-blocking at post-edit; will re-check at pre-pr).`);
      }
    }
  }

  pass(warnings);
}

main();
