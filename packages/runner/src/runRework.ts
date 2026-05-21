import { eq, desc, and } from 'drizzle-orm';
import { getDb, schema } from '@claudegpt/db';
import { getLogger } from '@claudegpt/shared';
import { commentOnIssue, addLabels, getPullRequest } from '@claudegpt/github';
import { projectConfigSchema, type ProjectConfig } from '@claudegpt/project-registry';

import { createWorkspace, cleanupWorkspace } from './workspace.js';
import {
  shallowClone,
  checkoutExistingBranch,
  commitAll,
  pushBranch,
  headSha,
  diffStatsAgainst,
  listChangedFiles,
} from './git.js';
import { runHook, type HookResult } from './hooks.js';
import { runValidationChain, toHookValidationShape, allValidationPassed } from './validate.js';
import { buildPrompt } from './promptBuilder.js';
import { invokeClaude } from './claude.js';

const log = getLogger('runner.rework');

interface ReworkPayload {
  pr: { number: number; title: string; head_branch: string; url?: string };
  issue: { number: number; title: string; body: string; labels?: string[] };
  qa_feedback?: {
    run_id?: string;
    summary?: string;
    required_changes?: string[];
    non_blocking_suggestions?: string[];
    security_concerns?: string[];
    missing_tests?: string[];
    scope_violations?: string[];
  };
  trigger?: Record<string, unknown>;
}

/**
 * Worker entrypoint for `claude_rework_pr`. Unlike implementation, this:
 *  - does NOT create a new branch — it checks out the existing PR head
 *  - does NOT open a new PR — pushing updates the existing one
 *  - loads prior QA feedback from the payload (and falls back to scanning recent
 *    run_logs for the same PR if the payload lacks it)
 */
