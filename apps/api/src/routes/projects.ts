import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getRegistry } from '@claudegpt/project-registry';
import { errProjectNotFound } from '@claudegpt/shared';
import { requireBearer } from '../middleware/auth.js';

const ListQuery = z.object({
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/projects', { preHandler: requireBearer }, async (req) => {
    const query = ListQuery.parse(req.query);
    const reg = getRegistry();
    const list = reg.list();
    const data = list
      .filter((p) => !query.status || (p.metadata as { status?: string } | undefined)?.status === query.status)
      .map((p) => ({
        slug: p.projectId,
        name: p.name,
        github_repo: p.githubRepo,
        clickup_folder_id: p.clickupFolderId ?? null,
        default_branch: p.defaultBranch,
      }));
    return {
      data,
      pagination: { total: data.length, limit: data.length, offset: 0 },
    };
  });

  app.get<{ Params: { slug: string } }>(
    '/v1/projects/:slug',
    { preHandler: requireBearer },
    async (req) => {
      const reg = getRegistry();
      const project = reg.get(req.params.slug);
      if (!project) throw errProjectNotFound(req.params.slug);
      return {
        slug: project.projectId,
        name: project.name,
        github_repo: project.githubRepo,
        clickup_folder_id: project.clickupFolderId ?? null,
        default_branch: project.defaultBranch,
        config_json: project,
      };
    },
  );
}
