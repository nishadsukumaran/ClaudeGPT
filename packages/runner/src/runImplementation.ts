import { eq } from 'drizzle-orm';
import { getDb, schema } from '@claudegpt/db';
import { getLogger, loadEnv } from '@claudegpt/shared';
import { commentOnIssue, addLabels, createPullRequest } from '@claudegpt/github';
import { createNishadActionTicket, moveTaskForIssue } from '@claudegpt/clickup';
import { projectConfigSchema, type ProjectConfig } from '@claudegpt/project-registry';

import { createWorkspace, cleanupWorkspace } from './workspace.js';
import {
  shallowClone,
  createBranch,
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

const log = getLogger('runner.implement');

/**
 * Public entrypoint for the worker handler. Loads the agent_jobs row, performs
 * the full implementation flow, and updates DB state.
 *
 * Throws only on programmer error / unhandled exceptions. All policy and hook
 * failures are caught and turn into `blocked` / `failed` DB state with a comment
 * on the issue — the caller treats a thrown error as a transient infra failure.
 */
export async function runImplementation(jobId: string): Promise<void> {
  const db = getDb();

  // 1. Load job
  const [job] = await db.select().from(schema.agentJobs).where(eq(schema.agentJobs.id, jobId)).limit(1);
  if (!job) {
    log.error({ jobId }, 'Job not found');
    throw new Error(`job ${jobId} not found`);
  }

  // 2. Create run row
  const [run] = await db
    .insert(schema.agentRuns)
    .values({ jobId: job.id, status: 'running', startedAt: new Date() })
    .returning();
  if (!run) {
    throw new Error('failed to create agent_runs row');
  }
  const runId = run.id;
  log.info({ jobId, runId, repo: job.githubRepo }, 'Implementation run starting');

  // Mark job running
  await db
    .update(schema.agentJobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.agentJobs.id, jobId));

  let workspace: { runId: string; root: string; repoPath: string } | null = null;

  try {
    // 3. Resolve project + payload
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, job.projectId))
      .limit(1);
    if (!project) throw new Error(`project ${job.projectId} not found`);

    const projectConfig = resolveProjectConfig(project);
    const payload = job.payloadJson as ImplementPayload;
    if (!payload?.issue?.number) {
      await fail(runId, jobId, 'invalid_payload', 'Job payload missing issue.number', job);
      return;
    }

    const branchName = payload.branch_name;
    const issue = payload.issue;

    // 4. pre-execution hook
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
      await handleBlock(runId, jobId, job, preExec, 'pre-execution');
      return;
    }

    // 5. Workspace
    workspace = createWorkspace(runId);
    await writeLog(runId, 'info', 'runner.workspace.create', `workspace=${workspace.root}`);

    // 6. Clone + branch
    const { git, token } = await shallowClone({
      repo: job.githubRepo,
      defaultBranch: project.defaultBranch,
      repoPath: workspace.repoPath,
    });
    await writeLog(runId, 'info', 'runner.git.clone', `repo=${job.githubRepo} branch=${project.defaultBranch}`);

    await createBranch(git, branchName);
    await writeLog(runId, 'info', 'runner.git.branch', `branch=${branchName}`);

    // Persist branch name on the run row
    await db.update(schema.agentRuns).set({ branchName }).where(eq(schema.agentRuns.id, runId));

    // 7. pre-edit hook
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
      await handleBlock(runId, jobId, job, preEdit, 'pre-edit');
      return;
    }

    // 8. Claude invocation
    const { prompt, agent } = buildPrompt({
      agentFile: 'agents/builder.md',
      variables: {
        projectName: project.name,
        repo: job.githubRepo,
        issueNumber: issue.number,
        issueTitle: issue.title,
        branchName,
        issueBody: issue.body,
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
    await writeLog(
      runId,
      'info',
      'runner.claude.invoke',
      `tokens=${claudeResult.tokenUsage} structured=${claudeResult.structured !== null}`,
      { model: claudeResult.model, tokenUsage: claudeResult.tokenUsage },
    );

    await db
      .update(schema.agentRuns)
      .set({ tokenUsage: claudeResult.tokenUsage, resultSummary: claudeResult.structured?.summary ?? null })
      .where(eq(schema.agentRuns.id, runId));

    // 9. post-edit hook
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
      await handleBlock(runId, jobId, job, postEdit, 'post-edit');
      return;
    }

    // 10. Validation chain
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
        issue.number,
        `ClaudeGPT: validation failed. PR will not be opened. Run \`${runId}\` left as failed; see run_logs for details.`,
      ).catch(() => undefined);
      await markFailed(runId, jobId, 'validation_failed');
      return;
    }

    // 11. Stage + commit
    const commitMessage =
      `feat: implement issue #${issue.number}\n\n` +
      `${claudeResult.structured?.summary ?? issue.title}\n\n` +
      `Refs #${issue.number}`;

    // 12. pre-commit hook (secret scan). The hook itself looks at staged files,
    // so stage everything first.
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
      await handleBlock(runId, jobId, job, preCommit, 'pre-commit');
      return;
    }

    const commitSha = await commitAll(git, commitMessage);
    if (!commitSha) {
      await writeLog(runId, 'warn', 'runner.git.commit', 'nothing to commit; no PR will be opened');
      await commentOnIssue(
        job.githubRepo,
        issue.number,
        `ClaudeGPT: Claude completed without producing any file changes. Marking run failed.`,
      ).catch(() => undefined);
      await markFailed(runId, jobId, 'no_changes');
      return;
    }
    await writeLog(runId, 'info', 'runner.git.commit', `sha=${commitSha}`);
    const headShaValue = await headSha(git);
    await db.update(schema.agentRuns).set({ commitSha: headShaValue }).where(eq(schema.agentRuns.id, runId));

    // 13. pre-push hook
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
      await handleBlock(runId, jobId, job, prePush, 'pre-push');
      return;
    }

    // 14. Push
    await pushBranch({ git, repo: job.githubRepo, branch: branchName, token, defaultBranch: project.defaultBranch });
    await writeLog(runId, 'info', 'runner.git.push', `pushed ${branchName}`);

    // 15. pre-pr hook
    const prBody = buildPrBody({
      issueNumber: issue.number,
      structured: claudeResult.structured,
      validation: validationResults,
    });
    const diffStats = await diffStatsAgainst(git, project.defaultBranch);
    const prePr = await runHook({
      hook: 'pre-pr',
      payload: {
        hook: 'pre-pr',
        run_id: runId,
        workspace_path: workspace.repoPath,
        validation_results: toHookValidationShape(validationResults),
        pr_body: prBody,
        default_branch: project.defaultBranch,
        limits: { maxFiles: limits.maxFiles, maxLines: limits.maxLines },
        diff_stats: diffStats,
      },
    });
    await writeLog(runId, 'info', 'hook.pre-pr', prePr.pass ? 'pass' : prePr.reason ?? 'block', prePr.raw);
    if (!prePr.pass) {
      await handleBlock(runId, jobId, job, prePr, 'pre-pr');
      return;
    }

    // 16. Open PR (ready for review, not draft — validations already passed locally,
    // and Codex Connector's auto-review only triggers on non-draft PRs).
    const pr = await createPullRequest({
      repo: job.githubRepo,
      title: `[${issue.number}] ${issue.title}`,
      head: branchName,
      base: project.defaultBranch,
      body: prBody,
      draft: false,
    });
    await writeLog(runId, 'info', 'runner.pr.open', `pr=${pr.number} url=${pr.html_url}`);
    await db.update(schema.agentRuns).set({ prNumber: pr.number }).where(eq(schema.agentRuns.id, runId));
    await db.update(schema.agentJobs).set({ githubPrNumber: pr.number }).where(eq(schema.agentJobs.id, jobId));

    // 16b. Belt-and-braces nudge for ChatGPT Codex Connector. Codex auto-reviews
    // on PR open, but tends to skip bot-authored PRs unless prompted. A short
    // \`@codex review\` comment from the App reliably kicks it off.
    await commentOnIssue(job.githubRepo, pr.number, '@codex review')
      .catch((err) => log.warn({ err }, 'codex auto-mention failed (non-fatal)'));

    // 17. post-pr hook (informational, never blocks)
    const postPr = await runHook({
      hook: 'post-pr',
      payload: {
        hook: 'post-pr',
        run_id: runId,
        workspace_path: workspace.repoPath,
        pr_number: pr.number,
        pr_url: pr.html_url,
        branch: branchName,
        issue_number: issue.number,
        diff_stats: diffStats,
      },
    });
    await writeLog(runId, 'info', 'hook.post-pr', 'recorded', postPr.raw);

    // 18. Comment on issue (post-pr followup is also informational)
    await commentOnIssue(
      job.githubRepo,
      issue.number,
      `ClaudeGPT: opened PR ${pr.html_url}\n\n${claudeResult.structured?.summary ?? ''}`,
    ).catch((err) => log.warn({ err }, 'issue comment failed (non-fatal)'));

    // 19. Mark succeeded
    await db
      .update(schema.agentRuns)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    await db
      .update(schema.agentJobs)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));
    log.info({ jobId, runId, prNumber: pr.number }, 'Implementation succeeded');
  } catch (err) {
    log.error({ jobId, runId, err }, 'Implementation crashed');
    await writeLog(runId, 'error', 'runner.crash', err instanceof Error ? err.message : String(err)).catch(() => undefined);
    await markFailed(runId, jobId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    await commentOnIssue(
      job.githubRepo,
      (job.payloadJson as ImplementPayload)?.issue?.number ?? 0,
      `ClaudeGPT: run \`${runId}\` crashed with an unexpected error. Check run_logs.`,
    ).catch(() => undefined);
  } finally {
    if (workspace) cleanupWorkspace(workspace.root);
  }
}

