/** @buildobjects/assets3d — parametric (textured) GLBs, the asset manifest, and the photoreal image-to-3D pipeline. */

export {
  ASSETS_DIR,
  type BuildOneOptions,
  type BuildTarget,
  buildOne,
  type RealImagePositions,
  ROOT,
  readManifest,
  resolveMediaRoot,
  texturesFor,
  writeManifest,
} from './build';
export { BUILDERS, type Builder as CategoryBuilder, type BuildOptions, type BuildResult, DEFAULT_DIMS_MM, type Dims } from './builders';
export * from './dims';
export * from './gltf';
export * from './photoreal/jobs';
export { MESHY_COST_USD, MeshyProvider } from './photoreal/meshy';
export * from './photoreal/normalise';
export * from './photoreal/providers';
export { estimateCost, type Outcome, pollUntilDone, type RunOptions, type RunReport, runPhotoreal, type SkuResult } from './photoreal/run';
export * from './photoreal/select-images';
export { TRIPO_COST_USD, TripoProvider } from './photoreal/tripo';
export * from './photoreal/types';
export * from './shapes';
export * from './textures';
