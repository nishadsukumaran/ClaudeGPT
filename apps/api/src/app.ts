import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { getLogger } from '@claudegpt/shared';
import { AppError } from '@claudegpt/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerWebhookRoutes } from './routes/webhooks-github.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerSetupCallbackRoute } from './routes/setup-github-callback.js';

const log = getLogger('api.app');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: log as unknown as import('fastify').FastifyServerOptions['logger'],
    bodyLimit: 5 * 1024 * 1024, // 5 MB - GitHub webhooks can be chunky
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
    genReqId: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    // Exempt webhook endpoints; they have their own validation.
    skipOnError: false,
    allowList: (req) => req.url.startsWith('/v1/webhooks/'),
  });

  // Capture the raw body for HMAC verification on webhooks.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body: string, done) => {
      try {
        (req as unknown as { rawBody: string }).rawBody = body;
        done(null, body.length ? JSON.parse(body) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      void reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message, details: err.details },
        request_id: req.id,
      });
      return;
    }
    // Fastify validation error
    if ((err as { statusCode?: number }).statusCode === 400) {
      void reply.status(400).send({
        error: { code: 'validation_failed', message: err.message },
        request_id: req.id,
      });
      return;
    }
    req.log.error({ err }, 'Unhandled error');
    void reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error.' },
      request_id: req.id,
    });
  });

  await registerHealthRoutes(app);
  await registerWebhookRoutes(app);
  await registerProjectRoutes(app);
  await registerJobRoutes(app);
  await registerSetupCallbackRoute(app);

  return app;
}
