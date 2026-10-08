import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import type { GraphApi, GraphNode, GraphSummary } from "./graphApi";
import { errorMessage, kindStyle } from "./nodeStyle";

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

export function StartScreen({ api, connectionId, summary, onPick }: { api: GraphApi; connectionId: string; summary: GraphSummary; onPick: (node: GraphNode) => void }) {
  const [typeKey, setTypeKey] = useState<string | null>(summary.nodesByType.find((t) => t.kind === "CustomObject")?.typeKey ?? summary.nodesByType[0]?.typeKey ?? null);
  const list = useQuery({
    queryKey: ["graph", "browse", connectionId, typeKey],
    queryFn: () => api.browse(typeKey!),
    enabled: Boolean(typeKey),
    staleTime: 60_000,
  });

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 980, mx: "auto", width: "100%", overflowY: "auto" }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Explore your org as a graph
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2.5 }}>
        Search for a component, or pick one below. Each card expands to show what it uses and what uses it. {fmt(summary.totalNodes)} components and {fmt(summary.totalEdges)} relationships are available.
      </Typography>
      <CoverageBanner summary={summary} />

      <Typography variant="overline" color="text.secondary">
        Browse by type
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ my: 1 }}>
        {summary.nodesByType.map((t) => {
          const style = kindStyle(t.kind);
          const active = t.typeKey === typeKey;
          return (
            <Chip
              key={t.typeKey}
              label={`${t.kindLabel} · ${fmt(t.count)}`}
              onClick={() => setTypeKey(t.typeKey)}
              variant={active ? "filled" : "outlined"}
              sx={active ? { bgcolor: `${style.color}1F`, color: style.color, borderColor: style.color, fontWeight: 500 } : undefined}
            />
          );
        })}
      </Stack>

      <Paper sx={{ mt: 1.5, overflow: "hidden" }}>
        {list.isLoading ? (
          <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={22} />
          </Box>
        ) : list.isError ? (
          <Alert severity="error">{errorMessage(list.error)}</Alert>
        ) : (list.data?.nodes.length ?? 0) === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            Nothing of this type in the last scan.
          </Typography>
        ) : (
          <>
            {list.data!.nodes.map((n) => (
              <Box key={n.nodeKey} onClick={() => onPick(n)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(n)} sx={{ px: 2, py: 1.1, cursor: "pointer", borderBottom: "1px solid", borderColor: "divider", "&:hover, &:focus-visible": { bgcolor: "action.hover", outline: "none" } }}>
                <Typography variant="body2">{n.label}</Typography>
                {n.fqn !== n.label && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
                    {n.fqn}
                  </Typography>
                )}
              </Box>
            ))}
            {list.data!.truncated && (
              <Typography variant="caption" color="text.secondary" sx={{ p: 1.5, display: "block" }}>
                Showing the first {list.data!.nodes.length}. Use search to find others.
              </Typography>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
}
