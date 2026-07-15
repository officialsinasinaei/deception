// Canvas engine helpers: palette extraction, mask ops.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Sample background pixels beneath a box and return N dominant colors (simple bucketing).
export function samplePalette(
  bgCanvas: HTMLCanvasElement | OffscreenCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  count = 5,
): string[] {
  const ctx = (bgCanvas as HTMLCanvasElement).getContext("2d");
  if (!ctx) return ["#888888"];
  const cw = bgCanvas.width,
    ch = bgCanvas.height;
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.min(cw - sx, Math.floor(w));
  const sh = Math.min(ch - sy, Math.floor(h));
  if (sw <= 0 || sh <= 0) return ["#888888"];
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data;
  } catch {
    return ["#888888"];
  }
  // Bucket to 4bit per channel
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 16) {
    // stride 4 pixels
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.r += r;
      e.g += g;
      e.b += b;
      e.n++;
    } else buckets.set(key, { r, g, b, n: 1 });
  }
  const arr = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);
  return arr.map((e) =>
    rgbToHex({
      r: Math.round(e.r / e.n),
      g: Math.round(e.g / e.n),
      b: Math.round(e.b / e.n),
    }),
  );
}

// Load an image. Tries with CORS first (needed for canvas pixel reads);
// falls back to a plain load if the server doesn't return CORS headers.
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Retry without CORS — image will still render but canvas pixel
      // reads (camouflageQuality, hit-testing) will be restricted.
      const img2 = new Image();
      img2.onload = () => resolve(img2);
      img2.onerror = () => reject(new Error(`img load failed: ${src}`));
      img2.src = src;
    };
    img.src = src;
  });
}

// Compute a "camouflage quality" 0..1 by averaging the color distance between
// the paint layer and the background beneath, over the figure mask.
export function camouflageQuality(
  bg: HTMLCanvasElement,
  paint: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
): number {
  const bgCtx = bg.getContext("2d");
  const pCtx = paint.getContext("2d");
  if (!bgCtx || !pCtx) return 0;
  const w = paint.width,
    h = paint.height;
  const sx = Math.max(0, Math.floor(offsetX));
  const sy = Math.max(0, Math.floor(offsetY));
  const sw = Math.min(bg.width - sx, w);
  const sh = Math.min(bg.height - sy, h);
  if (sw <= 0 || sh <= 0) return 0;
  let bgData: Uint8ClampedArray, pData: Uint8ClampedArray;
  try {
    bgData = bgCtx.getImageData(sx, sy, sw, sh).data;
    pData = pCtx.getImageData(0, 0, sw, sh).data;
  } catch {
    return 0;
  }
  let total = 0,
    count = 0;
  for (let i = 0; i < pData.length; i += 16) {
    const a = pData[i + 3];
    if (a < 32) continue;
    const dr = pData[i] - bgData[i];
    const dg = pData[i + 1] - bgData[i + 1];
    const db = pData[i + 2] - bgData[i + 2];
    total += Math.sqrt(dr * dr + dg * dg + db * db);
    count++;
  }
  if (count === 0) return 0;
  const avg = total / count; // 0..441
  // Coverage — how much of the figure was painted
  let painted = 0,
    opaque = 0;
  for (let i = 3; i < pData.length; i += 4) {
    if (pData[i] > 200) painted++;
    opaque++;
  }
  const coverage = opaque ? painted / opaque : 0;
  // Quality: lower avg distance + higher coverage = better
  const colorScore = Math.max(0, 1 - avg / 180);
  return Math.max(0, Math.min(1, 0.4 * coverage + 0.6 * colorScore));
}
