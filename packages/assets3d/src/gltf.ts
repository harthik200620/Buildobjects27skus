/**
 * A minimal glTF 2.0 binary (GLB) writer — positions, normals, indices, optional UVs, PBR
 * materials with an optional base-colour texture. No three.js on the server, no DOM. Output
 * loads in three.js GLTFLoader, <model-viewer>, gltf-transform, and converts to USDZ
 * client-side for Quick Look.
 *
 * Flat-colour meshes (no `uvs`, no `baseColorTexture`) produce byte-identical output to the
 * pre-texture writer: `samplers` / `images` / `textures` are only emitted when something uses them.
 */
import { createHash } from 'node:crypto';

export type TextureMime = 'image/png' | 'image/jpeg';
export interface TextureImage {
  image: Buffer;
  mime: TextureMime;
}
export interface Material {
  name: string;
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive?: [number, number, number];
  blend?: boolean;
  doubleSided?: boolean;
  /** Base-colour texture (multiplied by `color`). Only applied to meshes that carry `uvs`. */
  baseColorTexture?: TextureImage;
}
export interface MeshData {
  positions: number[];
  normals: number[];
  indices: number[];
  material: Material;
  /** One (u, v) pair per vertex → TEXCOORD_0. glTF convention: (0, 0) is the top-left of the image. */
  uvs?: number[];
}

const pad4 = (n: number) => (n + 3) & ~3;
const GL = {
  ARRAY_BUFFER: 34962,
  ELEMENT_ARRAY_BUFFER: 34963,
  FLOAT: 5126,
  UNSIGNED_INT: 5125,
  LINEAR: 9729,
  LINEAR_MIPMAP_LINEAR: 9987,
  REPEAT: 10497,
  TRIANGLES: 4,
} as const;
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

export interface GlbResult {
  glb: Buffer;
  triangles: number;
  bbox: { min: [number, number, number]; max: [number, number, number] } /** Distinct images embedded. */;
  textures: number;
}

export function buildGlb(meshes: MeshData[], name: string): GlbResult {
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const images: Record<string, unknown>[] = [];
  const textures: Record<string, unknown>[] = [];
  const matIndex = new Map<string, number>();
  const texIndex = new Map<string, number>();
  const primitives: Record<string, unknown>[] = [];
  const chunks: Buffer[] = [];
  let offset = 0,
    triangles = 0;
  const bbMin: [number, number, number] = [Infinity, Infinity, Infinity],
    bbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const view = (buf: Buffer, target?: number) => {
    const padded = Buffer.alloc(pad4(buf.length));
    buf.copy(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target !== undefined ? { target } : {}) });
    chunks.push(padded);
    offset += padded.length;
    return bufferViews.length - 1;
  };
  /** Images are deduplicated by content hash: the same hero cut-out on two faces is stored once. */
  const texture = (t: TextureImage, hash: string) => {
    if (texIndex.has(hash)) return texIndex.get(hash)!;
    images.push({ mimeType: t.mime, bufferView: view(t.image) });
    textures.push({ sampler: 0, source: images.length - 1 });
    texIndex.set(hash, textures.length - 1);
    return textures.length - 1;
  };
  const material = (m: Material, withTexture: boolean) => {
    const tex = withTexture && m.baseColorTexture ? m.baseColorTexture : null;
    const hash = tex ? sha1(tex.image) : '';
    const key = tex ? `${m.name}#${hash}` : m.name;
    if (matIndex.has(key)) return matIndex.get(key)!;
    const pbr: Record<string, unknown> = { baseColorFactor: m.color, metallicFactor: m.metallic, roughnessFactor: m.roughness };
    if (tex) pbr.baseColorTexture = { index: texture(tex, hash), texCoord: 0 };
    materials.push({
      name: m.name,
      pbrMetallicRoughness: pbr,
      ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
      ...(m.blend ? { alphaMode: 'BLEND' } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}),
    });
    matIndex.set(key, materials.length - 1);
    return materials.length - 1;
  };

  for (const m of meshes) {
    if (!m.indices.length) continue;
    const pos = new Float32Array(m.positions),
      nor = new Float32Array(m.normals),
      idx = new Uint32Array(m.indices);
    const hasUv = !!m.uvs && m.uvs.length > 0;
    if (hasUv && m.uvs!.length !== (m.positions.length / 3) * 2)
      throw new Error(`mesh "${m.material.name}": uvs length ${m.uvs!.length} does not match ${m.positions.length / 3} vertices`);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
        bbMin[k] = Math.min(bbMin[k], pos[i + k]);
        bbMax[k] = Math.max(bbMax[k], pos[i + k]);
      }
    const pv = view(Buffer.from(pos.buffer), GL.ARRAY_BUFFER);
    accessors.push({ bufferView: pv, componentType: GL.FLOAT, count: pos.length / 3, type: 'VEC3', min, max });
    const posAcc = accessors.length - 1;
    const nv = view(Buffer.from(nor.buffer), GL.ARRAY_BUFFER);
    accessors.push({ bufferView: nv, componentType: GL.FLOAT, count: nor.length / 3, type: 'VEC3' });
    const norAcc = accessors.length - 1;
    let uvAcc = -1;
    if (hasUv) {
      const uv = new Float32Array(m.uvs!);
      const uvv = view(Buffer.from(uv.buffer), GL.ARRAY_BUFFER);
      accessors.push({ bufferView: uvv, componentType: GL.FLOAT, count: uv.length / 2, type: 'VEC2' });
      uvAcc = accessors.length - 1;
    }
    const iv = view(Buffer.from(idx.buffer), GL.ELEMENT_ARRAY_BUFFER);
    accessors.push({ bufferView: iv, componentType: GL.UNSIGNED_INT, count: idx.length, type: 'SCALAR' });
    const attributes: Record<string, number> = { POSITION: posAcc, NORMAL: norAcc };
    if (uvAcc >= 0) attributes.TEXCOORD_0 = uvAcc;
    primitives.push({ attributes, indices: accessors.length - 1, material: material(m.material, hasUv), mode: GL.TRIANGLES });
    triangles += idx.length / 3;
  }

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'buildobjects-assets3d' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials,
    buffers: [{ byteLength: offset }],
    bufferViews,
    accessors,
  };
  if (textures.length) {
    json.samplers = [{ magFilter: GL.LINEAR, minFilter: GL.LINEAR_MIPMAP_LINEAR, wrapS: GL.REPEAT, wrapT: GL.REPEAT }];
    json.images = images;
    json.textures = textures;
  }
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(jsonBuf.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(bin.length, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, jsonChunk, jsonBuf, binChunk, bin]), triangles, bbox: { min: bbMin, max: bbMax }, textures: images.length };
}
