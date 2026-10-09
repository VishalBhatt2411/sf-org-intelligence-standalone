import { canvasTokens } from "./nodeStyle";

// The relationship-kind colours are deliberately fixed hues, not theme accents: the legend only works if
// Lookup, Master-Detail and Self stay distinguishable at a glance (same reasoning as native ADR-0028 §2).
// They sit beside the Tech Debt palette: incoming is violet, outgoing is the app's cobalt.
export type RelationshipTokens = {
  incoming: string;
  outgoing: string;
  masterDetail: string;
  self: string;
  object: string;
  good: string;
  accent: string;
  accentWash: string;
  surface: string;
  sunken: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
};

export function relationshipTokens(dark: boolean): RelationshipTokens {
  const c = canvasTokens(dark);
  return dark
    ? {
        incoming: "#A58BF0",
        outgoing: "#7C97FF",
        masterDetail: "#3FC1B9",
        self: "#E573B8",
        object: "#47C98A",
        good: "#47C98A",
        accent: c.selection,
        accentWash: "rgba(124,151,255,0.16)",
        surface: c.card,
        sunken: c.background,
        border: c.cardBorder,
        borderStrong: "#475266",
        text: c.text,
        muted: c.subtext,
      }
    : {
        incoming: "#5E35B1",
        outgoing: "#2B50DD",
        masterDetail: "#0B827C",
        self: "#A61B7B",
        object: "#14854F",
        good: "#14854F",
        accent: c.selection,
        accentWash: "rgba(43,80,221,0.10)",
        surface: "#FFFFFF",
        sunken: "#F7F8FA",
        border: "#D9DDE5",
        borderStrong: "#B4BCC9",
        text: "#11151B",
        muted: "#5E6878",
      };
}

// Two-letter tile text from the first two words, uppercase ("Account Contact Role" -> "AC").
export function initials(label: string): string {
  const words = label.trim().split(/[\s_]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
