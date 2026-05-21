/**
 * @deprecated The active QA path is the listener pattern.
 *
 * Original behavior: invoked OpenAI / Codex CLI to produce a verdict on demand.
 * Current behavior: ChatGPT's GitHub App posts reviews directly to the PR; we
 * listen for them and parse via Claude. See processInboundReview.ts.
 *
 * This file remains as a compatibility shim. Calling runQa() now throws — any
 * lingering callers are bugs that the worker wiring should have caught.
 */

import type { QaVerdict } from './parseResponse.js';

export interface QaRunResult {
  runId: string;
  verdict: QaVerdict;
  tokenUsage: number;
  costUsd: number;
}

export async function runQa(_jobId: string): Promise<QaRunResult> {
  throw new Error(
    'runQa() is removed. ClaudeGPT QA now runs as a listener for ChatGPT GitHub App reviews. ' +
    'Call processInboundReview() instead. See packages/qa/src/processInboundReview.ts.',
  );
}
