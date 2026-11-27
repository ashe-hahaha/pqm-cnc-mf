/** Negative wear uses a lower limit. Positive limits retain their existing upper-limit behavior. */
export function wearExceeded(value: number, threshold: number): boolean {
  return threshold < 0 ? value < threshold : value > threshold;
}
