import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_JUDGE_ITEM_SCHEMA,
  ImageJudgeBatchZ,
  type ImageJudgement,
  ImageJudgementZ,
  imageJudgeBatchSchema,
  imageJudgePrompt,
  judgeImages,
  judgeModelMatch,
  MODEL_MATCH_SCHEMA,
  scoreImageJudgement,
} from '../src/judge';
import { assertGeminiSchema } from '../src/schema';
import * as mock from './genai-mock';
import { cleanup, freshState } from './setup';

vi.mock('@google/genai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@google/genai')>();
  const m = await import('./genai-mock');
  return { ...orig, GoogleGenAI: m.GoogleGenAI };
});

const base: ImageJudgement = {
  index: 1,
  is_product_photo: true,
  shows_whole_product: true,
  is_packaging_only: false,
  is_logo_or_icon: false,
  is_dimension_drawing: false,
  has_watermark_or_text_overlay: false,
  brand_visible: true,
  background: 'white',
  view: 'front',
  sharpness: 1,
  match_to_product_name: 1,
  suggested_role: 'hero',
  reason: 'clean hero',
};

let tmp: string;
beforeEach(() => {
  tmp = freshState();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(tmp);
  vi.restoreAllMocks();
});

describe('scoreImageJudgement', () => {
  it('implements 0.45·match + 0.25·sharp + 0.15·whole + 0.15·bg − logo − 0.5·watermark − 0.2·packaging, clamped', () => {
    expect(scoreImageJudgement(base)).toBe(1);
    expect(scoreImageJudgement({ ...base, background: 'studio' })).toBe(0.985);
    expect(scoreImageJudgement({ ...base, background: 'in_use' })).toBe(0.94);
    expect(scoreImageJudgement({ ...base, background: 'cluttered' })).toBe(0.88);
    expect(scoreImageJudgement({ ...base, is_logo_or_icon: true })).toBe(0);
    expect(scoreImageJudgement({ ...base, has_watermark_or_text_overlay: true })).toBe(0.5);
    expect(scoreImageJudgement({ ...base, is_packaging_only: true })).toBe(0.8);
    expect(scoreImageJudgement({ ...base, match_to_product_name: 0.8, sharpness: 0.6, shows_whole_product: false, background: 'cluttered' })).toBe(0.54);
    expect(scoreImageJudgement({ ...base, match_to_product_name: 2, sharpness: -1 })).toBe(0.75); // inputs clamped
    expect(
      scoreImageJudgement({
        ...base,
        match_to_product_name: 0,
        sharpness: 0,
        shows_whole_product: false,
        background: 'cluttered',
        has_watermark_or_text_overlay: true,
      }),
    ).toBe(0);
  });
});

describe('schemas', () => {
  it('are Gemini-compatible and agree with the zod guards', () => {
    expect(() => assertGeminiSchema(IMAGE_JUDGE_ITEM_SCHEMA)).not.toThrow();
    expect(() => assertGeminiSchema(imageJudgeBatchSchema())).not.toThrow();
    expect(() => assertGeminiSchema(MODEL_MATCH_SCHEMA)).not.toThrow();
    const props = (IMAGE_JUDGE_ITEM_SCHEMA as { properties: Record<string, unknown>; required: string[] }).properties;
    expect(Object.keys(props).sort()).toEqual(Object.keys(ImageJudgementZ.shape).sort());
    expect((IMAGE_JUDGE_ITEM_SCHEMA as { required: string[] }).required).toEqual(Object.keys(props));
    expect(ImageJudgeBatchZ.safeParse({ items: [base] }).success).toBe(true);
    expect(ImageJudgementZ.safeParse({ ...base, background: 'green' }).success).toBe(false);
    expect(imageJudgePrompt({ brand: 'Havells', name: 'Adore 9W', category: 'bulbs', variant: 'B22' }, 3)).toContain('Havells Adore 9W (B22)');
  });
});

describe('judgeImages', () => {
  it('sends numbered image parts + the prompt, validates, and aligns scores with the input order', async () => {
    mock.generateContent.mockResolvedValue(
      mock.okResponse(
        JSON.stringify({
          items: [
            { ...base, index: 2, is_logo_or_icon: true, suggested_role: 'reject' },
            { ...base, index: 1 },
          ],
        }),
      ),
    );
    const r = await judgeImages(
      [
        { mimeType: 'image/jpeg', base64: 'AA' },
        { mimeType: 'image/jpeg', base64: 'BB' },
      ],
      { brand: 'Havells', name: 'Adore', category: 'bulbs', sku: 'BLB-1' },
      { model: 'gemini-2.5-flash' },
    );
    expect(r.scores).toEqual([1, 0]);
    expect(r.items).toHaveLength(2);
    expect(r.model).toBe('gemini-2.5-flash');
    const req = mock.lastRequest();
    const parts = req.contents[0].parts;
    expect(parts.map((p) => (p.text ? 'text' : 'image'))).toEqual(['text', 'image', 'text', 'image', 'text']);
    expect(parts[0].text).toBe('Image 1:');
    expect(parts[4].text).toContain('2 candidate catalogue images');
    expect(req.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(req.config.responseMimeType).toBe('application/json');
  });

  it('refuses empty or oversized batches', async () => {
    await expect(judgeImages([], { brand: 'x', name: 'y', category: 'z' }, { model: 'm' })).rejects.toThrow(/no images/);
    await expect(
      judgeImages(
        Array.from({ length: 9 }, () => ({ mimeType: 'image/png', base64: 'A' })),
        { brand: 'x', name: 'y', category: 'z' },
        { model: 'm' },
      ),
    ).rejects.toThrow(/at most 8/);
    expect(mock.generateContent).not.toHaveBeenCalled();
  });
});

describe('judgeModelMatch', () => {
  it('returns the strict verdict with usage', async () => {
    mock.generateContent.mockResolvedValue(
      mock.okResponse(JSON.stringify({ same_product: true, silhouette: 0.9, colour: 0.8, branding: 0.7, overall: 0.85, defects: ['label slightly blurred'] })),
    );
    const r = await judgeModelMatch(
      { mimeType: 'image/png', base64: 'HERO' },
      { mimeType: 'image/png', base64: 'PREVIEW' },
      { brand: 'UltraTech', name: 'Super PPC', category: 'cement', sku: 'CEM-1' },
      { model: 'gemini-3-flash-preview' },
    );
    expect(r).toMatchObject({
      same_product: true,
      silhouette: 0.9,
      colour: 0.8,
      branding: 0.7,
      overall: 0.85,
      defects: ['label slightly blurred'],
      model: 'gemini-3-flash-preview',
    });
    expect(r.usage.totalTokens).toBe(125);
    const req = mock.lastRequest();
    expect(req.contents[0].parts).toHaveLength(5);
    expect(req.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'HERO' });
    expect(req.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(req.config.responseJsonSchema).toEqual(MODEL_MATCH_SCHEMA);
  });

  it('rejects out-of-range scores', async () => {
    mock.generateContent.mockResolvedValue(
      mock.okResponse(JSON.stringify({ same_product: true, silhouette: 1.4, colour: 0.8, branding: 0.7, overall: 0.85, defects: [] })),
    );
    await expect(
      judgeModelMatch({ mimeType: 'image/png', base64: 'A' }, { mimeType: 'image/png', base64: 'B' }, { brand: 'x', name: 'y', category: 'z' }, { model: 'm' }),
    ).rejects.toThrow(/schema validation/);
  });
});
