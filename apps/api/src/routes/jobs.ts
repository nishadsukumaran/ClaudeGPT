import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, schema } from '@claudegpt/db';
import { errJobNotFound, errJobTerminal } from '@claudegpt/shared';
import { and, desc, eq } from 'drizzle-orm';
import { requireBearer } from '../middleware/auth.js';

const ListQuery = z.object({
  status: z.string().optional(),
  job_type: z.string().optional(),
  repo: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const TERMINAL: Array<typeof schema.agentJobs.$inferSelect.status> = [
  'succeeded',
  'failed',
  'cancelled',
];

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/jobs', { preHandler: requireBearer }, async (req) => {
    const q = ListQuery.parse(req.query);
    const db = getDb();

    const rawConditions = [
      q.status ? eq(schema.agentJobs.status, q.status as typeof schema.agentJobs.$inferSelect.status) : null,
      q.repo ? eq(schema.agentJobs.githubRepo, q.repo) : null,
      q.job_type ? eq(schema.agentJobs.jobType, q.job_type as typeof schema.agentJobs.$inferSelect.jobType) : null,
    ];
    const conditions = rawConditions.filter((c): c is NonNullable<typeof c> => c !== null);

    const rows = await db
      .select()
      .from(schema.agentJobs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.agentJobs.createdAt))
      .limit(q.limit)
      .offset(q.offset);

    return {
      data: rows,
      pagination: { total: rows.length, limit: q.limit, offset: q.offset },
    };
  });

  app.get<{ Params: { jobId: string } }>(
    '/v1/jobs/:jobId',
    { preHandler: requireBearer },
    async (req) => {
      const db = getDb();
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.id, req.params.jobId))
        .limit(1);
      if (!job) throw errJobNotFound(req.params.jobId);
      return job;
    },
  );

  app.post<{ Params: { jobId: string }; Body: { reason?: string } }>(
    '/v1/jobs/:jobId/cancel',
    { preHandler: requireBearer },
    async (req) => {
      const db = getDb();
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.id, req.params.jobId))
        .limit(1);
      if (!job) throw errJobNotFound(req.params.jobId);
      if (TERMINAL.includes(job.status)) throw errJobTerminal(job.id, job.status);

      await db
        .update(schema.agentJobs)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(schema.agentJobs.id, job.id));

      // Phase 2: also remove from BullMQ queue.

      return { id: job.id, status: 'cancelled', cancelled_at: new Date().toISOString() };
    },
  );
}
