import type { NormalizedEvent } from '@claudegpt/github';
import type { ProjectConfig } from '@claudegpt/project-registry';

export interface UserCheckResult {
  ok: boolean;
  sender: string | null;
  trustedUsers: string[];
}

/**
 * Verify the sender is in the project's `trustedUsers` list. Comparison is
 * case-insensitive to match GitHub's behavior on login normalization.
 */
export function checkUser(event: NormalizedEvent, project: ProjectConfig): UserCheckResult {
  const sender = event.sender;
  const trusted = project.trustedUsers.map((u) => u.toLowerCase());
  const ok = sender !== null && trusted.includes(sender.toLowerCase());
  return { ok, sender, trustedUsers: project.trustedUsers };
}
