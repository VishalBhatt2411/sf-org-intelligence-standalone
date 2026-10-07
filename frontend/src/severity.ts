export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

export const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_COLOR: Record<string, "default" | "warning" | "error"> = {
  low: "default",
  medium: "default",
  high: "warning",
  critical: "error",
};

export const SEVERITY_HEX: Record<string, string> = {
  critical: "#D93A3F",
  high: "#EE9A12",
  medium: "#FBB22E",
  low: "#BCC5D1",
};

export function sortBySeverity<T extends { severity: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
}
