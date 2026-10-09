import { Alert, Box, Paper, Typography } from "@mui/material";
import type { GraphSummary } from "./graphApi";

const fmt = (n: number) => n.toLocaleString();

// What the last scan could and could not read, in plain words, so a sparse graph is never mistaken for a
// small org.
export function CoverageBanner({ summary }: { summary: GraphSummary }) {
  if (summary.coverage === "none") return null;
  if (summary.coverage === "complete") {
    return summary.lastScan?.finishedAt ? (
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Built from the scan finished {new Date(summary.lastScan.finishedAt).toLocaleString()}.
      </Typography>
    ) : null;
  }
  const gaps = summary.stages.filter((s) => s.coverage && s.coverage !== "complete");
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      <strong>{summary.coverage === "degraded" ? "Some parts of the org could not be read." : "Some parts of the org were only partly read."}</strong>{" "}
      Relationships involving them may be missing.
      {gaps.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {gaps.map((g) => (
            <li key={g.category}>
              {g.category}
              {g.detail ? `: ${g.detail}` : ""}
            </li>
          ))}
        </Box>
      )}
    </Alert>
  );
}

export function NoGraphState({ message }: { message: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", pt: 8, px: 3 }}>
      <Paper sx={{ p: 5, maxWidth: 460, textAlign: "center" }}>
        <Typography variant="h6" gutterBottom>
          Nothing to explore yet
        </Typography>
        <Typography color="text.secondary">{message}</Typography>
      </Paper>
    </Box>
  );
}
