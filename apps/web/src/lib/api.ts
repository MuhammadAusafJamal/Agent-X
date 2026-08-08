import { apiErrorSchema, type ApiError, type ApiIssue } from "@agentx/shared";
import type { z } from "zod";

/**
 * The one way this app talks to the API.
 *
 * Every response is *parsed* through a schema from `@agentx/shared` rather than
 * cast, so a server-side shape change surfaces here — naming the field — instead
 * of as `undefined` rendering three components away.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** A failed request. Carries the parsed API error when the server sent one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  /** Field-level problems, for rendering against the offending input. */
  get issues(): ApiIssue[] {
    return this.body?.issues ?? [];
  }

  /** True when the API could not be reached at all, as opposed to refusing. */
  get isUnreachable(): boolean {
    return this.status === 0;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiFetch<T extends z.ZodType>(
  path: string,
  schema: T,
  options: ApiFetchOptions = {},
): Promise<z.infer<T>> {
  const { body, headers, ...rest } = options;
  const url = `${API_BASE_URL}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A dead API is the single most common state during development. Say so
    // plainly rather than letting an unhandled rejection reach the console.
    throw new ApiRequestError(
      0,
      null,
      `Could not reach the API at ${API_BASE_URL}. Is it running? (npm run dev:api)`,
    );
  }

  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      await parseErrorBody(response),
      await errorMessage(response),
    );
  }

  if (response.status === 204) {
    return schema.parse(undefined) as z.infer<T>;
  }

  const json: unknown = await response.json();
  const result = schema.safeParse(json);

  if (!result.success) {
    throw new ApiRequestError(
      response.status,
      null,
      `The API returned an unexpected shape for ${path}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return result.data;
}

async function parseErrorBody(response: Response): Promise<ApiError | null> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function errorMessage(response: Response): Promise<string> {
  const body = await parseErrorBody(response);
  return body?.message ?? `Request failed with status ${response.status}`;
}
