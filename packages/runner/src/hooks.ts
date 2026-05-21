import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('runner.hooks');

export type HookName =
  | 'pre-execution'
  | 'pre-edit'
  | 'post-edit'
  | 'pre-commit'
  | 'pre-push'
  | 'pre-pr'
  | 'post-pr';

export interface HookResult {
  pass: boolean;
  exitCode: number;
  reason?: string;
  suggestedLabel?: string;
  needsOwner?: boolean;
  warnings?: string[];
  /** Additional structured data hooks may return (e.g. post-pr followups). */
  raw?: Record<string, unknown>;
}

const HOOK_TIMEOUT_MS = 30_000;

/**
 * Resolve the hook script path. Hook scripts live in this repo at hooks/<name>.js.
 * We use process.cwd() (the orchestrator working tree) — for production this should
 * be made configurable via env if the orchestrator runs from a different CWD.
 */
function resolveHookPath(name: HookName): string {
  const dir = process.env.HOOKS_DIR ?? path.resolve(process.cwd(), 'hooks');
  return path.resolve(dir, `${name}.js`);
}

/**
 * Invoke a hook script and wait for it to exit. Per docs/10 §5:
 *   - stdin: JSON blob with hook context
 *   - stdout: structured JSON ({block, reason, suggested_label, needs_owner, warnings, ...})
 *   - exit 0 = pass, 1 = block, 2 = needs-nishad (pre-execution only)
 *
 * The runner never throws on hook failure — it returns a HookResult so the caller
 * can record the block, label the issue, and exit gracefully.
 */
export async function runHook(args: {
  hook: HookName;
  payload: Record<string, unknown>;
}): Promise<HookResult> {
  const scriptPath = resolveHookPath(args.hook);

  if (!fs.existsSync(scriptPath)) {
    // Missing hook is treated as pass with a warning — hooks are best-effort gates,
    // not a required dependency for the runner to function in dev/test.
    log.warn({ hook: args.hook, scriptPath }, 'Hook script not found; treating as pass');
    return { pass: true, exitCode: 0, warnings: [`hook ${args.hook} not installed`] };
  }

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killedByTimeout = false;

    const child = spawn(process.execPath, [scriptPath], {
      cwd: (args.payload.workspace_path as string) ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, HOOK_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      let parsed: Record<string, unknown> = {};
      if (stdout) {
        // Hooks may emit multiple JSON lines (warnings + final). Take the last well-formed one.
        const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line) continue;
          try {
            parsed = JSON.parse(line);
            break;
          } catch {
            continue;
          }
        }
      }

      if (killedByTimeout) {
        log.warn({ hook: args.hook }, 'Hook timed out');
        resolve({
          pass: false,
          exitCode: -1,
          reason: `hook ${args.hook} timed out after ${HOOK_TIMEOUT_MS}ms`,
          suggestedLabel: 'blocked',
          needsOwner: false,
        });
        return;
      }

      // post-edit returns 1 for warnings — still a pass for orchestration purposes.
      const isWarnExit = args.hook === 'post-edit' && exitCode === 1;
      const isBlock = parsed.block === true || (exitCode !== 0 && !isWarnExit);

      if (isBlock) {
        log.info(
          { hook: args.hook, exitCode, reason: parsed.reason },
          'Hook blocked',
        );
        resolve({
          pass: false,
          exitCode,
          reason: ((parsed.reason as string) ?? stderr) || `hook ${args.hook} exited ${exitCode}`,
          suggestedLabel: (parsed.suggested_label as string) ?? (exitCode === 2 ? 'needs-nishad' : 'blocked'),
          needsOwner: (parsed.needs_owner as boolean) ?? exitCode === 2,
          raw: parsed,
        });
        return;
      }

      resolve({
        pass: true,
        exitCode,
        warnings: (parsed.warnings as string[]) ?? undefined,
        raw: parsed,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      log.error({ hook: args.hook, err }, 'Hook spawn error');
      resolve({
        pass: false,
        exitCode: -1,
        reason: `hook ${args.hook} failed to spawn: ${String(err)}`,
        suggestedLabel: 'blocked',
        needsOwner: false,
      });
    });

    try {
      child.stdin.write(JSON.stringify(args.payload));
      child.stdin.end();
    } catch (err) {
      log.error({ hook: args.hook, err }, 'Failed to write hook stdin');
    }
  });
}
