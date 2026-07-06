export function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function compactInline(value: string, maxLength = 140): string {
  const clean = singleLine(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3))}...`;
}
