import { simpleGit, type SimpleGit } from 'simple-git';
import { getLogger } from '@claudegpt/shared';
import { getOctokit } from '@claudegpt/github';

const log = getLogger('runner.git');

/**
 * Protected branches the runner will never push to. Mirrors agent-policy.md §2.
 */
const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'prod']);
const PROTECTED_PREFIXES = ['release/', 'prod/', 'production/'];

function isProtectedBranch(branch: string): boolean {
  if (PROTECTED_BRANCHES.has(branch)) return true;
  return PROTECTED_PREFIXES.some((p) => branch.startsWith(p));
}

/**
 * Fetch a short-lived installation token from the GitHub App.
 * Token is scoped to the installation and typically valid for ~1 hour.
 */
async function getInstallationToken(): Promise<string> {
  const oct = getOctokit();
  // Octokit's `auth({type: 'installation'})` returns a token object when configured
  // with createAppAuth. When unauthenticated (dev fallback), this throws.
  const auth = await (oct.auth as (opts: { type: 'installation' }) => Promise<unknown>)({
    type: 'installation',
  });
  const token = (auth as { token?: string })?.token;
  if (!token) {
    throw new Error('Failed to obtain GitHub App installation token (is the App configured?).');
  }
  return token;
}

/**
 * Build the authenticated clone URL.
 *
 * IMPORTANT: this URL contains a short-lived bearer token. It must never be:
 *   - logged
 *   - committed
 *   - stored in run_logs metadata
 *   - included in any error message returned upstream
 *
 * Use {@link redactCloneUrl} for any log line that needs to reference the URL.
 */
function buildCloneUrl(repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

export function redactCloneUrl(repo: string): string {
  return `https://x-access-token:[REDACTED]@github.com/${repo}.git`;
}

/**
 * Shallow clone the repo into `repoPath`. After clone, the `origin` remote is
 * rewritten to drop the token from disk — the token only lives in memory for the
 * duration of the clone and any subsequent push (set ad hoc by `push`).
 */
export async function shallowClone(args: {
  repo: string;
  defaultBranch: string;
  repoPath: string;
}): Promise<{ git: SimpleGit; token: string }> {
  const token = await getInstallationToken();
  const cloneUrl = buildCloneUrl(args.repo, token);

  // Use a bare simpleGit() to run `clone` since the target dir doesn't have a .git yet.
  const bootstrap = simpleGit();
  log.info({ repo: args.repo, branch: args.defaultBranch }, 'Cloning (shallow, depth=1)');
  await bootstrap.clone(cloneUrl, args.repoPath, [
    '--depth',
    '1',
    '--branch',
    args.defaultBranch,
    '--single-branch',
  ]);

  const git = simpleGit(args.repoPath);

  // Strip the token from the persisted remote URL — we'll re-inject it just for push.
  const cleanUrl = `https://github.com/${args.repo}.git`;
  await git.remote(['set-url', 'origin', cleanUrl]);

  // Configure a runner identity for commits. The GitHub App produces commits attributed
  // to the App's bot account when the X-Access-Token is used at push time, so the local
  // committer name/email here is just for git's required fields.
  await git.addConfig('user.name', 'ClaudeGPT Runner', false, 'local');
  await git.addConfig('user.email', 'runner@claudegpt.local', false, 'local');

  return { git, token };
}

/**
 * Create + check out a new branch from the current HEAD.
 * Hard fails on protected branch names — defense in depth alongside pre-push hook.
 */
export async function createBranch(git: SimpleGit, branch: string): Promise<void> {
  if (isProtectedBranch(branch)) {
    throw new Error(`Refusing to create protected branch: ${branch}`);
  }
  log.info({ branch }, 'Creating branch');
  await git.checkoutLocalBranch(branch);
}

/**
 * Check out an existing remote branch (used by rework). Fetches first to make sure
 * we have it locally even though the clone was shallow + single-branch.
 */
export async function checkoutExistingBranch(
  git: SimpleGit,
  branch: string,
): Promise<void> {
  if (isProtectedBranch(branch)) {
    throw new Error(`Refusing to check out protected branch: ${branch}`);
  }
  log.info({ branch }, 'Fetching + checking out existing branch');
  await git.fetch('origin', branch, ['--depth', '50']);
  await git.checkout(['-B', branch, `origin/${branch}`]);
}

/**
 * Stage all changes and commit. Returns the new commit SHA.
 * No-op (returns null) when nothing is staged.
 */
export async function commitAll(
  git: SimpleGit,
  message: string,
): Promise<string | null> {
  await git.add(['-A']);
  const status = await git.status();
  if (status.staged.length === 0) {
    log.info('Nothing staged; skipping commit');
    return null;
  }
  log.info({ files: status.staged.length, message }, 'Committing');
  const result = await git.commit(message);
  return result.commit || null;
}

/**
 * Push the current branch to origin. Never force-pushes. Never targets a protected branch.
 *
 * The token is injected via a transient `extraheader` config flag so it never lands on disk.
 */
export async function pushBranch(args: {
  git: SimpleGit;
  repo: string;
  branch: string;
  token: string;
  defaultBranch: string;
}): Promise<void> {
  if (isProtectedBranch(args.branch)) {
    throw new Error(`Refusing to push protected branch: ${args.branch}`);
  }
  if (args.branch === args.defaultBranch) {
    throw new Error(`Refusing to push to default branch: ${args.defaultBranch}`);
  }

  // Carry the token via GIT_HTTP_EXTRAHEADER env var. (`git -c http.extraheader=...`
  // would require the -c to come BEFORE the subcommand; simple-git's push() appends
  // them after, which git rejects with "unknown switch \`c\`".)
  const basic = Buffer.from(`x-access-token:${args.token}`).toString('base64');
  log.info({ branch: args.branch, repo: args.repo }, 'Pushing branch');
  await args.git
    .env('GIT_HTTP_EXTRAHEADER', `Authorization: Basic ${basic}`)
    .push('origin', `${args.branch}:${args.branch}`, ['--set-upstream']);
}

/**
 * Read the current HEAD SHA. Used after commit to populate agent_runs.commit_sha.
 */
export async function headSha(git: SimpleGit): Promise<string> {
  const sha = await git.revparse(['HEAD']);
  return sha.trim();
}

/**
 * Compute a tiny diffStats summary against origin/<defaultBranch>. Used to populate hook payloads.
 */
export async function diffStatsAgainst(
  git: SimpleGit,
  defaultBranch: string,
): Promise<{ files: number; additions: number; deletions: number }> {
  try {
    const out = await git.raw(['diff', '--shortstat', `origin/${defaultBranch}..HEAD`]);
    const filesMatch = out.match(/(\d+) files? changed/);
    const insMatch = out.match(/(\d+) insertions?/);
    const delMatch = out.match(/(\d+) deletions?/);
    return {
      files: filesMatch ? Number(filesMatch[1]) : 0,
      additions: insMatch ? Number(insMatch[1]) : 0,
      deletions: delMatch ? Number(delMatch[1]) : 0,
    };
  } catch {
    return { files: 0, additions: 0, deletions: 0 };
  }
}

export async function listChangedFiles(
  git: SimpleGit,
  defaultBranch: string,
): Promise<string[]> {
  try {
    const out = await git.raw(['diff', '--name-only', `origin/${defaultBranch}..HEAD`]);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
