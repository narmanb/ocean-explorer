// Small, dependency-free helpers shared by source and offline builds.
export function targetSize(width, height, dpr, scale, limit, forcedW = 0, forcedH = 0, out = []) {
  const valid = (v) => Number.isFinite(v) && v > 0;
  const w = valid(forcedW) ? Math.floor(forcedW) : Math.max(1, Math.round(width * dpr * scale));
  const h = valid(forcedH) ? Math.floor(forcedH) : Math.max(1, Math.round(height * dpr * scale));
  const fit = Math.min(1, limit / Math.max(w, h));
  out[0] = Math.max(1, Math.floor(w * fit)); out[1] = Math.max(1, Math.floor(h * fit));
  return out;
}
export function bloomLevels(width, height) {
  return Math.min(8, Math.floor(Math.log2(Math.max(1, width >> 1, height >> 1))) + 1);
}
export function summarizeSamples(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { frames: samples.length, fps: 1000 / mean, meanMs: mean, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
}
