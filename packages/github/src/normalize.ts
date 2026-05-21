/**
 * Normalizes inbound GitHub webhook payloads into the minimal shape the orchestrator
 * needs for routing and storage. We only extract what we use.
 */

export interface NormalizedEvent {
  eventType: string;
  deliveryId: string;
  repo: string;
  sender: string | null;
  action: string | null;
  issueNumber: number | null;
  prNumber: number | null;
  labels: string[];
  raw: unknown;
}

interface HeaderLike {
  'x-github-event'?: string | string[];
  'x-github-delivery'?: string | string[];
}

function header(headers: HeaderLike, name: keyof HeaderLike): string {
  const v = headers[name];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export function normalizeEvent(
  headers: HeaderLike,
  payload: Record<string, unknown>,
): NormalizedEvent {
  const eventType = header(headers, 'x-github-event');
  const deliveryId = header(headers, 'x-github-delivery');

  const repository = payload.repository as { full_name?: string } | undefined;
  const sender = (payload.sender as { login?: string } | undefined)?.login ?? null;
  const action = (payload.action as string | undefined) ?? null;

  const issue = payload.issue as { number?: number; labels?: { name: string }[] } | undefined;
  const pr = payload.pull_request as { number?: number; labels?: { name: string }[] } | undefined;

  const labels = (issue?.labels ?? pr?.labels ?? []).map((l) => l.name);

  return {
    eventType,
    deliveryId,
    repo: repository?.full_name ?? '',
    sender,
    action,
    issueNumber: issue?.number ?? null,
    prNumber: pr?.number ?? null,
    labels,
    raw: payload,
  };
}

/** Build the fully-qualified event key (e.g., "issues.labeled.claude-ready"). */
export function eventKey(e: NormalizedEvent, label?: string): string {
  const parts = [e.eventType];
  if (e.action) parts.push(e.action);
  if (label) parts.push(label);
  return parts.join('.');
}
