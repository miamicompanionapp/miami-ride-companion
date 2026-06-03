import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'icons');
const out = join(root, 'public', 'icons');

// The design wired into the PWA. Change to 'a' or 'b' to switch and re-run.
const CHOSEN = 'c';
const variants = ['a', 'b', 'c'];
const sizes = [192, 512];

// Render the chosen design to the canonical names the manifest references.
const chosenSvg = readFileSync(join(src, `icon-${CHOSEN}.svg`));
for (const s of sizes) {
  await sharp(chosenSvg, { density: 384 })
    .resize(s, s)
    .png()
    .toFile(join(out, `icon-${s}.png`));
  console.log(`public/icons/icon-${s}.png  (design ${CHOSEN})`);
}

// Contact sheet of all variants, kept in assets/ for design review (not deployed).
const tile = 256, gap = 24, pad = 24;
const sheetW = pad * 2 + tile * 3 + gap * 2;
const sheetH = pad * 2 + tile;
const tiles = await Promise.all(
  variants.map((v) =>
    sharp(readFileSync(join(src, `icon-${v}.svg`)), { density: 384 })
      .resize(tile, tile)
      .png()
      .toBuffer()
  )
);
await sharp({
  create: { width: sheetW, height: sheetH, channels: 4, background: '#222831' },
})
  .composite(tiles.map((input, i) => ({ input, left: pad + i * (tile + gap), top: pad })))
  .png()
  .toFile(join(src, '_preview.png'));
console.log('assets/icons/_preview.png');
