import type { Confidence } from "./graphApi";

// Visual tokens for the Explorer canvas. Kind colours come from the app palette; the canvas has its own
// light and dark token sets so it can go dark without the rest of the (light-only) app following.

const KIND_STYLE: Record<string, { color: string; abbr: string }> = {
  CustomObject: { color: "#2B50DD", abbr: "OB" },
  CustomField: { color: "#0E8A8C", abbr: "FD" },
  ApexClass: { color: "#7A4FE0", abbr: "AC" },
  ApexTrigger: { color: "#B044C9", abbr: "AT" },
  Flow: { color: "#E08A00", abbr: "FL" },
  ApprovalProcess: { color: "#D1582B", abbr: "AP" },
  EmailAlert: { color: "#D93A3F", abbr: "EA" },
  ValidationRule: { color: "#C2307C", abbr: "VR" },
  WorkflowRule: { color: "#6C7A89", abbr: "WR" },
  PermissionSet: { color: "#14854F", abbr: "PS" },
  SharingRule: { color: "#3D8DC5", abbr: "SR" },
};

const FALLBACK = { color: "#5E6878", abbr: "··" };
const CLUSTER = { color: "#5E6878", abbr: "+" };

export const kindStyle = (kind: string) => KIND_STYLE[kind] ?? FALLBACK;
export const clusterStyle = () => CLUSTER;

export type CanvasTokens = {
  background: string;
  grid: string;
  card: string;
  cardBorder: string;
  text: string;
  subtext: string;
  edge: string;
  edgeActive: string;
  selection: string;
  warning: string;
  overlay: string;
  overlayBorder: string;
};

const LIGHT: CanvasTokens = {
  background: "#F4F6F9",
  grid: "#E1E5EB",
  card: "#FFFFFF",
  cardBorder: "#D3D9E2",
  text: "#11151B",
  subtext: "#5E6878",
  edge: "#8C97A8",
  edgeActive: "#2B50DD",
  selection: "#2B50DD",
  warning: "#D93A3F",
  overlay: "rgba(255,255,255,0.94)",
  overlayBorder: "rgba(17,21,27,0.12)",
};

const DARK: CanvasTokens = {
  background: "#0E1116",
  grid: "#1A2029",
  card: "#1A1F27",
  cardBorder: "#2C3441",
  text: "#E6EAF0",
  subtext: "#8C97A8",
  edge: "#5E6878",
  edgeActive: "#7C97FF",
  selection: "#7C97FF",
  warning: "#FF6B70",
  overlay: "rgba(26,31,39,0.94)",
  overlayBorder: "rgba(255,255,255,0.12)",
};

export const canvasTokens = (dark: boolean): CanvasTokens => (dark ? DARK : LIGHT);

export const DASH: Record<"solid" | "dashed" | "dotted", string | undefined> = { solid: undefined, dashed: "7 4", dotted: "2 4" };

// Heuristic edges (Apex name matching) are drawn fainter so they never read as certain.
export const edgeOpacity = (confidence: Confidence): number => (confidence === "heuristic" ? 0.5 : confidence === "parsed" ? 0.8 : 1);

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  exact: "Exact",
  parsed: "Parsed from source",
  heuristic: "Heuristic (name match)",
};

export const humanizeKind = (kind: string): string => kind.replace(/_/g, " ").toLowerCase();

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

export function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { error?: unknown; message?: unknown } }; message?: unknown } | null;
  const fromBody = e?.response?.data?.error ?? e?.response?.data?.message;
  if (typeof fromBody === "string" && fromBody) return fromBody;
  return typeof e?.message === "string" && e.message ? e.message : "Something went wrong";
}
