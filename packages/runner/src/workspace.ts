import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, getLogger } from '@claudegpt/shared';

const log = getLogger('runner.workspace');

/**
 * Create an isolated working directory for a single run, under RUNNER_WORKDIR.
 * Layout: <RUNNER_WORKDIR>/<runId>/repo
 *
 * The "repo" subdir is where the target repository gets cloned. Anything outside
 * that subdir (snapshots, logs, scratch files) lives at the run root.
 */
export interface Workspace {
  runId: string;
  /** Absolute path to <RUNNER_WORKDIR>/<runId> */
  root: string;
  /** Absolute path to <root>/repo — pass this to simple-git as the cwd. */
  repoPath: string;
}

export function createWorkspace(runId: string): Workspace {
  const env = loadEnv();
  const root = path.resolve(env.RUNNER_WORKDIR, runId);
  const repoPath = path.join(root, 'repo');

  // Refuse to clobber an existing directory — every run gets a unique runId.
  if (fs.existsSync(root)) {
    throw new Error(`Workspace already exists for runId=${runId} at ${root}`);
  }

  fs.mkdirSync(repoPath, { recursive: true });
  log.debug({ runId, root }, 'Workspace created');
  return { runId, root, repoPath };
}

/**
 * Best-effort cleanup. Always called from a finally block — must not throw.
 * Recursive remove with retries for Windows file-handle weirdness.
 */
export function cleanupWorkspace(workspacePath: string): void {
  if (!workspacePath) return;
  try {
    if (!fs.existsSync(workspacePath)) return;
    fs.rmSync(workspacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    log.debug({ workspacePath }, 'Workspace cleaned up');
  } catch (err) {
    // Never throw — cleanup failures are recorded but do not fail the job.
    log.warn({ workspacePath, err }, 'Workspace cleanup failed (non-fatal)');
  }
}