export async function runRework(jobId: string): Promise<void> {
  const db = getDb();

  const [job] = await db.select().from(schema.agentJobs).where(eq(schema.agentJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`job ${jobId} not found`);

  const [run] = await db
    .insert(schema.agentRuns)
    .values({ jobId: job.id, status: 'running', startedAt: new Date() })
    .returning();
  if (!run) throw new Error('failed to create agent_runs row');
  const runId = run.id;

  await db
    .update(schema.agentJobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.agentJobs.id, jobId));

  let workspace: { runId: string; root: string; repoPath: string } | null = null;

  try {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, job.projectId))
      .limit(1);
    if (!project) throw new Error(`project ${job.projectId} not found`);

    const projectConfig = resolveProjectConfig(project);
    const payload = job.payloadJson as ReworkPayload;
    if (!payload?.pr?.number || !payload?.issue?.number) {
      await markFailed(runId, jobId, 'invalid_rework_payload');
      return;
    }

    const branchName = payload.pr.head_branch;
    const issue = payload.issue;
    const pr = payload.pr;

    // 1. pre-execution
    const preExec = await runHook({
      hook: 'pre-execution',
      payload: {
        hook: 'pre-execution',
        run_id: runId,
        project_id: job.projectId,
        repo: job.githubRepo,
        branch: branchName,
        branch_prefix: projectConfig.branchPrefix,
        issue_number: issue.number,
        issue_title: issue.title,
        issue_body: issue.body,
        project_status: project.status,
        claim_state: 'claimed_by_self',
      },
    });
    await writeLog(runId, 'info', 'hook.pre-execution', preExec.pass ? 'pass' : preExec.reason ?? 'block', preExec.raw);
    if (!preExec.pass) {
      await handleBlock(runId, jobId, job, preExec, 'pre-execution', issue.number);
      return;
    }

    // 2. Workspace
    workspace = createWorkspace(runId);
    await writeLog(runId, 'info', 'runner.workspace.create', `workspace=${workspace.root}`);

    // 3. Clone default branch, then check out the PR branch
    const { git, token } = await shallowClone({
      repo: job.githubRepo,
      defaultBranch: project.defaultBranch,
      repoPath: workspace.repoPath,
    });
    await writeLog(runId, 'info', 'runner.git.clone', `repo=${job.githubRepo}`);
    await checkoutExistingBranch(git, branchName);
    await writeLog(runId, 'info', 'runner.git.checkout', `branch=${branchName}`);
    await db.update(schema.agentRuns).set({ branchName, prNumber: pr.number }).where(eq(schema.agentRuns.id, runId));

    // 4. Resolve QA feedback: prefer payload, otherwise scan run_logs for the
    // most recent qa.parse entry on this PR.
    const qaFeedback = await resolveQaFeedback(payload, job.githubRepo, pr.number);

    // 5. pre-edit hook
    const preEdit = await runHook({
      hook: 'pre-edit',
      payload: {
        hook: 'pre-edit',
        run_id: runId,
        workspace_path: workspace.repoPath,
        branch: branchName,
        issue_number: issue.number,
      },
    });
    await writeLog(runId, 'info', 'hook.pre-edit', preEdit.pass ? 'pass' : preEdit.reason ?? 'block', preEdit.raw);
    if (!preEdit.pass) {
      await handleBlock(runId, jobId, job, preEdit, 'pre-edit', issue.number);
      return;
    }

    // 6. Build rework prompt
    const { prompt, agent } = buildPrompt({
      agentFile: 'agents/rework.md',
      variables: {
        projectName: project.name,
        repo: job.githubRepo,
        issueNumber: issue.number,
        issueTitle: issue.title,
        branchName,
        issueBody: issue.body,
        qaFeedback,
        prNumber: pr.number,
      },
    });
    await db
      .update(schema.agentRuns)
      .set({ promptSnapshot: prompt.slice(0, 100_000) })
      .where(eq(schema.agentRuns.id, runId));

    const limits = projectConfig.limits;
    const claudeResult = await invokeClaude({
      prompt,
      model: (agent.frontmatter.model as string) ?? 'claude-sonnet-4-6',
      timeoutMs: limits.maxRunMinutes * 60 * 1000,
    });
    await writeLog(runId, 'info', 'runner.claude.invoke', `tokens=${claudeResult.tokenUsage}`, {
      model: claudeResult.model,
    });
    await db
      .update(schema.agentRuns)
      .set({ tokenUsage: claudeResult.tokenUsage, resultSummary: claudeResult.structured?.summary ?? null })
      .where(eq(schema.agentRuns.id, runId));

    // 7. post-edit + validation
    const changedFiles = await listChangedFiles(git, project.defaultBranch);
    const postEdit = await runHook({
      hook: 'post-edit',
      payload: {
        hook: 'post-edit',
        run_id: runId,
        workspace_path: workspace.repoPath,
        commands: projectConfig.commands,
        files_changed: changedFiles,
      },
    });
    await writeLog(runId, 'info', 'hook.post-edit', postEdit.pass ? 'pass' : postEdit.reason ?? 'block', postEdit.raw);
    if (!postEdit.pass) {
      await handleBlock(runId, jobId, job, postEdit, 'post-edit', issue.number);
      return;
    }

    const validationResults = await runValidationChain({
      cwd: workspace.repoPath,
      commands: projectConfig.commands,
    });
    for (const step of ['install', 'lint', 'typecheck', 'test', 'build'] as const) {
      const r = validationResults[step];
      await writeLog(
        runId,
        r.status === 'pass' || r.status === 'skipped' ? 'info' : 'error',
        `runner.validate.${step}`,
        `status=${r.status} exit=${r.exitCode}`,
        { stdoutTail: r.stdoutTail, stderrTail: r.stderrTail, command: r.command },
      );
    }
    if (!allValidationPassed(validationResults)) {
      await commentOnIssue(
        job.githubRepo,
        pr.number,
        `ClaudeGPT (rework): validation failed; no changes pushed. Run \`${runId}\`.`,
      ).catch(() => undefined);
      await markFailed(runId, jobId, 'validation_failed');
      return;
    }

    // 8. pre-commit
    await git.add(['-A']);
    const preCommit = await runHook({
      hook: 'pre-commit',
      payload: {
        hook: 'pre-commit',
        run_id: runId,
        workspace_path: workspace.repoPath,
        issue_labels: issue.labels ?? [],
      },
    });
    await writeLog(runId, 'info', 'hook.pre-commit', preCommit.pass ? 'pass' : preCommit.reason ?? 'block', preCommit.raw);
    if (!preCommit.pass) {
      await handleBlock(runId, jobId, job, preCommit, 'pre-commit', issue.number);
      return;
    }

    const commitMessage =
      `fix(rework): apply QA feedback for PR #${pr.number}\n\n` +
      `${claudeResult.structured?.summary ?? 'Address QA feedback.'}\n\n` +
      `Refs #${issue.number}`;
    const commitSha = await commitAll(git, commitMessage);
    if (!commitSha) {
      await writeLog(runId, 'warn', 'runner.git.commit', 'nothing to commit; no push');
      await commentOnIssue(
        job.githubRepo,
        pr.number,
        `ClaudeGPT (rework): completed without producing any changes. Marking run failed.`,
      ).catch(() => undefined);
      await markFailed(runId, jobId, 'no_changes');
      return;
    }
    await writeLog(runId, 'info', 'runner.git.commit', `sha=${commitSha}`);
    const headShaValue = await headSha(git);
    await db.update(schema.agentRuns).set({ commitSha: headShaValue }).where(eq(schema.agentRuns.id, runId));

    // 9. pre-push
    const prePush = await runHook({
      hook: 'pre-push',
      payload: {
        hook: 'pre-push',
        run_id: runId,
        workspace_path: workspace.repoPath,
        branch: branchName,
        branch_prefix: projectConfig.branchPrefix,
        default_branch: project.defaultBranch,
      },
    });
    await writeLog(runId, 'info', 'hook.pre-push', prePush.pass ? 'pass' : prePush.reason ?? 'block', prePush.raw);
    if (!prePush.pass) {
      await handleBlock(runId, jobId, job, prePush, 'pre-push', issue.number);
      return;
    }

    await pushBranch({ git, repo: job.githubRepo, branch: branchName, token, defaultBranch: project.defaultBranch });
    await writeLog(runId, 'info', 'runner.git.push', `pushed ${branchName}`);

    // 10. Comment on PR with the per-item response (rework doesn't open a PR; the existing one updates).
    await commentOnIssue(
      job.githubRepo,
      pr.number,
      buildReworkComment(claudeResult.structured?.summary ?? '', headShaValue),
    ).catch((err) => log.warn({ err }, 'rework PR comment failed (non-fatal)'));

    // Try to re-fetch the PR so we can keep DB mapping fresh.
    try {
      const fresh = await getPullRequest(job.githubRepo, pr.number);
      await db.update(schema.agentJobs).set({ githubPrNumber: fresh.number }).where(eq(schema.agentJobs.id, jobId));
    } catch {
      /* non-fatal */
    }

    // Use diffStats for run_logs context.
    const diffStats = await diffStatsAgainst(git, project.defaultBranch);
    await writeLog(runId, 'info', 'runner.diff.stats', JSON.stringify(diffStats));

    await db
      .update(schema.agentRuns)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    await db
      .update(schema.agentJobs)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));
    log.info({ jobId, runId, prNumber: pr.number }, 'Rework succeeded');
  } catch (err) {
    log.error({ jobId, runId, err }, 'Rework crashed');
    await writeLog(runId, 'error', 'runner.crash', err instanceof Error ? err.message : String(err)).catch(() => undefined);
    await markFailed(runId, jobId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
  } finally {
    if (workspace) cleanupWorkspace(workspace.root);
  }
}

