# Railway Deploy Runbook

> Deploy ClaudeGPT to Railway in 4 phases. Phase 1 gets a live URL; Phase 2 creates the GitHub App against that URL; Phase 3 installs it on the pilot repo; Phase 4 verifies the loop.

## Prereqs

- Railway account (free tier covers MVP — `railway.com`)
- GitHub account
- Neon DB + Upstash Redis URLs already in your local `.env` (done)
- Webhook secret in `.env` (auto-generated, done)
- The orchestrator repo pushed to a GitHub repo (any visibility — Railway needs the source)

## Phase 1 — Deploy the API service (15 min)

### 1.1 Push the orchestrator repo to GitHub

```bash
cd /path/to/ClaudeGPT
git init
git add -A
git commit -m "Initial ClaudeGPT scaffold"
# Create a GitHub repo (e.g. nishadsukumaran/claudegpt), then:
git remote add origin git@github.com:nishadsukumaran/claudegpt.git
git push -u origin main
```

### 1.2 Create the Railway project

1. Go to railway.com → **New Project** → **Deploy from GitHub repo**
2. Pick `nishadsukumaran/claudegpt`
3. Railway detects the `Dockerfile` and starts a build

### 1.3 Add the env vars

In the Railway service → **Variables** tab, paste these (one per row). Copy values from your local `.env`:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `DATABASE_URL` | `postgresql://neondb_owner:...neon.tech/neondb?sslmode=require` |
| `REDIS_URL` | `rediss://default:...upstash.io:6379` |
| `GITHUB_WEBHOOK_SECRET` | `e9e5df471dd2170bbfc30b20d1362e79e0706ebbe00560e3200c318bab01a84c` |
| `RUNNER_WORKDIR` | `/tmp/claudegpt-runs` |
| `RUNNER_TIMEOUT_MINUTES` | `30` |
| `RUNNER_MAX_CONCURRENT` | `3` |

Leave `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID` blank for now — we'll set them after Phase 2.

### 1.4 Generate a public domain

Railway service → **Settings** → **Networking** → **Generate Domain**. Copy the URL — it looks like `https://claudegpt-production-abc123.up.railway.app`.

### 1.5 Verify the API is alive

```bash
curl https://<your-railway-domain>/health
```

Expected: `{"status":"ok","version":"0.1.0","uptime_seconds":...}`

### 1.6 Add the worker as a second service

1. Inside the same Railway project → **+ New** → **Empty Service**
2. **Service → Settings → Source** — connect to the same GitHub repo
3. **Service → Settings → Deploy → Start Command** — set to `pnpm start:worker`
4. **Variables** — Railway lets you "Reference" the API service's variables. Click each variable, choose **Reference** → pick the API service. This shares values without duplicating.
5. Worker doesn't need a public domain (no inbound traffic). Skip the **Networking** section.

## Phase 2 — Create the GitHub App (5 min)

Now that the API is live, we can use IT as the manifest callback.

### 2.1 Open the install kit

Double-click `setup/github-app-install.html` from your local file explorer.

### 2.2 Fill the form with your Railway URL

- **Callback URL** — `https://<your-railway-domain>/v1/setup/github-callback`
- **App name** — keep default or rename
- **Webhook URL** — `https://<your-railway-domain>/v1/webhooks/github`
- **Install on** — Personal or Org

### 2.3 Click "Create App on GitHub"

GitHub creates the App and redirects to your Railway `/v1/setup/github-callback?code=...` URL. Your API renders a page with:
- The code (with a copy button)
- A curl command to exchange it for credentials

### 2.4 Exchange the code

Paste the curl into your local terminal:

```bash
curl -sS -X POST -H "Accept: application/vnd.github+json" \
  https://api.github.com/app-manifests/<code>/conversions
```

Response is JSON. Save these three fields:

```json
{
  "id": 1234567,
  "pem": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "webhook_secret": "abc..."
}
```

### 2.5 Update Railway variables

Add to BOTH services (or use Reference):

