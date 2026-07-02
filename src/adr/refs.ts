export function padAdrNumber(n: number): string {
  return String(n).padStart(4, "0");
}

export function formatAdrRef(n: number): string {
  return `ADR-${padAdrNumber(n)}`;
}

export function parseAdrRef(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export function parseAdrRefList(
  value: string | number | Array<string | number> | undefined
): number[] {
  if (value === undefined) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => parseAdrRef(v)).filter((n): n is number => n !== null);
}
