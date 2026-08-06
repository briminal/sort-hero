import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Generates real, functional PWA icons from a simple inline SVG mark --
 * not placeholders, but not a final brand design either. Swapping the
 * source SVG below is all a future design pass needs to touch; nothing
 * else in the app references these files by anything but their fixed
 * public/ paths. */

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// A rounded square in the app's theme color with "SH" lettering -- simple,
// legible at small sizes, and safe within a maskable icon's center-safe zone.
function markSvg(size: number): string {
  const radius = size * 0.2;
  const fontSize = size * 0.4;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#1d4ed8" />
      <text
        x="50%" y="50%"
        text-anchor="middle" dominant-baseline="central"
        font-family="Arial, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="#ffffff"
      >SH</text>
    </svg>
  `;
}

// Maskable icons need their content within a smaller "safe zone" (roughly
// the center 80%) since platforms crop them to circles/squircles/etc. --
// same mark, just scaled down with padding instead of filling the canvas.
function maskableSvg(size: number): string {
  const inner = Math.round(size * 0.7);
  const offset = Math.round((size - inner) / 2);
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#1d4ed8" />
      <svg x="${offset}" y="${offset}" width="${inner}" height="${inner}">
        ${markSvg(inner)}
      </svg>
    </svg>
  `;
}

async function writeIcon(name: string, svg: string, size: number) {
  const buffer = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const outPath = path.join(PUBLIC_DIR, name);
  await writeFile(outPath, buffer);

  const meta = await sharp(buffer).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${name}: expected ${size}x${size}, got ${meta.width}x${meta.height}`);
  }
  console.log(`  wrote ${name} (${meta.width}x${meta.height})`);
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  console.log("Generating PWA icons...");
  await writeIcon("icon-192.png", markSvg(192), 192);
  await writeIcon("icon-512.png", markSvg(512), 512);
  await writeIcon("icon-maskable-512.png", maskableSvg(512), 512);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
