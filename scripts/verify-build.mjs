import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsDirectory = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const assets = readdirSync(assetsDirectory);
const workerAsset = assets.find((asset) => /^maplibre-gl-worker-[\w-]+\.js$/.test(asset));

if (!workerAsset) {
  throw new Error('Production build is missing the MapLibre worker asset.');
}

const referencesWorker = assets
  .filter((asset) => asset.endsWith('.js'))
  .some((asset) => readFileSync(join(assetsDirectory, asset), 'utf8').includes(workerAsset));

if (!referencesWorker) {
  throw new Error(`Production build does not reference the MapLibre worker asset: ${workerAsset}`);
}

console.log(`Production build verified: ${workerAsset} is emitted and referenced.`);
