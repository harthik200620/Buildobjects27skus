/**
 * @buildobjects/llm — the Gemini platform shared by the pipeline, apps/web and assets3d.
 * Server-only by convention: never import from client components.
 */

export * from './client';
export * from './cost';
export * from './errors';
export * from './generate';
export * from './guard';
export * from './judge';
export * from './models';
export { repoRoot, reportPath, reportsDir } from './paths';
export * from './schema';
export * from './segment';
