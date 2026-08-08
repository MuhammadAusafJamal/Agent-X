import { z } from 'zod';
import { urlSchema } from '../primitives';
import { credentialRefsSchema } from '../shapes';
import { paginationQuerySchema } from '../api';

/**
 * Request bodies for the catalog.
 *
 * The API validates against these at the controller boundary and the dashboard
 * validates against the same objects client-side, so the two cannot disagree
 * about what a valid application looks like.
 */

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createApplicationSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  baseUrl: urlSchema,
  description: z.string().max(2000).nullish(),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = createApplicationSchema.omit({ projectId: true }).partial();
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const createEnvironmentSchema = z.object({
  applicationId: z.string().min(1),
  name: z.string().min(1).max(200),
  baseUrl: urlSchema,
  /** Environment variable names. The UI labels these as names and never shows a value. */
  credentialRefs: credentialRefsSchema.default({ extra: {} }),
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = createEnvironmentSchema
  .omit({ applicationId: true })
  .partial();
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;

/**
 * Whether each of an environment's credential references currently resolves.
 *
 * Carries the variable *name* and a boolean — never the value. This shape is
 * safe to log, render, and send to a browser; a shape with the value in it
 * would not be, and would eventually end up in one of those places.
 */
export const credentialStatusSchema = z.object({
  /** Which slot this fills: `usernameEnv`, `passwordEnv`, or an `extra` key. */
  key: z.string(),
  envVar: z.string(),
  resolved: z.boolean(),
});
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

export const environmentCredentialStatusSchema = z.object({
  environmentId: z.string(),
  entries: z.array(credentialStatusSchema),
  allResolved: z.boolean(),
});
export type EnvironmentCredentialStatus = z.infer<
  typeof environmentCredentialStatusSchema
>;

/** List filters. The parent id is optional so the collection is browsable whole. */
export const listApplicationsQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1).optional(),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

export const listEnvironmentsQuerySchema = paginationQuerySchema.extend({
  applicationId: z.string().min(1).optional(),
});
export type ListEnvironmentsQuery = z.infer<typeof listEnvironmentsQuerySchema>;