// ---- helpers ----

function resolveProjectConfig(project: typeof schema.projects.$inferSelect): ProjectConfig {
  const parsed = projectConfigSchema.safeParse(project.configJson);
  if (parsed.success) return parsed.data;
  // Same fallback shape as in runImplementation; duplicated rather than exported to keep
  // the two files free of cross-coupling (they may diverge as the agents evolve).
  return {
    projectId: project.slug,
    name: project.name,
    githubRepo: project.githubRepo,
    defaultBranch: project.defaultBranch,
    branchPrefix: 'feature',
    primaryBuildAgent: 'claude-code',
    qaAgent: 'openai',
    trustedUsers: [],
    labels: {
      ready: 'claude-ready',
      claimed: 'claude-claimed',
      inProgress: 'claude-in-progress',
      complete: 'claude-complete',
      qa: 'openai-qa',
      approved: 'openai-approved',
      rework: 'claude-rework',
      blocked: 'blocked',
      needsOwner: 'needs-nishad',
      doNotRun: 'do-not-run-agent',
      securityReview: 'security-review',
      databaseReview: 'database-review',
      releaseReady: 'release-ready',
    },
    commands: {
      install: 'echo no-install',
      lint: 'echo no-lint',
      typecheck: 'echo no-typecheck',
      test: 'echo no-test',
      build: 'echo no-build',
    },
    paths: { agentPolicy: '.claudegpt/agent-policy.md', claudeGuide: 'CLAUDE.md', protected: [] },
    trustedTriggerLabel: 'claude-ready',
    limits: {
      maxRunMinutes: 20,
      maxQaMinutes: 5,
      maxTokens: 150_000,
      maxFiles: 25,
      maxLines: 1500,
      maxCostUsd: 5,
      concurrentRuns: 1,
    },
  };
}

