import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_BEARER_TOKEN: z.string().min(16).optional(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  GITHUB_INSTALLATION_ID: z.string().optional(),

  // LLM auth:
  //   - Builder: Claude Code CLI (`claude` binary), Claude Max OAuth.
  //   - Reviewer: ChatGPT GitHub App (listener pattern — we don't invoke ChatGPT,
  //     we listen for its review comments and parse via Claude).
  // CHATGPT_BOT_LOGIN: comma-separated extras added to the default bot-login allowlist
  //                    used to identify inbound ChatGPT reviews.
  // API keys remain optional escape hatches for CI.
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  CLAUDE_CLI_PATH: z.string().optional(),
  CHATGPT_BOT_LOGIN: z.string().optional(),

  CLICKUP_API_KEY: z.string().optional(),
  CLICKUP_TEAM_ID: z.string().optional(),

  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_NOTIFY_CHANNEL: z.string().optional(),

  RUNNER_WORKDIR: z.string().default('/tmp/claudegpt-runs'),
  RUNNER_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  RUNNER_MAX_CONCURRENT: z.coerce.number().int().positive().default(3),

  SENTRY_DSN: z.string().optional(),
  DATADOG_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: reset the cached env so a re-load picks up new process.env. */
export function resetEnvCache(): void {
  cached = null;
}
