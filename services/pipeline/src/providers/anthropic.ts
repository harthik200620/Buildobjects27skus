/**
 * Live extraction with Claude. Every call is tool-use with a strict JSON schema derived from
 * the category registry, so the model can only emit typed values for known keys. Text is
 * streamed (long inputs); the final message is read with `.finalMessage()`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AttributeValue, Registry } from '@buildobjects/catalog';
import { env, MODEL } from '../config';
import { findCurated } from './curated';
import { type Copy, type DescribeInput, type ExtractInput, type FillInput, type LlmProvider, NEVER_FILL, type VerifyInput } from './types';

const MAX_TEXT = 120_000; // characters of page+PDF text per call (well inside the context window)

function valueSchema(a: Registry['attributes'][number]) {
  const t = a.data_type === 'number' ? 'number' : a.data_type === 'boolean' ? 'boolean' : 'string';
  const base: Record<string, unknown> = {
    type: [t, 'null'],
    description: `${a.label}${a.unit ? ` (${a.unit})` : ''}${a.enum_values ? ` — one of: ${a.enum_values.join(' | ')}` : ''}`,
  };
  return {
    type: 'object',
    properties: {
      value: base,
      source_quote: { type: ['string', 'null'], description: 'The exact phrase in the source this value was read from, or null' },
      confidence: { type: 'number', description: '0–1' },
    },
    required: ['value', 'source_quote', 'confidence'],
    additionalProperties: false,
  };
}

function attributesTool(registry: Registry, keys: string[], name: string, description: string): Anthropic.Tool {
  const byKey = new Map(registry.attributes.map((a) => [a.key, a]));
  const properties: Record<string, unknown> = {};
  for (const k of keys) {
    const a = byKey.get(k);
    if (a) properties[k] = valueSchema(a);
  }
  return {
    name,
    description,
    strict: true,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as Anthropic.Tool['input_schema'],
  } as Anthropic.Tool;
}

function toolInput(msg: Anthropic.Message, name: string): Record<string, unknown> | null {
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name);
  return block ? (block.input as Record<string, unknown>) : null;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  private client = new Anthropic({ apiKey: env.anthropicKey });
  curated(skuCode: string) {
    return findCurated(skuCode);
  }

  private async call(system: string, user: string, tool: Anthropic.Tool): Promise<Record<string, unknown> | null> {
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: user }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal')
      throw new Error(`model refused (${(msg as unknown as { stop_details?: { category?: string } }).stop_details?.category ?? 'unknown'})`);
    return toolInput(msg, tool.name);
  }

  async extract(input: ExtractInput): Promise<Record<string, AttributeValue>> {
    const keys = input.registry.attributes.map((a) => a.key);
    const tool = attributesTool(
      input.registry,
      keys,
      'record_attributes',
      'Record every attribute value that is stated in the source text. Null when the source does not state it.',
    );
    const system = `You extract product specifications for an Indian construction-products catalogue. Read the official page text and datasheet text for ONE product and fill the attribute registry. Rules: only record values actually stated in the sources (quote the phrase); convert to the registry unit where trivially possible (e.g. 0.05 kN → 50 N); never guess; never invent BIS/ISI licence numbers, CM/L numbers or test-report numbers; prices are not attributes. Confidence reflects how explicitly the source states the value.`;
    const user = `Product: ${input.brand} ${input.productName} ${input.variant} (SKU ${input.skuCode}, category ${input.category})\nOfficial page: ${input.sourceUrl}\n\n=== PAGE TEXT ===\n${input.pageText.slice(0, MAX_TEXT)}\n\n=== DATASHEET TEXT (${input.pdfUrl ?? 'none'}) ===\n${input.pdfText.slice(0, MAX_TEXT)}`;
    const out = await this.call(system, user, tool);
    const values: Record<string, AttributeValue> = {};
    for (const [k, raw] of Object.entries(out ?? {})) {
      const r = raw as { value: unknown; source_quote: string | null; confidence: number };
      if (r.value === null || r.value === undefined || r.value === '') continue;
      values[k] = {
        value: r.value as AttributeValue['value'],
        provenance: 'fetched',
        source_url: r.source_quote && input.pdfText.includes(r.source_quote) && input.pdfUrl ? input.pdfUrl : input.sourceUrl,
        confidence: Math.max(0, Math.min(1, r.confidence ?? 0.8)),
      };
    }
    return values;
  }

  async verify(input: VerifyInput) {
    const keys = Object.keys(input.values);
    if (!keys.length || !input.secondaryText.trim()) return { values: input.values, conflicts: [] };
    const tool = attributesTool(
      input.registry,
      keys,
      'record_secondary',
      'Record the value the SECONDARY source states for each attribute (null if it does not state it).',
    );
    const system = 'You cross-check product specifications against an independent second source. Record only what the second source states. Never guess.';
    const user = `Product: ${input.brand} ${input.productName} ${input.variant}\nSecondary source: ${input.secondaryUrl}\n\n=== SECONDARY TEXT ===\n${input.secondaryText.slice(0, MAX_TEXT)}`;
    const out = await this.call(system, user, tool);
    const values = { ...input.values };
    const conflicts: { key: string; official: unknown; secondary: unknown }[] = [];
    for (const [k, raw] of Object.entries(out ?? {})) {
      const r = raw as { value: unknown };
      if (r.value === null || r.value === undefined || r.value === '') continue;
      const a = values[k];
      if (!a) continue;
      const same =
        typeof a.value === 'number' && typeof r.value === 'number'
          ? Math.abs(a.value - r.value) <= Math.abs(a.value) * 0.02
          : String(a.value).trim().toLowerCase() === String(r.value).trim().toLowerCase();
      if (same)
        values[k] = {
          ...a,
          provenance: 'verified',
          source_urls: [a.source_url ?? '', input.secondaryUrl].filter(Boolean),
          confidence: Math.max(a.confidence ?? 0.8, 0.95),
        };
      else conflicts.push({ key: k, official: a.value, secondary: r.value });
    }
    return { values, conflicts };
  }

  async fill(input: FillInput): Promise<Record<string, AttributeValue>> {
    const missing = input.registry.attributes.map((a) => a.key).filter((k) => !(k in input.values) && !NEVER_FILL.test(k));
    if (!missing.length) return input.values;
    const tool = attributesTool(
      input.registry,
      missing,
      'fill_attributes',
      'Industry-standard plausible value for this exact product class, or null if no sensible value exists.',
    );
    const system =
      'You supply industry-standard plausible values for specification gaps of a specific Indian construction product, to be labelled AI-filled with confidence ≤ 0.7. Base them on the product class, the governing IS/IEC standard and the known values below. Never invent certificate, licence or test-report numbers. Null is better than a wild guess.';
    const known = Object.entries(input.values)
      .map(([k, v]) => `${k} = ${JSON.stringify(v.value)}${v.unit ? ` ${v.unit}` : ''}`)
      .join('\n');
    const user = `Product: ${input.brand} ${input.productName} ${input.variant} (category ${input.category})\nKnown values:\n${known}`;
    const out = await this.call(system, user, tool);
    const values = { ...input.values };
    for (const [k, raw] of Object.entries(out ?? {})) {
      const r = raw as { value: unknown; confidence: number };
      if (r.value === null || r.value === undefined || r.value === '') continue;
      values[k] = { value: r.value as AttributeValue['value'], provenance: 'ai_filled', source_url: null, confidence: Math.min(0.7, r.confidence ?? 0.6) };
    }
    return values;
  }

  async describe(input: DescribeInput): Promise<Copy> {
    const tool = {
      name: 'write_copy',
      strict: true,
      description: 'Write the catalogue copy for this product, grounded only in the given attribute values.',
      input_schema: {
        type: 'object',
        properties: {
          short_description: { type: 'string', description: '≤ 160 characters, card-ready, factual' },
          long_description: {
            type: 'string',
            description:
              'Markdown, 250–450 words. Sections (### headings): What it is · What it is for · Key specifications · Application / installation notes · What is in the box',
          },
          key_specs: { type: 'array', items: { type: 'string' }, description: 'Exactly 8 registry keys an Indian buyer checks first, in priority order' },
          seo: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              meta_description: { type: 'string' },
              keywords: { type: 'array', items: { type: 'string' } },
              keywords_te: { type: 'array', items: { type: 'string' } },
              keywords_hi: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'meta_description', 'keywords', 'keywords_te', 'keywords_hi'],
            additionalProperties: false,
          },
        },
        required: ['short_description', 'long_description', 'key_specs', 'seo'],
        additionalProperties: false,
      } as Anthropic.Tool['input_schema'],
    } as Anthropic.Tool;
    const system =
      'You write complete, factual, structured product copy for an Indian construction-products store. Use ONLY the attribute values given — no new numbers, no new claims, no superlatives. Telugu and Hindi keyword variants where natural.';
    const values = Object.entries(input.values)
      .map(([k, v]) => {
        const a = input.registry.attributes.find((x) => x.key === k);
        return `${a?.label ?? k}: ${JSON.stringify(v.value)}${(v.unit ?? a?.unit) ? ` ${v.unit ?? a?.unit}` : ''}`;
      })
      .join('\n');
    const user = `Product: ${input.brand} ${input.productName} ${input.variant} (category ${input.category})\nRegistry keys available for key_specs: ${input.registry.attributes.map((a) => a.key).join(', ')}\n\nAttributes:\n${values}`;
    const out = await this.call(system, user, tool);
    if (!out) throw new Error('no copy returned');
    const c = out as unknown as Copy;
    return {
      short_description: String(c.short_description).slice(0, 160),
      long_description: c.long_description,
      key_specs: c.key_specs.slice(0, 8),
      seo: c.seo,
    };
  }
}
