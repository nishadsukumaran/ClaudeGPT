import { Webhooks } from '@octokit/webhooks';
import { loadEnv } from '@claudegpt/shared';

let webhooks: Webhooks | null = null;

function getWebhooks(): Webhooks {
  if (!webhooks) {
    const env = loadEnv();
    webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });
  }
  return webhooks;
}

/**
 * Verify a GitHub webhook payload signature using constant-time HMAC comparison.
 * @param rawBody The raw request body as a string (not parsed JSON).
 * @param signatureHeader The X-Hub-Signature-256 header value (e.g., "sha256=abc...").
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader) return false;
  try {
    return await getWebhooks().verify(rawBody, signatureHeader);
  } catch {
    return false;
  }
}
