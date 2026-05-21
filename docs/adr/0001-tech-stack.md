# ADR 0001 — Tech Stack

**Status:** Accepted
**Date:** 2026-05-15
**Decision-maker:** Nishad

## Context

ClaudeGPT is a Node service that receives GitHub webhooks, enqueues agent jobs, runs Claude Code in isolated workspaces, calls OpenAI for QA, and syncs ClickUp. The architecture doc allows for flexibility ("Next.js or Node.js API service"); this ADR pins concrete choices so packages stay consistent.

## Decision

| Layer | Choice | Why |
|-------|--------|-----|
| Package manager | **pnpm** | Workspace-native, fast, deterministic; standard for Node monorepos |
| Project structure | **pnpm monorepo** with `apps/*` and `packages/*` | Clear separation of services vs reusable libs |
| Language | **TypeScript 5+** in strict mode | Type safety across the agent contract surface |
| API framework | **Fastify 4+** | Faster than Express, lighter than Next.js for an API-only service, JSON Schema validation built in |
| ORM / SQL | **Drizzle ORM** | TypeScript-native, no codegen step, schema is just TS, plays well with Neon |
| Migrations | **Drizzle Kit** | Same toolchain as ORM, generates migration files from schema diff |
| Database | **Postgres on Neon** | Already connected in Cowork, serverless, branching for safe ops |
| Queue | **BullMQ on Redis** (Upstash) | Proven for Node, retries + delayed jobs + priorities out of the box |
| Logger | **pino** | Fast structured JSON logging, plays well with Fastify |
| Validation | **zod** | Schema validation for inbound payloads, env vars, project config |
| Webhook verify | **@octokit/webhooks** | Official lib, constant-time HMAC, event type guards |
| GitHub client | **@octokit/rest** + **@octokit/auth-app** | Official, app-auth aware |
| OpenAI client | **openai** (official SDK) | Standard |
| Anthropic client | **@anthropic-ai/sdk** | Standard |
| ClickUp client | **HTTP via undici** | No official Node SDK worth using; ClickUp API is simple REST |
| Test runner | **Vitest** | Fast, native TS, Jest-compatible API |
| Lint | **ESLint** + `@typescript-eslint` | Standard |
| Format | **Prettier** | Standard |
| Process management | **tsx** for dev, **node --enable-source-maps** for prod | Avoids ts-node/swc complexity |

## Repo layout

```
ClaudeGPT/
  apps/
    api/                 Fastify HTTP server (webhooks, routes)
    worker/              BullMQ worker processes (jobs, runner)
  packages/
    db/                  Drizzle schema, migrations, query helpers
    shared/              Cross-cutting types, logger, env, errors
    github/              Webhook verification + GitHub API client
    queue/               BullMQ connection + queue definitions
    project-registry/    Loads projects/*.json, validates, exposes lookup
  projects/              Per-project JSON configs (one file per project)
  docs/                  Architecture, PRD, ADRs
  agents/                Agent definitions
  hooks/                 Executable hook scripts
  plugins/               Reusable Claude Code plugin
```

## Why these specific choices

**Fastify over Next.js** — ClaudeGPT is an API + worker, not a UI. Next.js carries weight (React, routing, RSC) we don't need. Fastify is the lean choice and avoids the cold-start tax on serverless platforms.

**Drizzle over Prisma** — Prisma's codegen step adds friction (every schema change → regenerate). Drizzle keeps the schema as TypeScript, which is easier to diff in PRs and easier for the orchestrator to introspect at runtime if needed.

**Postgres over Mongo / Supabase exclusively** — We need strong relations between jobs, runs, mappings. Postgres is the right shape. Supabase is available as a fallback but Neon's branching makes safer migrations.

**BullMQ over Temporal / SQS** — Temporal is overkill for MVP scale. SQS adds a cloud dep. BullMQ on Redis is well-trodden, fast, and matches the architecture doc's call.

**pnpm over npm/yarn** — Workspace performance and disk usage. Yarn classic is dying; yarn berry is unfamiliar to most. npm workspaces work but are slower.

## Trade-offs accepted

- **Drizzle is younger than Prisma.** Some advanced features (e.g., nested transactions, complex relations) are less ergonomic. Acceptable for our schema shape.
- **Fastify ecosystem is smaller than Express.** Most plugins we need (jwt, helmet, rate-limit, multipart) exist; if a critical plugin is missing later, write it (Fastify plugins are 30 lines).
- **No ORM for queue state.** BullMQ state lives in Redis; we mirror to Postgres via the queue's `events` emitter rather than a single ORM. Two stores, but each is the right tool.
- **pnpm requires installation outside npm.** Trivial: `npm i -g pnpm` or via corepack.

## Rejected alternatives

- **Express** — Battle-tested but slower, no built-in schema validation, weaker TS story.
- **NestJS** — Too much framework for a service this size. Decorators and DI add ceremony without payoff at this scale.
- **Prisma** — Codegen friction.
- **Knex / raw SQL** — Loses type safety we want at the agent contract boundary.
- **Cloud Tasks / SQS / Temporal** — Vendor lock-in or operational weight not justified at MVP.

## Revisit triggers

This ADR should be re-opened when:

- We hit > 50 RPS sustained on the webhook endpoint (Fastify still fine; mention because it's a milestone).
- Drizzle blocks a query we genuinely need (raw SQL escape hatch covers most cases).
- BullMQ retry/visibility limits start hurting (would consider Temporal at that point).
- We add a customer-facing UI (consider Next.js for that surface only, kept separate from the API).