async function resolveQaFeedback(payload: ReworkPayload, repo: string, prNumber: number): Promise<string> {
  if (payload.qa_feedback) {
    return JSON.stringify(payload.qa_feedback, null, 2);
  }
  // Fallback: look at prior runs for this PR via agent_runs.pr_number and read the most
  // recent qa.parse run_log entry.
  try {
    const db = getDb();
    const priorRuns = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.prNumber, prNumber))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(5);
    for (const r of priorRuns) {
      const logs = await db
        .select()
        .from(schema.runLogs)
        .where(and(eq(schema.runLogs.runId, r.id), eq(schema.runLogs.source, 'qa.parse')))
        .orderBy(desc(schema.runLogs.createdAt))
        .limit(1);
      if (logs[0]) return JSON.stringify(logs[0].metadataJson, null, 2);
    }
  } catch (err) {
    log.warn({ err, repo, prNumber }, 'failed to resolve prior QA feedback; sending empty');
  }
  return '(QA feedback not available in payload; review PR comments for context.)';
}

function buildReworkComment(summary: string, sha: string): string {
  return [
    `ClaudeGPT rework pushed commit \`${sha.slice(0, 7)}\`.`,
    '',
    summary || 'See per-item response in the PR thread.',
  ].join('\n');
}

async function writeLog(
  runId: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  source: string,
  message: string,
  metadata?: unknown,
): Promise<void> {
  try {
    await getDb().insert(schema.runLogs).values({
      runId,
      level,
      source,
      message,
      metadataJson: (metadata as Record<string, unknown>) ?? {},
    });
  } catch (err) {
    log.warn({ err, source }, 'failed to write run_log (non-fatal)');
  }
}

async function handleBlock(
  runId: string,
  jobId: string,
  job: typeof schema.agentJobs.$inferSelect,
  hookResult: HookResult,
  hookName: string,
  issueOrPrNumber: number,
): Promise<void> {
  const db = getDb();
  const label = hookResult.suggestedLabel ?? 'blocked';

  await addLabels(job.githubRepo, issueOrPrNumber, [label]).catch((err) =>
    log.warn({ err }, 'addLabels failed (non-fatal)'),
  );
  await commentOnIssue(
    job.githubRepo,
    issueOrPrNumber,
    `ClaudeGPT (rework): blocked at \`${hookName}\` hook.\n\n**Reason:** ${hookResult.reason ?? 'unspecified'}\n\nRun id: \`${runId}\``,
  ).catch((err) => log.warn({ err }, 'commentOnIssue failed (non-fatal)'));

  await db
    .update(schema.agentRuns)
    .set({ status: 'failed', errorMessage: `${hookName}: ${hookResult.reason ?? 'blocked'}`, completedAt: new Date() })
    .where(eq(schema.agentRuns.id, runId));
  await db
    .update(schema.agentJobs)
    .set({ status: 'blocked', completedAt: new Date() })
    .where(eq(schema.agentJobs.id, jobId));
}

async function markFailed(runId: string, jobId: string, reason: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentRuns)
    .set({ status: 'failed', errorMessage: reason, completedAt: new Date() })
    .where(eq(schema.agentRuns.id, runId));
  await db
    .update(schema.agentJobs)
    .set({ status: 'failed', completedAt: new Date() })
    .where(eq(schema.agentJobs.id, jobId));
}
