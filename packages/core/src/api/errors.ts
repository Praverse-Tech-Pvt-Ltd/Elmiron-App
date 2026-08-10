import { z } from 'zod';

/**
 * `permission_denied` is returned when a caller asks for something outside their
 * scope. It is never replaced by an empty list. An empty list means "there is
 * nothing here"; a denial means "this is not yours". Collapsing the two hides
 * broken authorisation.
 */
export const ApiErrorCodeSchema = z.enum([
  'unauthenticated',
  'permission_denied',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  /** Correlates with the `request_id` column in `audit_log`. */
  requestId: z.string(),
  /** Field-level detail for `validation_failed`. Empty otherwise. */
  fieldErrors: z.record(z.string(), z.array(z.string())).nullable(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiErrorResponseSchema = z.object({ error: ApiErrorSchema });
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** Thrown by the API client for any non-2xx response. */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly fieldErrors: Record<string, string[]> | null;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = error.code;
    this.requestId = error.requestId;
    this.fieldErrors = error.fieldErrors;
  }
}
