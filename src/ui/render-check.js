/**
 * Rendered match: draws the desired username and a candidate with this computer's fonts and measures how
 * much of their ink overlaps (with a 1-pixel tolerance). The engine's similarity comes from Unicode data;
 * this catches what only rendering shows, such as a glyph this computer draws differently or as an empty box.
 *
 * Fonts differ between devices, so this is a local check, not a prediction of how TikTok will draw it.
 */
const SIZE = 48;
let canvas;
let ctx;
const cache = new Map();

function context() {
  if (!ctx) {
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  return ctx;
}

function rasterize(text, font) {
  const key = font + "\u0000" + text;
  if (cache.has(key)) return cache.get(key);
  const c = context();
  c.font = `${SIZE}px ${font}`;
  const width = Math.max(1, Math.ceil(c.measureText(text).width) + 8);
  const height = Math.ceil(SIZE * 1.6);
  canvas.width = width;
  canvas.height = height;
  c.font = `${SIZE}px ${font}`;
  c.textBaseline = "alphabetic";
  c.fillStyle = "#000";
  c.fillText(text, 4, Math.round(SIZE * 1.15));
  const data = c.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 96 ? 1 : 0;
  const result = { width, height, mask };
  cache.set(key, result);
  return result;
}

function widen(r, width) {
  if (r.width === width) return r.mask;
  const out = new Uint8Array(width * r.height);
  for (let y = 0; y < r.height; y++) out.set(r.mask.subarray(y * r.width, (y + 1) * r.width), y * width);
  return out;
}

function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** 0–1: share of each rendering's ink that lands on (or next to) the other's ink. */
export function renderedMatch(target, candidate, font) {
  if (target === candidate) return 1;
  const a = rasterize(target, font);
  const b = rasterize(candidate, font);
  const width = Math.max(a.width, b.width);
  const height = a.height;
  const ma = widen(a, width);
  const mb = widen(b, width);
  const da = dilate(ma, width, height);
  const db = dilate(mb, width, height);
  let inkA = 0;
  let inkB = 0;
  let hitA = 0;
  let hitB = 0;
  for (let i = 0; i < ma.length; i++) {
    if (ma[i]) {
      inkA++;
      if (db[i]) hitA++;
    }
    if (mb[i]) {
      inkB++;
      if (da[i]) hitB++;
    }
  }
  if (inkA + inkB === 0) return 1;
  return (hitA + hitB) / (inkA + inkB);
}

/** The font stack the previews use, read from the stylesheet so both always agree. */
export function previewFont() {
  const probe = document.createElement("span");
  probe.className = "preview";
  probe.hidden = true;
  document.body.append(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "sans-serif";
}
