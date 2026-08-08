import { z } from 'zod';
import { idSchema, isoDateTimeSchema, urlSchema } from '../primitives';
import { credentialRefsSchema } from '../shapes';

/** Projects, applications, environments — the catalog every test hangs off. */

export const projectSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const applicationSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string().min(1).max(200),
  baseUrl: urlSchema,
  /** Domain context fed to the LLM, e.g. "a B2B invoicing app". */
  description: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Application = z.infer<typeof applicationSchema>;

export const environmentSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  name: z.string().min(1).max(200),
  /** Overrides `Application.baseUrl` for this deployment. */
  baseUrl: urlSchema,
  /** Environment variable *names*. Never values — see `credentialRefsSchema`. */
  credentialRefs: credentialRefsSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Environment = z.infer<typeof environmentSchema>;

export const projectWithApplicationsSchema = projectSchema.extend({
  applications: z.array(applicationSchema),
});
export type ProjectWithApplications = z.infer<typeof projectWithApplicationsSchema>;

export const applicationWithEnvironmentsSchema = applicationSchema.extend({
  environments: z.array(environmentSchema),
});
export type ApplicationWithEnvironments = z.infer<typeof applicationWithEnvironmentsSchema>;
