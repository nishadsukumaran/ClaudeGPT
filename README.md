# ClaudeGPT

Middleware platform that coordinates AI-assisted software delivery across multiple projects.

Connects GitHub, ClickUp, Claude Code, OpenAI, Vercel, and Neon into one controlled delivery loop:

```
Spec -> Issue -> Claude Build -> PR -> OpenAI QA -> Approval -> Release
```

## Status

Phase 1 in progress. Foundation docs locked, plugins/hooks/agents scaffolded, monorepo + Fastify API + Drizzle schema + BullMQ queues + project registry now code-complete. Worker has stubs ready for Phase 3 runner logic. Next: install deps, generate first migration, run end-to-end against the pilot repo.

## Repository Layout

```
ClaudeGPT/
  apps/
    api/                             Fastify HTTP service (webhooks, routes)
    worker/                          BullMQ worker process (jobs, runner)
  packages/
    db/                              Drizzle schema, migrations, query helpers
    shared/                          Logger, env, errors, cross-cutting types
    github/                          Webhook verification + Octokit client
    queue/                           BullMQ connection + queue factory
    project-registry/                Loads projects/*.json, validates with zod
  projects/                          Per-project JSON configs (gitignored values)
  docs/                              Architecture, PRD, schemas, specs, ADRs
  agents/                            Agent definitions (canonical)
  hooks/                             Executable hook scripts (canonical)
  plugins/claudegpt-policy/          Reusable Claude Code plugin
  .github/ISSUE_TEMPLATE/            Issue templates
  .env.example                       Environment template
  package.json                       Monorepo root (pnpm workspaces)
  pnpm-workspace.yaml
  tsconfig.base.json
```

## Documents

| # | Document | Purpose |
|---|----------|---------|
| 00 | [Architecture](docs/00-architecture.md) | Full solution architecture |
| 01 | [MVP PRD](docs/01-mvp-prd.md) | Product requirements for the MVP |
| 02 | [Agent Policy](docs/02-agent-policy.md) | Hard rules for all agents |
| 03 | [CLAUDE.md Template](docs/03-claude-md-template.md) | Per-project Claude context file |
| 04 | [Label Setup Plan](docs/04-github-labels.md) | GitHub labels and lifecycle |
| 05 | [Database Schema](docs/05-database-schema.md) | Postgres schema |
| 06 | [API Specification](docs/06-api-specification.md) | HTTP endpoint contract |
| 07 | [Worker Job Spec](docs/07-worker-jobs.md) | Job types and lifecycle |
| 08 | [Project Config Schema](docs/08-project-config-schema.md) | Per-project config shape |
| 09 | [First Claude Task](docs/09-first-claude-task.md) | Task 01: Project Setup |
| 10 | [Plugins, Hooks, Agents](docs/10-plugins-hooks-agents.md) | Layered automation architecture |
| ADR | [0001-tech-stack](docs/adr/0001-tech-stack.md) | Tech stack decision |

## Getting Started

### Prerequisites

- Node 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Postgres (Neon connection string works)
- Redis (Upstash or local)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill in real values
cp .env.example .env
# Edit .env — at minimum: DATABASE_URL, REDIS_URL, GITHUB_WEBHOOK_SECRET

# 3. Generate the first Drizzle migration from the schema
pnpm db:generate

# 4. Apply migrations to your DB
pnpm db:migrate

# 5. Start API (port 3000 by default)
pnpm dev

# 6. In another terminal, start the worker
pnpm dev:worker

# Verify
curl http://localhost:3000/health
curl http://localhost:3000/v1/ready
```

### Scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run API in watch mode |
| `pnpm dev:worker` | Run worker process in watch mode |
| `pnpm build` | Build every package and app |
| `pnpm lint` | Lint everything |
| `pnpm typecheck` | Type-check everything |
| `pnpm test` | Run all Vitest suites |
| `pnpm db:generate` | Generate migration SQL from schema diff |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm format` | Prettier write |

## Agents

Five role-separated agents under [`agents/`](agents/):

| Agent | Provider | Role |
|-------|----------|------|
| [`claude-builder`](agents/builder.md) | Anthropic | Implements issues into PRs |
| [`openai-reviewer`](agents/reviewer.md) | OpenAI | QA reviews Claude PRs |
| [`claude-rework`](agents/rework.md) | Anthropic | Applies QA feedback |
| [`clickup-sync`](agents/sync.md) | Internal (no LLM) | Mirrors state to ClickUp |
| [`release-prep`](agents/release.md) | OpenAI (future) | Release notes and tagging |

## Hooks

Seven lifecycle hooks under [`hooks/`](hooks/) intercept every agent action. See [hooks/README.md](hooks/README.md) for the stdin/stdout contract.

`pre-execution -> pre-edit -> post-edit -> pre-commit -> pre-push -> pre-pr -> post-pr`

## Claude Code Plugin

[`plugins/claudegpt-policy/`](plugins/claudegpt-policy/) is the reusable plugin installed into every target repo. Bundles the hooks, slash commands, agent presets, and policy data files.

## Cowork Connectors

| Connector | Status | Why |
|-----------|--------|-----|
| Neon | connected | Orchestrator DB |
| Supabase | connected | DB alternative |
| Vercel | connected | API service deployment |
| ClickUp | connected | Dashboard sync |
| Slack | connected | Run notifications |

GitHub does not need an MCP connector — the orchestrator authenticates via a GitHub App from its own service.

## Owner

Nishad Sukumaran
