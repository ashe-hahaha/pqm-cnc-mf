import { clsx, type ClassValue } from "clsx";

export function cn(...parts: ClassValue[]): string {
  return clsx(parts);
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function cpkLabel(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(2);
}
