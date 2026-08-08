import { z } from 'zod';

/**
 * The envelope every API response shares: one error shape, one pagination shape.
 *
 * The dashboard parses errors through `apiErrorSchema` rather than sniffing
 * fields, so a Prisma stack trace leaking out of a controller fails loudly here
 * instead of rendering as `[object Object]`.
 */

export const apiIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ApiIssue = z.infer<typeof apiIssueSchema>;

export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  /** Machine-readable, e.g. `VALIDATION_FAILED`, `NOT_FOUND`. */
  code: z.string(),
  message: z.string(),
  /** Field-level detail for validation failures. */
  issues: z.array(apiIssueSchema).optional(),
  path: z.string(),
  timestamp: z.iso.datetime(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const API_ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL: 'INTERNAL',
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Wrap an item schema in the standard list envelope. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
  });
}

export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.boolean(),
  uptimeSeconds: z.number(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
