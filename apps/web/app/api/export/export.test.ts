import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `/api/export/3d/{sku}` reads a file whose path is built from two attacker-controlled parts.
 * It shipped without validating either, so `?format=../../../package.json` escaped the asset
 * root and served arbitrary repo files to any signed-in user.
 *
 * These tests hold the two properties that closed it: the SKU must look like a SKU code, and the
 * format must be one we deliberately serve. They run against a real temporary directory so a
 * traversal that got through would actually find the file it is reaching for — a mocked fs would
 * make the test pass for the wrong reason.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bo-export-'));

vi.mock('@/lib/storage-root', () => ({ resolveStorageDir: () => root }));

const { GET } = await import('./3d/[sku]/route');

const get = (sku: string, format?: string) => {
  const qs = format === undefined ? '' : `?format=${format}`;
  return GET(new NextRequest(`http://localhost/api/export/3d/${sku}${qs}`), { params: Promise.resolve({ sku }) });
};

beforeAll(() => {
  fs.mkdirSync(path.join(root, 'placeholders'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CEM-ULT-PPC50.glb'), 'glTF-real');
  fs.writeFileSync(path.join(root, 'placeholders', 'BUL-PHI-9W.glb'), 'glTF-placeholder');
  // The file a traversal would be aiming for, one level above the asset root.
  fs.writeFileSync(path.join(root, '..', 'bo-export-secret.txt'), 'SECRET');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.join(root, '..', 'bo-export-secret.txt'), { force: true });
});

describe('GET /api/export/3d/[sku]', () => {
  it('serves a real asset with the right content type and filename', async () => {
    const res = await get('CEM-ULT-PPC50', 'glb');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(res.headers.get('content-disposition')).toContain('CEM-ULT-PPC50.glb');
    await expect(res.text()).resolves.toBe('glTF-real');
  });

  it('is case-insensitive on the SKU, matching the rest of the app', async () => {
    expect((await get('cem-ult-ppc50', 'glb')).status).toBe(200);
  });

  it('defaults to glb when no format is asked for', async () => {
    const res = await get('CEM-ULT-PPC50');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
  });

  it('falls back to a generated placeholder when there is no real model', async () => {
    const res = await get('BUL-PHI-9W', 'glb');
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('glTF-placeholder');
  });

  it('does not look for a placeholder in a format placeholders are never generated in', async () => {
    expect((await get('BUL-PHI-9W', 'usdz')).status).toBe(404);
  });

  it('refuses a path traversal in the format parameter', async () => {
    for (const format of ['../bo-export-secret.txt', '../../etc/passwd', './../bo-export-secret.txt', '%2e%2e%2fsecret']) {
      const res = await get('CEM-ULT-PPC50', encodeURIComponent(format));
      expect(res.status, format).toBe(400);
      await expect(res.text()).resolves.not.toContain('SECRET');
    }
  });

  it('refuses a path traversal in the SKU segment', async () => {
    for (const sku of ['../bo-export-secret', '..%2F..%2Fsecret', 'a/../../b']) {
      expect((await get(sku, 'glb')).status, sku).toBe(400);
    }
  });

  it('refuses a format outside the allowlist', async () => {
    for (const format of ['exe', 'sh', 'txt', 'js']) {
      expect((await get('CEM-ULT-PPC50', format)).status, format).toBe(400);
    }
  });

  it('treats an empty format as unspecified rather than invalid', async () => {
    // `?format=` is a query string that lost its value, not a request for a format called "".
    expect((await get('CEM-ULT-PPC50', '')).status).toBe(200);
  });

  it('names the formats it will serve when it refuses one', async () => {
    // The caller is a script or a developer; "unsupported format" alone sends them to the source.
    const body = await (await get('CEM-ULT-PPC50', 'exe')).text();
    expect(body).toContain('glb');
    expect(body).toContain('usdz');
  });

  it('refuses a SKU that is not shaped like a SKU code', async () => {
    for (const sku of ['a', 'a'.repeat(40), 'has space', 'semi;colon']) {
      expect((await get(sku, 'glb')).status, sku).toBe(400);
    }
  });

  it('never lets an error response be cached', async () => {
    // A model dropped in a minute later must be picked up; a year-long cached 404 was a real bug
    // once already (see DECISIONS.md on /media Cache-Control).
    for (const res of [await get('NOPE-NOPE', 'glb'), await get('CEM-ULT-PPC50', 'exe')]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('caches a successful response', async () => {
    expect((await get('CEM-ULT-PPC50', 'glb')).headers.get('cache-control')).toContain('max-age');
  });
});
