export function toolKey(value: number | string | null | undefined): string {
  const match = /^T?([0-9]+)$/i.exec(String(value).trim());
  return match ? match[1].replace(/^0+(?=\d)/, "") : "unknown";
}

export function toolLabel(key: string): string {
  return key === "unknown" ? "Unknown tool" : `T${key.padStart(2, "0")}`;
}
