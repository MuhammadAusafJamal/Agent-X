/**
 * @agentx/shared — the single definition of every payload that crosses a
 * boundary in Agent X: HTTP bodies, SSE frames, LLM responses, and the JSON held
 * in SQLite TEXT columns.
 *
 * Both apps import from here, so the API and the dashboard cannot drift, and
 * `CONTRIBUTING.md`'s "parse at the boundary, don't cast" rule has one place to
 * live rather than being restated at every call site.
 */

export const SHARED_CONTRACT_VERSION = '0.0.1';

export * from './primitives';
export * from './enums';
export * from './shapes';
export * from './json';
export * from './api';
export * from './events';
export * from './recorder';
export * from './compiler';
export * from './agent';
export * from './domain';
export * from './dto';
