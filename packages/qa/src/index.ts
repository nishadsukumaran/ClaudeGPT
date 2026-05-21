/**
 * @claudegpt/qa
 *
 * QA module for ClaudeGPT — listener pattern.
 *
 * The QA reviewer is the ChatGPT GitHub App (installed on each project repo).
 * ChatGPT auto-reviews PRs and posts comments as itself. This package:
 *   1. Detects when ChatGPT's review arrives (via webhook + botFilter).
 *   2. Parses the prose into a structured verdict via Claude (claudeParser).
 *   3. Applies labels and comments based on the verdict (applyVerdict).
 *   4. Watches for missing reviews and flags them (timeoutWatcher).
 */

export {
  processInboundReview,
  type ProcessInboundReviewArgs,
  type InboundReviewResult,
} from './processInboundReview.js';
export { checkQaTimeout, type TimeoutWatcherArgs } from './timeoutWatcher.js';
export { isChatGptBot, getKnownBotLogins } from './botFilter.js';
export { parseChatGptReview } from './claudeParser.js';
export {
  parseQaResponse,
  QaParseError,
  qaVerdictSchema,
  type QaVerdict,
  type CriticalIssue,
} from './parseResponse.js';
export { applyVerdict, renderVerdictComment, QA_LABELS } from './applyVerdict.js';
