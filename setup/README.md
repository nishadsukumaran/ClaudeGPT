# ClaudeGPT — GitHub App install kit

One-time setup. Five minutes total. Creates the orchestrator's GitHub App via the manifest flow so you don't fill 12 fields by hand.

## What you'll end up with

- A GitHub App named `ClaudeGPT Orchestrator (Nishad)` (or whatever you change it to)
- App installed on your pilot repo
- `.env` populated with `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
- One value to grab manually: `GITHUB_INSTALLATION_ID` (5 sec after install)

## Steps

### 1. Open the install page locally

Double-click `setup/github-app-install.html` from your file explorer. It opens in your default browser.

### 2. Fill the form

- **App name** — keep the default or rename. Must be globally unique on GitHub.
- **Webhook URL** — leave the placeholder `https://orchestrator.example.com/...` for now. You'll edit it in App settings after you deploy. (Alternatively, set up a [smee.io](https://smee.io/) channel for local testing — paste that URL here.)
- **Install on** — Personal account (default) or Organization.

### 3. Click "Create App on GitHub"

You'll be POSTed to GitHub. GitHub creates the App and redirects to `github-app-callback.html` with a `?code=...` in the URL.

### 4. Copy the code

The callback page shows the code with a one-click "Copy to clipboard" button. Paste the code into the Claude chat. Tell Claude: **"Here's the App code: `<paste>`"**

Claude will run:

```bash
cd setup
./exchange-code.sh <code> | ./fill-env.sh
```

That writes `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` to `.env`.

### 5. Install the App on your pilot repo

GitHub showed you the App after creation. Click **"Install App"** in the App's settings page (or visit `https://github.com/apps/<your-app-slug>/installations/new`).

- Pick **"Only select repositories"**
- Select your `claudegpt-pilot` repo
- Click Install

### 6. Grab the Installation ID

After install, your URL is something like:

```
https://github.com/settings/installations/12345678
```

The number at the end is your `GITHUB_INSTALLATION_ID`. Paste it to Claude:

> **"Installation ID is 12345678"**

Claude updates `.env`.

### 7. Verify

```bash
grep ^GITHUB_ .env
```

You should see four lines with values, none blank.

## Troubleshooting

**"The redirect_url doesn't match" or similar from GitHub**
The HTML form sets the redirect to `github-app-callback.html` based on your current URL. If you moved files around, edit `github-app-install.html` line where `redirect_url` is set.

**App name already taken**
Append your handle or a number. `ClaudeGPT Orchestrator (Nishad-v2)` etc.

**Code expired**
The temp code is single-use and lives ~10 minutes. If you wait too long, start over from step 1. The App that got created in your attempted run stays — you can delete it from GitHub settings or reuse it.

**Behind a corporate firewall / private GitHub Enterprise**
Edit `github-app-install.html` and `exchange-code.sh` to point at your GHE domain (`https://github.your-company.com/...`).

## What ends up in .env

```
GITHUB_APP_ID=<6-7 digit number>
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n
GITHUB_WEBHOOK_SECRET=<random 40-char string GitHub generated>
GITHUB_INSTALLATION_ID=<7-8 digit number>
```

All four are needed before the orchestrator can authenticate against GitHub.
