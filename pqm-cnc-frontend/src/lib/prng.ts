/** Deterministic pseudo-random in [0,1) from (seed, k) — integer hash, no trig. */
export function hash01(seed: number, k: number): number {
  let h = Math.imul((seed * 1000) | 0, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
