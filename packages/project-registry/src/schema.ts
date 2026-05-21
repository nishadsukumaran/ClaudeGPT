import { z } from 'zod';

/**
 * Zod schema for per-project config. Mirrors docs/08-project-config-schema.md.
 */

const labelsSchema = z.object({
  ready: z.string().min(1),
  claimed: z.string().min(1),
  inProgress: z.string().min(1),
  complete: z.string().min(1),
  qa: z.string().min(1),
  approved: z.string().min(1),
  rework: z.string().min(1),
  blocked: z.string().min(1),
  needsOwner: z.string().min(1),
  doNotRun: z.string().min(1),
  securityReview: z.string().min(1),
  databaseReview: z.string().min(1),
  releaseReady: z.string().min(1),
});

const commandsSchema = z.object({
  install: z.string().min(1),
  lint: z.string().min(1),
  typecheck: z.string().min(1),
  test: z.string().min(1),
  build: z.string().min(1),
  dev: z.string().optional(),
  format: z.string().optional(),
  migrate: z.string().nullable().optional(),
  seed: z.string().nullable().optional(),
});

const pathsSchema = z
  .object({
    agentPolicy: z.string().default('.claudegpt/agent-policy.md'),
    claudeGuide: z.string().default('CLAUDE.md'),
    tests: z.string().optional(),
    src: z.string().optional(),
    protected: z.array(z.string()).default([]),
  })
  .default({
    agentPolicy: '.claudegpt/agent-policy.md',
    claudeGuide: 'CLAUDE.md',
    protected: [],
  });

const limitsSchema = z
  .object({
    maxRunMinutes: z.number().int().positive().max(120).default(30),
    maxQaMinutes: z.number().int().positive().max(30).default(5),
    maxTokens: z.number().int().positive().default(200_000),
    maxFiles: z.number().int().positive().default(25),
    maxLines: z.number().int().positive().default(1500),
    maxCostUsd: z.number().positive().default(5),
    concurrentRuns: z.number().int().positive().default(1),
  })
  .default({});

const deploymentSchema = z
  .object({
    provider: z.enum(['vercel', 'railway', 'render', 'fly', 'self']).optional(),
    projectId: z.string().optional(),
    previewBranches: z.boolean().optional(),
    productionBranch: z.string().optional(),
    smokeTestUrl: z.string().url().optional(),
  })
  .optional();

export const projectConfigSchema = z.object({
  projectId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, 'projectId must be kebab-case'),
  name: z.string().min(1),
  githubRepo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'githubRepo must be owner/repo'),
  clickupFolderId: z.string().nullable().optional(),
  defaultBranch: z.string().min(1),
  branchPrefix: z.string().min(1),
  primaryBuildAgent: z.literal('claude-code'),
  qaAgent: z.literal('openai'),
  trustedUsers: z.array(z.string().min(1)).min(1),
  labels: labelsSchema,
  commands: commandsSchema,
  paths: pathsSchema,
  trustedTriggerLabel: z.string().default('claude-ready'),
  allowedTaskTypes: z.array(z.string()).optional(),
  blockedTaskTypes: z.array(z.string()).optional(),
  limits: limitsSchema,
  deployment: deploymentSchema,
  metadata: z.record(z.unknown()).optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
