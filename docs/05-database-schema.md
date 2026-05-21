# Database Schema

> Postgres schema for ClaudeGPT. Designed for Neon (serverless Postgres) but works on any Postgres 14+. UUID PKs everywhere. Timestamps in UTC with timezone.

## 1. Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

## 2. Enums

```sql
CREATE TYPE project_status   AS ENUM ('active', 'paused', 'archived');
CREATE TYPE agent_type       AS ENUM ('builder', 'reviewer', 'sync', 'release');
CREATE TYPE agent_provider   AS ENUM ('anthropic', 'openai', 'internal');
CREATE TYPE agent_status     AS ENUM ('enabled', 'disabled');
CREATE TYPE job_type         AS ENUM (
  'claude_implement_issue',
  'claude_rework_pr',
  'openai_qa_review',
  'clickup_sync',
  'vercel_deploy_check',
  'neon_migration_review',
  'release_prep'
);
CREATE TYPE job_status       AS ENUM ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled');
CREATE TYPE run_status       AS ENUM ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'killed');
CREATE TYPE mapping_status   AS ENUM ('open', 'in_progress', 'qa', 'rework', 'approved', 'merged', 'closed', 'blocked');
CREATE TYPE log_level        AS ENUM ('debug', 'info', 'warn', 'error');
CREATE TYPE violation_type   AS ENUM (
  'unknown_repo',
  'untrusted_user',
  'invalid_label',
  'missing_acceptance',
  'blocked_task_type',
  'already_claimed',
  'limit_exceeded'
);
```

## 3. Tables

### 3.1 `projects`

```sql
CREATE TABLE projects (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  github_repo       TEXT NOT NULL UNIQUE,
  clickup_folder_id TEXT,
  default_branch    TEXT NOT NULL DEFAULT 'main',
  status            project_status NOT NULL DEFAULT 'active',
  config_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_status      ON projects(status);
CREATE INDEX idx_projects_github_repo ON projects(github_repo);
```

`config_json` matches the schema in `docs/08-project-config-schema.md`.

### 3.2 `agents`

```sql
CREATE TABLE agents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  type        agent_type NOT NULL,
  provider    agent_provider NOT NULL,
  status      agent_status NOT NULL DEFAULT 'enabled',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seed rows:

| name | type | provider |
|------|------|----------|
| `claude-code` | builder | anthropic |
| `openai-qa` | reviewer | openai |
| `clickup-sync` | sync | internal |

### 3.3 `agent_jobs`

```sql
CREATE TABLE agent_jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  agent_id              UUID NOT NULL REFERENCES agents(id)   ON DELETE RESTRICT,
  job_type              job_type NOT NULL,
  status                job_status NOT NULL DEFAULT 'queued',
  priority              INT NOT NULL DEFAULT 100,
  github_repo           TEXT NOT NULL,
  github_issue_number   INT,
  github_pr_number      INT,
  clickup_task_id       TEXT,
  payload_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status         ON agent_jobs(status);
CREATE INDEX idx_jobs_project_status ON agent_jobs(project_id, status);
CREATE INDEX idx_jobs_issue          ON agent_jobs(github_repo, github_issue_number);
CREATE INDEX idx_jobs_pr             ON agent_jobs(github_repo, github_pr_number);
CREATE INDEX idx_jobs_created        ON agent_jobs(created_at DESC);
```

### 3.4 `agent_runs`

```sql
CREATE TABLE agent_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  status          run_status NOT NULL DEFAULT 'queued',
  branch_name     TEXT,
  commit_sha      TEXT,
  pr_number       INT,
  prompt_snapshot TEXT,
  result_summary  TEXT,
  error_message   TEXT,
  token_usage     INT,
  cost_usd        NUMERIC(10, 4),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_job_id  ON agent_runs(job_id);
CREATE INDEX idx_runs_status  ON agent_runs(status);
CREATE INDEX idx_runs_created ON agent_runs(created_at DESC);
```

Note: A single job may produce multiple runs (retries). The latest run determines current state.

### 3.5 `github_events`

```sql
CREATE TABLE github_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type    TEXT NOT NULL,
  delivery_id   TEXT NOT NULL UNIQUE,
  repo          TEXT NOT NULL,
  sender        TEXT,
  payload_json  JSONB NOT NULL,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_repo_type ON github_events(repo, event_type);
CREATE INDEX idx_events_processed ON github_events(processed_at);
CREATE INDEX idx_events_created   ON github_events(created_at DESC);
```

`delivery_id` is `X-GitHub-Delivery` header. Unique constraint = idempotent webhooks.

### 3.6 `github_issue_mappings`

```sql
CREATE TABLE github_issue_mappings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo                TEXT NOT NULL,
  issue_number        INT  NOT NULL,
  clickup_task_id     TEXT,
  latest_job_id       UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,
  status              mapping_status NOT NULL DEFAULT 'open',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo, issue_number)
);

CREATE INDEX idx_issue_map_project ON github_issue_mappings(project_id);
CREATE INDEX idx_issue_map_status  ON github_issue_mappings(status);
```

### 3.7 `github_pr_mappings`

```sql
CREATE TABLE github_pr_mappings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo                TEXT NOT NULL,
  pr_number           INT  NOT NULL,
  issue_number        INT,
  latest_qa_run_id    UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  status              mapping_status NOT NULL DEFAULT 'open',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo, pr_number)
);

