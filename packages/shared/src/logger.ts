import pino from 'pino';
import { loadEnv } from './env.js';

let rootLogger: pino.Logger | null = null;

export function getLogger(name?: string): pino.Logger {
  if (!rootLogger) {
    const env = loadEnv();
    rootLogger = pino({
      level: env.LOG_LEVEL,
      base: { service: 'claudegpt', env: env.NODE_ENV },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          '*.headers.authorization',
          '*.headers["x-hub-signature-256"]',
          '*.GITHUB_APP_PRIVATE_KEY',
          '*.GITHUB_WEBHOOK_SECRET',
          '*.ANTHROPIC_API_KEY',
          '*.OPENAI_API_KEY',
          '*.CLICKUP_API_KEY',
          '*.SLACK_BOT_TOKEN',
          '*.API_BEARER_TOKEN',
          '*.DATABASE_URL',
        ],
        censor: '[REDACTED]',
      },
    });
  }
  return name ? rootLogger.child({ component: name }) : rootLogger;
}
