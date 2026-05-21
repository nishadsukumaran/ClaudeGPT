import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@claudegpt/shared';
import { projectConfigSchema, type ProjectConfig } from './schema.js';

const log = getLogger('project-registry');

export interface RegistryEntry {
  config: ProjectConfig;
  /** Absolute path to the source file (for change detection). */
  sourcePath: string;
}

export class ProjectRegistry {
  private byId = new Map<string, RegistryEntry>();
  private byRepo = new Map<string, RegistryEntry>();
  private dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  /**
   * Read every projects/*.json file, validate, and populate the registry.
   * On any single-file failure, that file is skipped (logged) but the rest load.
   * Returns the number of successfully loaded projects.
   */
  load(): number {
    this.byId.clear();
    this.byRepo.clear();

    if (!fs.existsSync(this.dir)) {
      log.warn({ dir: this.dir }, 'Project registry directory does not exist; no projects loaded.');
      return 0;
    }

    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const sourcePath = path.join(this.dir, file);
      try {
        const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
        const parsed = projectConfigSchema.safeParse(raw);
        if (!parsed.success) {
          log.error(
            { file, issues: parsed.error.issues },
            'Project config failed validation; skipping.',
          );
          continue;
        }
        const config = parsed.data;

        if (this.byId.has(config.projectId)) {
          log.error({ file, projectId: config.projectId }, 'Duplicate projectId; skipping.');
          continue;
        }
        if (this.byRepo.has(config.githubRepo)) {
          log.error({ file, githubRepo: config.githubRepo }, 'Duplicate githubRepo; skipping.');
          continue;
        }

        const entry: RegistryEntry = { config, sourcePath };
        this.byId.set(config.projectId, entry);
        this.byRepo.set(config.githubRepo, entry);
      } catch (err) {
        log.error({ file, err }, 'Failed to load project config.');
      }
    }

    log.info({ count: this.byId.size, dir: this.dir }, 'Project registry loaded.');
    return this.byId.size;
  }

  get(id: string): ProjectConfig | null {
    return this.byId.get(id)?.config ?? null;
  }

  getByRepo(repo: string): ProjectConfig | null {
    return this.byRepo.get(repo)?.config ?? null;
  }

  list(): ProjectConfig[] {
    return [...this.byId.values()].map((e) => e.config);
  }
}

/**
 * Singleton helper. The orchestrator typically constructs one registry at startup
 * and calls load() periodically or on SIGHUP.
 */
let singleton: ProjectRegistry | null = null;

export function getRegistry(dir = 'projects'): ProjectRegistry {
  if (!singleton) {
    singleton = new ProjectRegistry(dir);
    singleton.load();
  }
  return singleton;
}

export function reloadRegistry(): number {
  if (!singleton) return 0;
  return singleton.load();
}
