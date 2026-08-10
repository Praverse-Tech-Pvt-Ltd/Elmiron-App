import { z } from 'zod';
import type { ZodType } from 'zod';

export const PageRequestSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  /** Opaque cursor from the previous page. Omit for the first page. */
  cursor: z.string().nullish(),
});
export type PageRequest = z.infer<typeof PageRequestSchema>;

export const pageResponseSchema = <T extends ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

export interface PageResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