- `GITHUB_APP_ID` = the `id` value
- `GITHUB_APP_PRIVATE_KEY` = the `pem` value (paste the whole PEM, line breaks become `\n` automatically in Railway's UI)
- `GITHUB_WEBHOOK_SECRET` = replace the auto-generated one with the `webhook_secret` GitHub gave you (this is what GitHub uses to sign webhooks)

Railway will auto-redeploy on variable change.

## Phase 3 — Install App on pilot repo (3 min)

### 3.1 Create the pilot repo

```bash
gh repo create nishadsukumaran/claudegpt-pilot --private --add-readme
```

Or via the GitHub UI. Just an empty repo with a README is fine.

### 3.2 Install your App on the pilot repo

1. Go to the App's settings page (URL shown after creation, or `https://github.com/settings/apps/<your-app-slug>`)
2. Left sidebar → **Install App** → click **Install** next to your account
3. Pick **"Only select repositories"** → select `claudegpt-pilot`
4. Click **Install**

### 3.3 Grab the Installation ID

After install, your URL is `https://github.com/settings/installations/<NUMBER>`. Save that number.

### 3.4 Add to Railway

`GITHUB_INSTALLATION_ID` = the number from step 3.3

Railway redeploys.

## Phase 4 — Verify the loop (10 min)

### 4.1 Install ChatGPT GitHub App on the pilot

Per `docs/setup-cli-auth.md` Part B. Pick **claudegpt-pilot** only.

### 4.2 Add the pilot project config

```bash
# Local
cat > projects/claudegpt-pilot.json << 'EOF'
{
  "projectId": "claudegpt-pilot",
  "name": "ClaudeGPT Pilot",
  "githubRepo": "nishadsukumaran/claudegpt-pilot",
  "defaultBranch": "main",
  "branchPrefix": "feature",
  "primaryBuildAgent": "claude-code",
  "qaAgent": "openai",
  "trustedUsers": ["nishadsukumaran"],
  "labels": { ... },
  "commands": { ... }
}
EOF
git add projects/claudegpt-pilot.json
git commit -m "Register pilot project"
git push
```

Railway redeploys with the new project loaded.

### 4.3 Insert the project row in Neon

```sql
INSERT INTO projects (slug, name, github_repo, default_branch)
VALUES ('claudegpt-pilot', 'ClaudeGPT Pilot', 'nishadsukumaran/claudegpt-pilot', 'main');
```

### 4.4 Apply labels to the pilot repo

Use `gh` CLI or the GitHub UI to add the 24 labels from `docs/04-github-labels.md`.

### 4.5 `claude login` in the worker container

Railway worker service → **Settings** → **Shell** (Railway's web shell):

```bash
claude login
```

Follow the OAuth flow. Credentials persist to `/root/.claude/` — **MOUNT A VOLUME THERE** in Railway settings (Volumes tab → mount path `/root/.claude`).

### 4.6 First test issue

In the pilot repo, create an issue using the feature template (`Task 01: Project Setup` body from `docs/09-first-claude-task.md`). Apply the `claude-ready` label.

### 4.7 Watch the logs

In the Railway API service logs and worker logs, you should see:
1. Webhook received
2. Routing → policy → claim → enqueue
3. Worker picks up job, spawns Claude
4. Claude builds, opens PR
5. ChatGPT auto-reviews
6. Listener picks up review, parses, applies labels

## Troubleshooting

**API service can't reach Neon**
Neon connection string requires `sslmode=require`. Already in the URL. If you get TLS errors, check that Railway didn't strip query params from the env var.

**Worker can't connect to Redis**
Same value as API. Upstash uses `rediss://` (double-s, TLS). Common mistake: copying the redis-cli command's `redis://` from Upstash's UI; we need `rediss://`.

**`claude login` doesn't persist across deploys**
Mount a Railway Volume at `/root/.claude` on the worker service. Without this, every deploy wipes the OAuth token.

**Webhook signature verification fails**
The `GITHUB_WEBHOOK_SECRET` in Railway must match the one GitHub stored when the App was created. After Phase 2, the value comes from GitHub's `webhook_secret` field, NOT the random one we generated initially.

**Build fails with "tsx not found"**
Railway's nixpacks might cache an older `package.json`. Force rebuild from the Railway UI: Service → Settings → Redeploy.

**App can't act on PRs in repos other than pilot**
The App is only installed where you selected it. Add more repos via the App settings → Install → Configure.

## What you'll have after Phase 4

- Live API + worker on Railway
- GitHub App that can read/write to pilot repo
- ChatGPT GitHub App auto-reviewing PRs
- Real DB rows in Neon for every event, job, run
- Logs in Railway showing the loop firing
- One real PR opened, reviewed, labeled by the system

That's the end-to-end ship.

## Cost (MVP)

- Railway: free tier ($5/mo credit) covers ~500 hours of API + worker uptime
- Neon: free tier covers MVP scale
- Upstash Redis: free tier covers MVP scale
- Anthropic Claude Max: existing subscription
- ChatGPT Pro: existing subscription
- **Net new cost: $0/mo** until you outgrow free tiers (~50+ PRs/day)
