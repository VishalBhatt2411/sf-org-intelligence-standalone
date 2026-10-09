import { Box } from "@mui/material";
import { initials } from "./relationshipTokens";

// Salesforce object icons come from the UI API in the native app; the standalone has no such source, so an
// initials tile stands in. Standard objects are cobalt, custom objects violet.
export function ObjectGlyph({ label, custom, size = 36, dark = false }: { label: string; custom?: boolean; size?: number; dark?: boolean }) {
  const color = custom ? (dark ? "#B79CF5" : "#7A4FE0") : dark ? "#7C97FF" : "#2B50DD";
  return (
    <Box
      aria-hidden
      sx={{ width: size, height: size, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 1.5, bgcolor: `${color}1F`, color, fontWeight: 700, fontSize: size >= 36 ? 13 : 11, letterSpacing: "0.02em" }}
    >
      {initials(label)}
    </Box>
  );
}
