import { z } from 'zod';

/**
 * Primitives shared by every domain schema.
 *
 * Note on dates: these schemas describe the **wire** shape — what the API sends
 * and the dashboard receives, which is JSON, where a date is an ISO string.
 * Prisma hands back `Date` objects, so the mapping layer converts at the
 * boundary. That conversion is also where JSON columns get parsed and
 * credentials get redacted, so it is a boundary worth having rather than
 * overhead to route around.
 */

export const idSchema = z.string().min(1);
export const isoDateTimeSchema = z.iso.datetime();

/**
 * An http(s) URL.
 *
 * Plain `z.url()` is not enough here: WHATWG parses `localhost:3000` as a valid
 * URL with the scheme `localhost:`, so it passes — and then breaks CORS, or
 * sends Playwright somewhere it cannot navigate. Every URL in this system is
 * either browsed to or used as an origin, so both need a real protocol.
 */
export const urlSchema = z.url({
  protocol: /^https?$/,
  error: 'must be an http:// or https:// URL',
});

export type Id = z.infer<typeof idSchema>;
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
