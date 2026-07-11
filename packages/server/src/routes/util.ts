import type { FastifyReply } from "fastify";

/** Default page size for paginated list endpoints. */
export const DEFAULT_PAGE_SIZE = 48;

/** Extract a user-facing message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Send a JSON error response with a message derived from a thrown value. */
export function sendError(
  reply: FastifyReply,
  status: number,
  err: unknown,
  fallback: string,
): FastifyReply {
  return reply.status(status).send({ error: errorMessage(err, fallback) });
}

/** Parse `page`/`limit` query params with shared defaults and clamping. */
export function parsePagination(query: {
  page?: string;
  limit?: string;
}): { page: number; limit: number } {
  const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
  const limit = Math.max(
    1,
    Math.min(200, parseInt(query.limit ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, limit };
}

/** Parse a numeric route param, returning null when it is not a valid id. */
export function parseIdParam(value: string | undefined): number | null {
  if (value == null) return null;
  const id = parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
