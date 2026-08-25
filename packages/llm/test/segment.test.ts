import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maskToFullFrame, parseSegmentation, segment, segmentationPrompt } from '../src/segment';
import * as mock from './genai-mock';
import { cleanup, freshState } from './setup';

vi.mock('@google/genai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@google/genai')>();
  const m = await import('./genai-mock');
  return { ...orig, GoogleGenAI: m.GoogleGenAI };
});

const whitePng = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();

let tmp: string;
beforeEach(() => {
  tmp = freshState();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(tmp);
  vi.restoreAllMocks();
});

describe('parseSegmentation', () => {
  it('accepts fenced JSON, data-URI or raw base64 masks, normalises boxes and drops bad entries', () => {
    const text =
      '```json\n' +
      JSON.stringify([
        { box_2d: [250, 100, 750, 900], mask: 'data:image/png;base64,AAAA', label: 'cement bag' },
        { box_2d: [900, 900, 100, 100], mask: 'BBBB', label: 'flipped' },
        { box_2d: [0, 0, 0, 0], mask: 'CCCC', label: 'empty box' },
        { box_2d: [10, 10, 50, 50], mask: '', label: 'no mask' },
        { box_2d: [10, 10, 50], mask: 'DDDD' },
        { box_2d: [-50, 0, 1200, 1000], mask: 'EEEE' },
      ]) +
      '\n```';
    const items = parseSegmentation(text);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ label: 'cement bag', box: { x0: 0.1, y0: 0.25, x1: 0.9, y1: 0.75 }, box2d: [250, 100, 750, 900], maskPngBase64: 'AAAA' });
    expect(items[1].box).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    expect(items[2]).toMatchObject({ label: '', box: { x0: 0, y0: 0, x1: 1, y1: 1 }, box2d: [0, 0, 1000, 1000] });
    expect(parseSegmentation('{"masks": [{"box_2d":[0,0,500,500],"mask":"ZZ","label":"a"}]}')).toHaveLength(1);
    expect(parseSegmentation('[]')).toEqual([]);
  });

  it('uses the documented prompt', () => {
    expect(segmentationPrompt(['the cement bag', ' the floor '])).toBe(
      'Give the segmentation masks for the cement bag, the floor. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.',
    );
    expect(segmentationPrompt([])).toContain('every distinct object');
  });
});

describe('segment', () => {
  it('calls the segment model with the image, the prompt and thinking off, then parses', async () => {
    const png = (await whitePng(2, 2)).toString('base64');
    mock.generateContent.mockResolvedValue(
      mock.okResponse(`\`\`\`json\n${JSON.stringify([{ box_2d: [250, 250, 750, 750], mask: `data:image/png;base64,${png}`, label: 'cement bag' }])}\n\`\`\``),
    );
    const r = await segment({ mimeType: 'image/jpeg', base64: 'IMG' }, ['the cement bag'], {
      model: 'gemini-2.5-flash',
      mediaResolution: 'high',
      sku: 'CEM-1',
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].label).toBe('cement bag');
    expect(r.items[0].box).toEqual({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
    expect(r.model).toBe('gemini-2.5-flash');
    const req = mock.lastRequest();
    expect(req.contents[0].parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'IMG' });
    expect(req.contents[0].parts[1].text).toContain('segmentation masks for the cement bag');
    expect(req.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(req.config.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
    expect(req.config.temperature).toBe(0);
    expect(req.config.responseMimeType).toBeUndefined();
  });
});

describe('maskToFullFrame (real sharp)', () => {
  it('pastes a box-sized mask into a full-size single-channel PNG', async () => {
    const mask = (await whitePng(2, 2)).toString('base64');
    const out = await maskToFullFrame({ width: 8, height: 8 }, { box: { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, maskPngBase64: mask });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.channels, meta.format]).toEqual([8, 8, 1, 'png']);
    const { data, info } = await sharp(out).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([8, 8, 1]);
    const px = (x: number, y: number) => data[y * 8 + x];
    expect(px(0, 0)).toBe(0);
    expect(px(1, 1)).toBe(0);
    expect(px(2, 2)).toBe(255);
    expect(px(4, 4)).toBe(255);
    expect(px(5, 5)).toBe(255);
    expect(px(6, 6)).toBe(0);
    expect(px(7, 7)).toBe(0);
    expect(px(2, 1)).toBe(0);
    let white = 0;
    for (const v of data) if (v === 255) white += 1;
    expect(white).toBe(16);
  });

  it('clips boxes at the frame edge and supports thresholding to 0/255', async () => {
    const gradient = await sharp(Buffer.from([0, 255]), { raw: { width: 2, height: 1, channels: 1 } })
      .png()
      .toBuffer();
    const out = await maskToFullFrame(
      { width: 6, height: 3 },
      { box: { x0: 0.5, y0: 0, x1: 1.2, y1: 0.34 }, maskPngBase64: gradient.toString('base64') },
      { threshold: 127 },
    );
    expect((await sharp(out).metadata()).channels).toBe(1);
    const { data, info } = await sharp(out).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([6, 3, 1]);
    for (const v of data) expect(v === 0 || v === 255).toBe(true);
    expect(data[0]).toBe(0);
    expect(data[3]).toBe(0);
    expect(data[5]).toBe(255);
    expect(data[2 * 6 + 5]).toBe(0); // outside the box (rows 1–2)
  });
});
