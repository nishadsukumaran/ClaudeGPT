import { spawn } from 'node:child_process';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('runner.validate');

export type ValidationStep = 'install' | 'lint' | 'typecheck' | 'test' | 'build';
export type ValidationStatus = 'pass' | 'fail' | 'skipped';

export interface ValidationStepResult {
  status: ValidationStatus;
  exitCode: number | null;
  command: string;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}

export type ValidationResults = Record<ValidationStep, ValidationStepResult>;

export interface ProjectCommands {
  install?: string;
  lint: string;
  typecheck: string;
  test: string;
  build: string;
  format?: string;
}

/**
 * Run one shell command. Returns the result; never throws.
 * stdout/stderr are buffered with a tail cap to keep run_logs small.
 */
export function runCommand(args: {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ValidationStepResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let killedByTimeout = false;

    // Use shell so multi-token commands like "pnpm run lint" work without splitting manually.
    const child = spawn(args.command, {
      cwd: args.cwd,
      shell: true,
      env: { ...process.env, ...(args.env ?? {}) },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const MAX_TAIL = 4_000;

    const appendCapped = (sink: Buffer[], chunk: Buffer) => {
      sink.push(chunk);
      let total = sink.reduce((n, b) => n + b.length, 0);
      while (total > MAX_TAIL * 4 && sink.length > 1) {
        const removed = sink.shift();
        if (removed) total -= removed.length;
      }
    };

    child.stdout?.on('data', (c: Buffer) => appendCapped(stdoutChunks, c));
    child.stderr?.on('data', (c: Buffer) => appendCapped(stderrChunks, c));

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, args.timeoutMs);
    timer.unref();

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdoutTail = Buffer.concat(stdoutChunks).toString('utf8').slice(-MAX_TAIL);
      const stderrTail = Buffer.concat(stderrChunks).toString('utf8').slice(-MAX_TAIL);
      const exitCode = killedByTimeout ? null : code;
      const status: ValidationStatus = exitCode === 0 ? 'pass' : 'fail';
      resolve({
        status,
        exitCode,
        command: args.command,
        stdoutTail,
        stderrTail,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        status: 'fail',
        exitCode: null,
        command: args.command,
        stdoutTail: '',
        stderrTail: String(err),
        durationMs: Date.now() - start,
      });
    });
  });
}

const SKIPPED: ValidationStepResult = {
  status: 'skipped',
  exitCode: null,
  command: '',
  stdoutTail: '',
  stderrTail: '',
  durationMs: 0,
};

/**
 * Run the full agent-policy validation chain in the order required by
 * docs/02-agent-policy.md §6: install -> lint -> typecheck -> test -> build.
 *
 * Stops at the first failure to avoid running expensive steps after an early break,
 * but always returns a full record so the caller can log every slot.
 */
export async function runValidationChain(args: {
  cwd: string;
  commands: ProjectCommands;
  stepTimeoutMs?: number;
}): Promise<ValidationResults> {
  const stepTimeoutMs = args.stepTimeoutMs ?? 10 * 60 * 1000;
  const results: ValidationResults = {
    install: SKIPPED,
    lint: SKIPPED,
    typecheck: SKIPPED,
    test: SKIPPED,
    build: SKIPPED,
  };

  const sequence: Array<{ step: ValidationStep; cmd?: string }> = [
    { step: 'install', cmd: args.commands.install },
    { step: 'lint', cmd: args.commands.lint },
    { step: 'typecheck', cmd: args.commands.typecheck },
    { step: 'test', cmd: args.commands.test },
    { step: 'build', cmd: args.commands.build },
  ];

  for (const { step, cmd } of sequence) {
    if (!cmd) {
      log.debug({ step }, 'No command configured; skipping');
      continue;
    }
    log.info({ step, cmd }, 'Running validation step');
    const r = await runCommand({ command: cmd, cwd: args.cwd, timeoutMs: stepTimeoutMs });
    results[step] = r;
    if (r.status !== 'pass') {
      log.warn({ step, exitCode: r.exitCode }, 'Validation step failed; halting chain');
      break;
    }
  }

  return results;
}

/**
 * Helper for hook payloads: collapse the validation record to the shape pre-pr.js expects.
 */
export function toHookValidationShape(
  results: ValidationResults,
): Record<ValidationStep, { status: ValidationStatus }> {
  return {
    install: { status: results.install.status },
    lint: { status: results.lint.status },
    typecheck: { status: results.typecheck.status },
    test: { status: results.test.status },
    build: { status: results.build.status },
  };
}

export function allValidationPassed(results: ValidationResults): boolean {
  return (['install', 'lint', 'typecheck', 'test', 'build'] as ValidationStep[]).every(
    (s) => results[s].status === 'pass' || results[s].status === 'skipped',
  );
}
