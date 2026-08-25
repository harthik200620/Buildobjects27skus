import { hasAnthropic } from '../config';
import { AnthropicProvider } from './anthropic';
import { CuratedProvider } from './curated';
import type { LlmProvider } from './types';

let provider: LlmProvider | null = null;
export function llm(): LlmProvider {
  if (!provider) provider = hasAnthropic() ? new AnthropicProvider() : new CuratedProvider();
  return provider;
}
export { findCurated, listCurated } from './curated';
export * from './types';
