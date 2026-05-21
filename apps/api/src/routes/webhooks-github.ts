import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyWebhookSignature, normalizeEvent } from '@claudegpt/github';
import { getDb, schema } from '@claudegpt/db';
import { getRegistry } from '@claudegpt/project-registry';
import { routeEvent } from '@claudegpt/routing';
import { getLogger, errInvalidSignature } from '@claudegpt/shared';
import { eq } from 'drizzle-orm';

const log = getLogger('webhooks.github');

type WebhookRequest = FastifyRequest<{ Body: Record<string, unknown> }> & {
  rawBody?: string;
};

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/webhooks/github', async (req, reply) => {
    const r = req as WebhookRequest;
    const signature = (req.headers['x-hub-signature-256'] as string | undefined) ?? '';
    const rawBody = r.rawBody ?? '';

    const valid = await verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      log.warn({ headers: req.headers }, 'Webhook signature verification failed');
      throw errInvalidSignature({ delivery_id: req.headers['x-github-delivery'] });
    }

    const normalized = normalizeEvent(req.headers as Record<string, string>, r.body ?? {});
    log.info(
      {
        event: normalized.eventType,
        action: normalized.action,
        repo: normalized.repo,
        sender: normalized.sender,
        delivery_id: normalized.deliveryId,
      },
      'GitHub webhook received',
    );

    // Dedup on delivery_id (unique constraint on github_events.delivery_id)
    const db = getDb();
    const existing = await db
      .select({ id: schema.githubEvents.id })
      .from(schema.githubEvents)
      .where(eq(schema.githubEvents.deliveryId, normalized.deliveryId))
      .limit(1);

    if (existing.length > 0) {
      return reply.status(200).send({ deduped: true, delivery_id: normalized.deliveryId });
    }

    // Resolve project. Unknown repos are accepted (200) but logged + ignored.
    const project = getRegistry().getByRepo(normalized.repo);
    if (!project) {
      log.warn({ repo: normalized.repo }, 'Webhook for unregistered repo; ignoring.');
      // Still store the event for audit (project_id stays NULL conceptually — handled by the row not having a project link).
      await db.insert(schema.githubEvents).values({
        eventType: normalized.eventType,
        deliveryId: normalized.deliveryId,
        repo: normalized.repo,
        sender: normalized.sender,
        payloadJson: normalized.raw as Record<string, unknown>,
      });
      return reply.status(200).send({ ignored: 'unknown_repo' });
    }

    const [inserted] = await db
      .insert(schema.githubEvents)
      .values({
        eventType: normalized.eventType,
        deliveryId: normalized.deliveryId,
        repo: normalized.repo,
        sender: normalized.sender,
        payloadJson: normalized.raw as Record<string, unknown>,
      })
      .returning({ id: schema.githubEvents.id });

    log.info({ event_id: inserted?.id, project: project.projectId }, 'Webhook event stored.');

    // Fire-and-forget: route the event through policy → claim → enqueue.
    // We do NOT await — the webhook response stays fast (<200ms target) and the
    // routing pipeline owns its own error handling + run-log writes.
    if (inserted?.id) {
      const eventId = inserted.id;
      void routeEvent(eventId).catch((err) => {
        log.error({ err, event_id: eventId }, 'routeEvent failed.');
      });
    }

    return reply.status(202).send({
      accepted: true,
      event_id: inserted?.id,
      delivery_id: normalized.deliveryId,
    });
  });
}
