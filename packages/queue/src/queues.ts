import { Queue, type QueueOptions } from 'bullmq';
import { getRedis } from './connection.js';

export const QUEUE_NAMES = {
  claudeImplement: 'claude_implement_issue',
  claudeRework: 'claude_rework_pr',
  openaiQa: 'openai_qa_review',
  clickupSync: 'clickup_sync',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// BullMQ retry policy per queue name. Source of truth lives in docs/07-worker-jobs.md §4.
const RETRY_POLICY: Record<QueueName, { attempts: number; backoff?: QueueOptions['defaultJobOptions'] }> = {
  [QUEUE_NAMES.claudeImplement]: { attempts: 1 },
  [QUEUE_NAMES.claudeRework]: { attempts: 1 },
  [QUEUE_NAMES.openaiQa]: {
    attempts: 3,
    backoff: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  },
  [QUEUE_NAMES.clickupSync]: {
    attempts: 5,
    backoff: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
  },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const cached = queues.get(name);
  if (cached) return cached;

  const policy = RETRY_POLICY[name];
  const q = new Queue(name, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: policy.attempts,
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
  queues.set(name, q);
  return q;
}

export async function closeAllQueues(): Promise<void> {
  for (const q of queues.values()) await q.close();
  queues.clear();
}

/**
 * Helper: enqueue a job by its agent_jobs DB id. The job processor looks up the row.
 */
export async function enqueueJob(name: QueueName, jobId: string, opts?: { priority?: number; delay?: number }): Promise<void> {
  const q = getQueue(name);
  await q.add(
    name,
    { jobId },
    {
      jobId,
      priority: opts?.priority ?? 100,
      delay: opts?.delay,
    },
  );
}
