import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { buildGlb, type Material } from '../src/gltf';
import { box, texturedMaterial } from '../src/shapes';
import { FLAT, pngSolid } from './helpers';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const jsonChunk = (glb: Buffer) => JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));

describe('glTF writer — textures', () => {
  it('round-trips a textured box through gltf-transform: TEXCOORD_0 + baseColorTexture + image bytes', async () => {
    const png = await pngSolid(8, 8);
    const mat = texturedMaterial('photo', { image: png, mime: 'image/png' });
    const { glb, textures, triangles } = buildGlb([box(0.2, 0.1, 0.05, [0, 0.05, 0], mat, { uv: 'all' })], 'tex-box');
    expect(textures).toBe(1);
    expect(triangles).toBe(12);
    const doc = await io.readBinary(new Uint8Array(glb));
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const uv = prim.getAttribute('TEXCOORD_0');
    expect(uv).not.toBeNull();
    expect(uv!.getType()).toBe('VEC2');
    expect(uv!.getCount()).toBe(prim.getAttribute('POSITION')!.getCount());
    const material = prim.getMaterial()!;
    const tex = material.getBaseColorTexture();
    expect(tex).not.toBeNull();
    expect(tex!.getMimeType()).toBe('image/png');
    expect(Buffer.from(tex!.getImage()!).equals(png)).toBe(true);
    expect(material.getBaseColorTextureInfo()!.getTexCoord()).toBe(0);
    expect(material.getBaseColorTextureInfo()!.getWrapS()).toBe(10497);
    const json = jsonChunk(glb);
    expect(json.samplers[0]).toEqual({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    expect(json.images[0].mimeType).toBe('image/png');
    expect(json.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0, texCoord: 0 });
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
  });

  it('keeps the flat-colour path free of texture arrays (byte-compatible layout)', () => {
    const { glb, textures } = buildGlb([box(1, 1, 1, [0, 0.5, 0], FLAT)], 'flat');
    expect(textures).toBe(0);
    const json = jsonChunk(glb);
    expect(Object.keys(json)).toEqual(['asset', 'scene', 'scenes', 'nodes', 'meshes', 'materials', 'buffers', 'bufferViews', 'accessors']);
    expect(json.meshes[0].primitives[0].attributes).toEqual({ POSITION: 0, NORMAL: 1 });
    expect(json.bufferViews.every((v: { target?: number }) => v.target !== undefined)).toBe(true);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
  });

  it('deduplicates identical images and keys materials by name + image hash', async () => {
    const png = await pngSolid(4, 4),
      other = await pngSolid(4, 4, [10, 200, 10, 255]);
    const a = texturedMaterial('face', { image: png, mime: 'image/png' });
    const b = texturedMaterial('face', { image: png, mime: 'image/png' }); // same name, same image → one material
    const c = texturedMaterial('face', { image: other, mime: 'image/png' }); // same name, other image → second material
    const { glb, textures } = buildGlb(
      [box(1, 1, 1, [0, 0.5, 0], a, { uv: 'all' }), box(1, 1, 1, [2, 0.5, 0], b, { uv: 'all' }), box(1, 1, 1, [4, 0.5, 0], c, { uv: 'all' })],
      'dedupe',
    );
    expect(textures).toBe(2);
    const json = jsonChunk(glb);
    expect(json.images).toHaveLength(2);
    expect(json.materials).toHaveLength(2);
    expect(json.meshes[0].primitives.map((p: { material: number }) => p.material)).toEqual([0, 0, 1]);
  });

  it('drops the texture for a mesh without UVs and rejects mismatched UV lengths', async () => {
    const png = await pngSolid(4, 4);
    const mat = texturedMaterial('photo', { image: png, mime: 'image/png' });
    const { glb, textures } = buildGlb([box(1, 1, 1, [0, 0.5, 0], mat)], 'no-uv');
    expect(textures).toBe(0);
    expect(jsonChunk(glb).materials[0].pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    const bad = box(1, 1, 1, [0, 0.5, 0], FLAT);
    bad.uvs = [0, 0, 1];
    expect(() => buildGlb([bad], 'bad')).toThrow(/uvs length/);
  });

  it('writes emissive / blend / doubleSided flags as before', () => {
    const m: Material = { name: 'glow', color: [1, 1, 1, 0.5], metallic: 0, roughness: 1, emissive: [1, 0.5, 0], blend: true, doubleSided: true };
    const json = jsonChunk(buildGlb([box(1, 1, 1, [0, 0.5, 0], m)], 'flags').glb);
    expect(json.materials[0]).toMatchObject({ emissiveFactor: [1, 0.5, 0], alphaMode: 'BLEND', doubleSided: true });
  });
});
