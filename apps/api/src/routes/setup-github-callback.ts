import type { FastifyInstance } from 'fastify';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('routes.setup.github-callback');

/**
 * GitHub App manifest flow callback.
 *
 * GitHub redirects here after the operator creates a new App via the manifest
 * POST flow. The redirect carries `?code=<temp>` and `?state=<optional>`.
 *
 * This endpoint:
 *   1. Renders a minimal HTML page showing the code with a copy button.
 *   2. Provides a curl one-liner the operator can paste into a shell to
 *      exchange the code for App credentials (ID, PEM, webhook secret).
 *
 * Why not exchange server-side here: keeping the exchange manual means the
 * operator sees the credentials in their own terminal, can paste them into
 * Railway env vars themselves, and we avoid the orchestrator storing the App
 * private key in its own database (we'd never need it there — it lives in env).
 */
export async function registerSetupCallbackRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/v1/setup/github-callback',
    async (req, reply) => {
      const code = req.query.code ?? '';
      const state = req.query.state ?? '';

      log.info({ codePresent: Boolean(code), state }, 'GitHub App manifest callback hit');

      const safeCode = code.replace(/[^A-Za-z0-9_-]/g, '');
      const styles = `
        body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #0f172a; line-height: 1.55; }
        .ok { background: #dcfce7; border: 1px solid #16a34a; padding: 16px 20px; border-radius: 8px; margin: 16px 0; }
        .err { background: #fee2e2; border: 1px solid #dc2626; padding: 16px 20px; border-radius: 8px; margin: 16px 0; }
        code { background: #e2e8f0; padding: 4px 8px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all; }
        pre { background: #0f172a; color: #e2e8f0; padding: 14px 18px; border-radius: 6px; font-size: 13px; overflow-x: auto; }
        button { background: #2563eb; color: #fff; border: 0; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 8px; }
        h1 { font-size: 22px; }
      `;

      if (!safeCode) {
        await reply.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ClaudeGPT setup</title><style>${styles}</style></head><body>
          <h1>No code present</h1>
          <div class="err">This page should have been opened by GitHub's redirect after creating the App. Open <code>setup/github-app-install.html</code> and start over.</div>
        </body></html>`);
        return;
      }

      const exchangeCmd = `curl -sS -X POST -H "Accept: application/vnd.github+json" https://api.github.com/app-manifests/${safeCode}/conversions`;

      await reply.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ClaudeGPT — App created</title><style>${styles}</style></head><body>
        <h1>GitHub App created</h1>
        <div class="ok">
          <strong>Success.</strong> Copy the code below and paste it into the Claude chat — Claude will exchange it for the App credentials and tell you what to set in Railway.
        </div>

        <p><strong>Code:</strong></p>
        <code id="code">${safeCode}</code>
        <br>
        <button onclick="navigator.clipboard.writeText(document.getElementById('code').innerText).then(()=>this.innerText='Copied!')">Copy code</button>

        <p style="margin-top:24px"><strong>Or exchange it yourself with curl:</strong></p>
        <pre>${exchangeCmd}</pre>
        <p style="font-size:13px; color:#64748b">
          The response is JSON with <code>id</code> (App ID), <code>pem</code> (private key), <code>webhook_secret</code>, and more. Codes expire after ~10 minutes and are single-use.
        </p>
      </body></html>`);
    },
  );
}