CREATE INDEX idx_pr_map_project ON github_pr_mappings(project_id);
CREATE INDEX idx_pr_map_status  ON github_pr_mappings(status);
CREATE INDEX idx_pr_map_issue   ON github_pr_mappings(repo, issue_number);
```

### 3.8 `clickup_mappings`

```sql
CREATE TABLE clickup_mappings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_repo         TEXT NOT NULL,
  github_issue_number INT,
  github_pr_number    INT,
  clickup_task_id     TEXT NOT NULL,
  clickup_list_id     TEXT,
  status              mapping_status NOT NULL DEFAULT 'open',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clickup_map_task    ON clickup_mappings(clickup_task_id);
CREATE INDEX idx_clickup_map_issue   ON clickup_mappings(github_repo, github_issue_number);
CREATE INDEX idx_clickup_map_pr      ON clickup_mappings(github_repo, github_pr_number);
```

### 3.9 `run_logs`

```sql
CREATE TABLE run_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id        UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  level         log_level NOT NULL DEFAULT 'info',
  source        TEXT NOT NULL,
  message       TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_run_logs_run_id  ON run_logs(run_id);
CREATE INDEX idx_run_logs_level   ON run_logs(level);
CREATE INDEX idx_run_logs_created ON run_logs(created_at DESC);
```

`source` examples: `webhook`, `policy`, `runner.git`, `runner.claude`, `runner.tests`, `qa.openai`, `clickup.sync`.

### 3.10 `policy_violations`

```sql
CREATE TABLE policy_violations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  repo            TEXT NOT NULL,
  issue_number    INT,
  pr_number       INT,
  violation_type  violation_type NOT NULL,
  reason          TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_violations_type    ON policy_violations(violation_type);
CREATE INDEX idx_violations_project ON policy_violations(project_id);
CREATE INDEX idx_violations_created ON policy_violations(created_at DESC);
```

### 3.11 `task_claims`

```sql
CREATE TABLE task_claims (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo            TEXT NOT NULL,
  issue_number    INT NOT NULL,
  job_id          UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at    TIMESTAMPTZ,
  UNIQUE(repo, issue_number)
);
```

The `UNIQUE(repo, issue_number)` constraint is the lock. Two concurrent webhooks for the same issue: one inserts, one fails. The failed one logs `already_claimed` to `policy_violations` and exits.

## 4. Update Triggers

Auto-bump `updated_at` on row updates:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_issue_map_updated_at
  BEFORE UPDATE ON github_issue_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pr_map_updated_at
  BEFORE UPDATE ON github_pr_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_clickup_map_updated_at
  BEFORE UPDATE ON clickup_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## 5. Useful Views

### 5.1 Active jobs

```sql
CREATE VIEW v_active_jobs AS
SELECT
  j.id,
  p.slug AS project,
  a.name AS agent,
  j.job_type,
  j.status,
  j.github_repo,
  j.github_issue_number,
  j.github_pr_number,
  j.created_at,
  j.started_at
FROM agent_jobs j
JOIN projects p ON p.id = j.project_id
JOIN agents   a ON a.id = j.agent_id
WHERE j.status IN ('queued', 'running');
```

### 5.2 Latest run per job

```sql
CREATE VIEW v_latest_runs AS
SELECT DISTINCT ON (r.job_id)
  r.*
FROM agent_runs r
ORDER BY r.job_id, r.created_at DESC;
```

### 5.3 QA pass rate

```sql
CREATE VIEW v_qa_stats AS
SELECT
  p.slug AS project,
  COUNT(*) FILTER (WHERE r.status = 'succeeded') AS passed,
  COUNT(*) FILTER (WHERE r.status = 'failed')    AS failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE r.status = 'succeeded')
    / NULLIF(COUNT(*), 0),
    1
  ) AS pass_rate_pct
FROM agent_runs r
JOIN agent_jobs j ON j.id = r.job_id
JOIN projects   p ON p.id = j.project_id
WHERE j.job_type = 'openai_qa_review'
GROUP BY p.slug;
```

## 6. Retention

Default retention (override per-project later if needed):

| Table | Retention | How |
|-------|-----------|-----|
| `github_events` | 90 days | Daily cron delete `created_at < now() - interval '90 days'` |
| `run_logs` | 60 days | Daily cron delete |
| `agent_runs` | Keep forever (audit) | No deletion |
| `agent_jobs` | Keep forever (audit) | No deletion |
| `policy_violations` | Keep forever | No deletion |
| `task_claims` | Cleared on release | Set `released_at` on job completion |

## 7. Migrations

Use a real migrations tool. Recommended: Drizzle, Prisma, or node-pg-migrate. Each migration file lives in `apps/api/migrations/` and is numbered.

First three migrations:

1. `0001_init_enums.sql` - all enums above
2. `0002_init_tables.sql` - all tables and indexes
3. `0003_init_triggers_views.sql` - triggers and views

## 8. Performance Notes

- `agent_jobs` is the hot table. The `(project_id, status)` and `(github_repo, github_issue_number)` indexes cover the most common queries.
- `run_logs` will grow fast. Partition by month if it crosses ~10M rows.
- `github_events.payload_json` can be large (50-200 KB per event). Consider moving payloads to object storage and keeping only a reference once we cross 1M events.
- All `JSONB` columns benefit from GIN indexes only when actually filtered. Default to no GIN until a real query proves the need.

## 9. Security

- No PII expected in any table.
- `prompt_snapshot` in `agent_runs` may include issue text, which could include sensitive specs. Treat it as confidential.
- DB access from runners: read-only on `projects`, `agents`. Read-write on `agent_jobs`, `agent_runs`, `run_logs`, `task_claims`. No access to other tables.
- Production DB never accessible to Claude Code runner workspaces.
