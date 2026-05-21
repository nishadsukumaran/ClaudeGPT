/**
 * Maps trigger event strings emitted by the orchestrator to ClickUp status
 * names. Default mapping comes from agents/sync.md §"Status mapping". Each
 * project can override via `project.metadata.clickup_status_map`, which is a
 * plain Record<string, string> stored on `projects.config_json.metadata`.
 *
 * Event-string convention (matches webhook router + agents/sync.md frontmatter):
 *   issue.labeled.<label>           e.g. issue.labeled.claude-ready
 *   pull_request.opened
 *   pull_request.labeled.<label>    e.g. pull_request.labeled.openai-approved
 *   pull_request.closed.merged      (we distinguish merged from plain closed)
 */

export const DEFAULT_STATUS_MAP: Record<string, string> = {
  'issue.labeled.claude-ready': 'Ready for Claude Build',
  'issue.labeled.claude-claimed': 'In Claude Build',
  'pull_request.opened': 'OpenAI QA Review',
  'pull_request.labeled.openai-approved': 'Build Complete',
  'pull_request.labeled.claude-rework': 'Rework',
  'issue.labeled.blocked': 'Blocked',
  'issue.labeled.needs-nishad': 'Nishad Actions & Setup Inputs',
  'pull_request.closed.merged': 'Released',
};

/**
 * Pull a project-level override map out of `project.metadata`, returning an
 * empty object if it's missing, malformed, or contains non-string values.
 * We never throw here — a bad override should not break sync.
 */
function readOverrides(projectMetadata?: Record<string, unknown>): Record<string, string> {
  if (!projectMetadata) return {};
  const raw = projectMetadata['clickup_status_map'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Resolve a trigger event to a target ClickUp status name.
 *
 * Returns null when the event is not in the map. Sync.ts treats null as
 * "no status change required" — comment-only sync.
 */
export function resolveStatus(
  triggerEvent: string,
  projectMetadata?: Record<string, unknown>,
): string | null {
  const overrides = readOverrides(projectMetadata);
  if (Object.prototype.hasOwnProperty.call(overrides, triggerEvent)) {
    return overrides[triggerEvent] ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_STATUS_MAP, triggerEvent)) {
    return DEFAULT_STATUS_MAP[triggerEvent] ?? null;
  }
  return null;
}
