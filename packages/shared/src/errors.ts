/**
 * Standard error shape for API responses. Aligns with docs/06-api-specification.md §10.
 */

export type ErrorCode =
  | 'invalid_signature'
  | 'unknown_repo'
  | 'project_not_found'
  | 'job_not_found'
  | 'run_not_found'
  | 'job_terminal'
  | 'unauthorized'
  | 'rate_limited'
  | 'validation_failed'
  | 'internal_error';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export const errInvalidSignature = (details?: Record<string, unknown>) =>
  new AppError('invalid_signature', 'GitHub webhook signature did not verify.', 401, details);

export const errUnknownRepo = (repo: string) =>
  new AppError('unknown_repo', `Repository "${repo}" is not registered.`, 200, { repo });

export const errProjectNotFound = (slug: string) =>
  new AppError('project_not_found', `Project "${slug}" not found.`, 404, { slug });

export const errJobNotFound = (id: string) =>
  new AppError('job_not_found', `Job "${id}" not found.`, 404, { id });

export const errRunNotFound = (id: string) =>
  new AppError('run_not_found', `Run "${id}" not found.`, 404, { id });

export const errJobTerminal = (id: string, status: string) =>
  new AppError('job_terminal', `Job "${id}" is in terminal state "${status}" and cannot be cancelled.`, 409, { id, status });

export const errUnauthorized = (reason?: string) =>
  new AppError('unauthorized', reason ?? 'Missing or invalid bearer token.', 401);

export const errValidationFailed = (details: Record<string, unknown>) =>
  new AppError('validation_failed', 'Request payload failed validation.', 400, details);

export const errInternal = (cause?: unknown) =>
  new AppError('internal_error', 'Internal server error.', 500, cause ? { cause: String(cause) } : undefined);
