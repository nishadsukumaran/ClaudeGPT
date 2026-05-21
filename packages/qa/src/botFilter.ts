/**
 * Identifies whether an inbound GitHub event came from the ChatGPT GitHub App
 * bot account.
 *
 * The exact bot login varies by App version. We accept several known patterns
 * plus an override via the CHATGPT_BOT_LOGIN env var. When in doubt, install
 * the ChatGPT GitHub App on a test repo, comment something, look at the
 * `sender.login` in the resulting webhook payload, and add that login here.
 */

const DEFAULT_BOT_LOGINS = new Set<string>([
  'chatgpt[bot]',
  'openai-codex[bot]',
  'gh-chatgpt[bot]',
  'codex[bot]',
]);

export function getKnownBotLogins(): Set<string> {
  const override = process.env.CHATGPT_BOT_LOGIN;
  if (!override) return DEFAULT_BOT_LOGINS;
  const extra = override.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set<string>([...DEFAULT_BOT_LOGINS, ...extra]);
}

export function isChatGptBot(login: string | null | undefined): boolean {
  if (!login) return false;
  return getKnownBotLogins().has(login);
}
