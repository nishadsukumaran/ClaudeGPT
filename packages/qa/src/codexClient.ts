/**
 * @deprecated The QA reviewer no longer calls Codex CLI directly.
 *
 * The current pattern listens for ChatGPT GitHub App reviews and parses them
 * via Claude. See processInboundReview.ts and claudeParser.ts.
 *
 * This file persists only because the workspace tooling cannot delete files
 * here. The exported function will throw if called.
 */

export const DEFAULT_QA_MODEL = 'gpt-5';

export function getQaModel(): string {
  return process.env.CODEX_QA_MODEL ?? DEFAULT_QA_MODEL;
}

export interface CodexInvocationOptions {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  cwd?: string;
  extraArgs?: string[];
}

export interface CodexInvocationResult {
  rawText: string;
  tokenUsage: number;
  exitCode: number;
}

export async function invokeCodex(_opts: CodexInvocationOptions): Promise<CodexInvocationResult> {
  throw new Error(
    'invokeCodex() is deprecated. ClaudeGPT no longer drives QA via Codex CLI. ' +
    'See packages/qa/src/processInboundReview.ts for the listener pattern.',
  );
}

export function resetCodexClient(): void {
  // no-op
}
