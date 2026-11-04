// Generates the PWA / favicon PNGs in public/icons/ from public/icons/icon.svg.
// Run once after changing the SVG: `node scripts/generate-icons.mjs` (uses the pre-installed Playwright + Chromium).
// The "P" is rendered with the self-hosted IBM Plex Sans 500 from @fontsource, inlined as a data URL.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
const svg = readFileSync(join(outDir, "icon.svg"), "utf8");
const font = readFileSync(join(root, "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2")).toString("base64");

// scale < 1 shrinks the mark around the center (maskable: keep the artwork inside the 80% safe zone).
const targets = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.78 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.9 },
  { file: "favicon-32.png", size: 32, scale: 1.12 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  const scaled = svg.replace('<g id="mark">', `<g id="mark" transform="translate(256 256) scale(${t.scale}) translate(-256 -256)">`);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: "IBM Plex Sans"; font-weight: 500; src: url(data:font/woff2;base64,${font}) format("woff2"); }
    html, body { margin: 0; background: #14110E; }
    svg { display: block; width: ${t.size}px; height: ${t.size}px; }
  </style></head><body>${scaled}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, t.file), clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log(`wrote public/icons/${t.file} (${t.size}x${t.size})`);
}
await browser.close();