// ---- helpers ----

export interface ImplementPayload {
  issue: {
    number: number;
    title: string;
    body: string;
    labels?: string[];
    url?: string;
  };
  trigger?: { event_type?: string; user?: string; applied_label?: string; delivery_id?: string };
  branch_name: string;
  policy_decision?: { approved: boolean; checks_passed?: string[] };
}

function resolveProjectConfig(project: typeof schema.projects.$inferSelect): ProjectConfig {
  // Try the strict schema first; if config_json is partial (early days), fall back to a
  // minimal shape derived from the row itself.
  const parsed = projectConfigSchema.safeParse(project.configJson);
  if (parsed.success) return parsed.data;

  // Build a minimal config object so the runner can still operate against a partially
  // configured project. Commands default to no-op echoes — validation will fail loudly
  // but we won't crash before that point.
  const minimal: ProjectConfig = {
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
      maxRunMinutes: 30,
      maxQaMinutes: 5,
      maxTokens: 200_000,
      maxFiles: 25,
      maxLines: 1500,
      maxCostUsd: 5,
      concurrentRuns: 1,
    },
  };
  return minimal;
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
): Promise<void> {
  const db = getDb();
  const label = hookResult.suggestedLabel ?? 'blocked';
  const issueNumber = (job.payloadJson as ImplementPayload)?.issue?.number;

  if (issueNumber) {
    await addLabels(job.githubRepo, issueNumber, [label]).catch((err) =>
      log.warn({ err }, 'addLabels failed (non-fatal)'),
    );
    await commentOnIssue(
      job.githubRepo,
      issueNumber,
      `ClaudeGPT: blocked at \`${hookName}\` hook.\n\n**Reason:** ${hookResult.reason ?? 'unspecified'}\n\nRun id: \`${runId}\``,
    ).catch((err) => log.warn({ err }, 'commentOnIssue failed (non-fatal)'));

    // Surface the block in ClickUp's Nishad Actions list so it shows up in
    // the operator's to-do queue. Move existing build ticket out of "In Build".
    await moveTaskForIssue({
      repo: job.githubRepo,
      issueNumber,
      lane: 'nishad_actions',
      commentMarkdown: `Blocked at \`${hookName}\` — ${hookResult.reason ?? 'unspecified'}.\nRun id: ${runId}`,
    }).catch((err) => log.warn({ err }, 'ClickUp moveTask failed (non-fatal)'));
    await createNishadActionTicket({
      title: `[${job.githubRepo}#${issueNumber}] Blocked at ${hookName}`,
      contextMarkdown: [
        `**Repo:** ${job.githubRepo}`,
        `**Issue:** #${issueNumber}`,
        `**Hook:** \`${hookName}\``,
        `**Reason:** ${hookResult.reason ?? 'unspecified'}`,
        `**Run id:** \`${runId}\``,
        '',
        'Address the block, then remove the `blocked` label to re-trigger the loop.',
      ].join('\n'),
    }).catch((err) => log.warn({ err }, 'ClickUp nishadAction ticket failed (non-fatal)'));
  }

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

async function fail(
  runId: string,
  jobId: string,
  reason: string,
  message: string,
  job: typeof schema.agentJobs.$inferSelect,
): Promise<void> {
  await writeLog(runId, 'error', 'runner.fail', message);
  await markFailed(runId, jobId, reason);
  const issueNumber = (job.payloadJson as ImplementPayload)?.issue?.number;
  if (issueNumber) {
    await commentOnIssue(job.githubRepo, issueNumber, `ClaudeGPT: ${message}`).catch(() => undefined);
  }
}

function buildPrBody(args: {
  issueNumber: number;
  structured: import('./claude.js').ClaudeStructuredResult | null;
  validation: ReturnType<typeof toHookValidationShape> extends infer T ? T : never;
}): string {
  const s = args.structured;
  const lines: string[] = [];
  lines.push(`Closes #${args.issueNumber}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(s?.summary ?? '(no summary)');
  lines.push('');
  lines.push('## Files Changed');
  if (s && s.files_changed.length) {
    for (const f of s.files_changed) lines.push(`- ${f}`);
  } else {
    lines.push('- (see diff)');
  }
  lines.push('');
  lines.push('## Tests Run');
  if (s && s.tests_run.length) {
    for (const t of s.tests_run) lines.push(`- \`${t.command}\` -> ${t.result}`);
  } else {
    lines.push('- See runner validation logs.');
  }
  lines.push('');
  lines.push('## Known Limitations');
  if (s && s.known_limitations.length) for (const k of s.known_limitations) lines.push(`- ${k}`);
  else lines.push('- None reported.');
  lines.push('');
  lines.push('## Follow-Up Tasks');
  if (s && s.followup_tasks.length) for (const f of s.followup_tasks) lines.push(`- ${f}`);
  else lines.push('- None.');
  lines.push('');
  lines.push('## Agent Notes');
  lines.push('Generated by ClaudeGPT runner. See orchestrator run_logs for full trace.');
  return lines.join('\n');
}

// Stub to silence env unused warning if env is later needed at module scope.
export function _envCheck(): void {
  loadEnv();
}
