// Rasterise the kimtos brand mark (from brandMarkSvg — the single source) into
// the PNG sizes Chrome needs in the manifest, and the site's favicon/nav assets.
// Run after building the package (it imports the built dist). Renders at 4× then
// downscales for crisp edges.
//
//   npm run render:brand -w @kimtos/icons

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { brandMarkSvg } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// Both consumers share the mark: the extension (manifest icons) and the site
// (favicon + nav fallback).
const targets = [join(repoRoot, 'extension', 'public', 'icons'), join(repoRoot, 'www', 'public', 'assets')];
const sizes = [16, 48, 128];

for (const dir of targets) {
  await mkdir(dir, { recursive: true });
  for (const size of sizes) {
    const svg = brandMarkSvg(size * 4);
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(join(dir, `icon${size}.png`));
  }
}

console.log(`Wrote icon{${sizes.join(',')}}.png to:\n  ${targets.join('\n  ')}`);
