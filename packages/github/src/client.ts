import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { loadEnv, getLogger } from '@claudegpt/shared';

const log = getLogger('github.client');
let octokit: Octokit | null = null;

/**
 * Returns a singleton authenticated Octokit instance.
 * Uses GitHub App authentication when APP_ID + PRIVATE_KEY + INSTALLATION_ID are set.
 * Falls back to unauthenticated for local/dev work.
 */
export function getOctokit(): Octokit {
  if (octokit) return octokit;

  const env = loadEnv();
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_INSTALLATION_ID) {
    octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
        installationId: env.GITHUB_INSTALLATION_ID,
      },
      log: { debug: () => {}, info: () => {}, warn: log.warn.bind(log), error: log.error.bind(log) },
    });
  } else {
    log.warn('GitHub App credentials not fully configured; using unauthenticated Octokit (read-only public).');
    octokit = new Octokit();
  }
  return octokit;
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  return { owner, repo: name };
}

export async function commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void> {
  const { owner, repo: r } = splitRepo(repo);
  await getOctokit().issues.createComment({ owner, repo: r, issue_number: issueNumber, body });
}

export async function addLabels(repo: string, issueOrPrNumber: number, labels: string[]): Promise<void> {
  const { owner, repo: r } = splitRepo(repo);
  await getOctokit().issues.addLabels({ owner, repo: r, issue_number: issueOrPrNumber, labels });
}

export async function removeLabel(repo: string, issueOrPrNumber: number, label: string): Promise<void> {
  const { owner, repo: r } = splitRepo(repo);
  try {
    await getOctokit().issues.removeLabel({ owner, repo: r, issue_number: issueOrPrNumber, name: label });
  } catch (err: unknown) {
    // 404 means label wasn't on the issue; that's fine.
    const e = err as { status?: number };
    if (e.status !== 404) throw err;
  }
}

export async function getIssue(repo: string, issueNumber: number) {
  const { owner, repo: r } = splitRepo(repo);
  const res = await getOctokit().issues.get({ owner, repo: r, issue_number: issueNumber });
  return res.data;
}

export async function getPullRequest(repo: string, prNumber: number) {
  const { owner, repo: r } = splitRepo(repo);
  const res = await getOctokit().pulls.get({ owner, repo: r, pull_number: prNumber });
  return res.data;
}

export async function getPullRequestDiff(repo: string, prNumber: number): Promise<string> {
  const { owner, repo: r } = splitRepo(repo);
  const res = await getOctokit().pulls.get({
    owner,
    repo: r,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });
  // When mediaType is diff, data is a string.
  return res.data as unknown as string;
}

export async function createPullRequest(args: {
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
  draft?: boolean;
}) {
  const { owner, repo: r } = splitRepo(args.repo);
  const res = await getOctokit().pulls.create({
    owner,
    repo: r,
    title: args.title,
    head: args.head,
    base: args.base,
    body: args.body,
    draft: args.draft ?? true,
  });
  return res.data;
}
