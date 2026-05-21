import type { FastifyRequest, FastifyReply } from 'fastify';
import { loadEnv, errUnauthorized } from '@claudegpt/shared';

/**
 * Minimal bearer-token check for internal endpoints.
 * MVP: a single shared token from env. Production: per-user/scoped tokens.
 */
export async function requireBearer(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const env = loadEnv();
  if (!env.API_BEARER_TOKEN) {
    // No token configured = dev mode, allow.
    if (env.NODE_ENV === 'development') return;
    throw errUnauthorized('Server has no API_BEARER_TOKEN configured.');
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw errUnauthorized();
  const token = auth.slice('Bearer '.length).trim();
  // Constant-time compare
  if (!constantTimeEqual(token, env.API_BEARER_TOKEN)) throw errUnauthorized();
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
