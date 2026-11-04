// Generates the PWA / favicon PNGs in public/icons/ from the Pixtaha app icon (assets/app-icon-1024.png).
// Run after changing the source: `node scripts/generate-icons.mjs` (uses the pre-installed Playwright + Chromium).
// The source artwork already keeps the mark inside the maskable safe zone, so the maskable icon is the same image.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = `data:image/png;base64,${readFileSync(join(root, "assets/app-icon-1024.png")).toString("base64")}`;

const OUT = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
];

const browser = await chromium.launch();
for (const [name, size] of OUT) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.waitForFunction(() => document.querySelector("img").complete);
  await page.screenshot({ path: join(root, "public/icons", name), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log(`wrote ${OUT.length} icons to public/icons/`);
