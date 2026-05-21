/**
 * Invoke the Claude Code CLI as a subprocess.
 *
 * Auth path: the host machine must have run `claude login` once and be logged in
 * against the operator's Claude Max (or Pro) subscription. No API key required.
 *
 * Why subprocess instead of @anthropic-ai/sdk: the SDK is API-key billed only,
 * which would bypass the subscription tier the operator already pays for. The
 * Claude Code CLI authenticates against the same OAuth credentials the desktop
 * app uses, so Max plan usage is honored.
 */

import { spawn } from 'node:child_process';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('runner.claude');

export interface ClaudeStructuredResult {
  summary: string;
  files_changed: string[];
  tests_run: Array<{ command: string; result: 'pass' | 'fail' | string }>;
  known_limitations: string[];
  followup_tasks: string[];
}

export interface ClaudeInvocationOptions {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  cwd?: string;
  extraArgs?: string[];
}

export interface ClaudeInvocationResult {
  rawText: string;
  structured: ClaudeStructuredResult | null;
  tokenUsage: number;
  model: string;
  exitCode: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? 'claude';

export async function invokeClaude(opts: ClaudeInvocationOptions): Promise<ClaudeInvocationResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = opts.cwd ?? process.cwd();

  const args = [
    '--print',
    '--output-format=json',
    `--model=${model}`,
    '--dangerously-skip-permissions',
    ...(opts.extraArgs ?? []),
  ];

  log.info({ bin: CLAUDE_BIN, model, cwd, promptLength: opts.prompt.length }, 'Spawning claude CLI');

  return new Promise<ClaudeInvocationResult>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // IS_SANDBOX=1 lets the CLI accept --dangerously-skip-permissions
      // when running as root (which is the case inside our container).
      env: { ...process.env, IS_SANDBOX: '1' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      log.warn({ timeoutMs }, 'Claude CLI exceeded wall-clock budget; killing.');
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 10_000);
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(
        `Failed to spawn '${CLAUDE_BIN}': ${err.message}. ` +
        `Is Claude Code CLI installed and on PATH? Run 'claude login' first.`,
      ));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        log.error({ exitCode, stderr: stderr.slice(0, 1000) }, 'Claude CLI exited non-zero');
        reject(new Error(`Claude CLI exited ${exitCode}: ${stderr.slice(0, 500)}`));
        return;
      }

      let rawText = stdout;
      let tokenUsage = 0;
      try {
        const wrapper = JSON.parse(stdout);
        if (typeof wrapper === 'object' && wrapper !== null) {
          if (typeof wrapper.result === 'string') rawText = wrapper.result;
          else if (typeof wrapper.text === 'string') rawText = wrapper.text;
          else if (typeof wrapper.message === 'string') rawText = wrapper.message;
          if (typeof wrapper.usage?.input_tokens === 'number') tokenUsage += wrapper.usage.input_tokens;
          if (typeof wrapper.usage?.output_tokens === 'number') tokenUsage += wrapper.usage.output_tokens;
        }
      } catch {
        // CLI didn't return JSON; treat stdout as raw text.
      }

      const structured = extractStructured(rawText);
      log.info(
        { exitCode, tokenUsage, structuredOk: structured !== null, rawTextLength: rawText.length },
        'Claude CLI invocation complete',
      );

      resolve({
        rawText: rawText.trim(),
        structured,
        tokenUsage,
        model,
        exitCode,
      });
    });

    child.stdin.write(opts.prompt);
    child.stdin.end();
  });
}

function extractStructured(text: string): ClaudeStructuredResult | null {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    const raw = fences[i]?.[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as ClaudeStructuredResult;
      if (typeof parsed.summary !== 'string') continue;
      parsed.files_changed = Array.isArray(parsed.files_changed) ? parsed.files_changed : [];
      parsed.tests_run = Array.isArray(parsed.tests_run) ? parsed.tests_run : [];
      parsed.known_limitations = Array.isArray(parsed.known_limitations) ? parsed.known_limitations : [];
      parsed.followup_tasks = Array.isArray(parsed.followup_tasks) ? parsed.followup_tasks : [];
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}
