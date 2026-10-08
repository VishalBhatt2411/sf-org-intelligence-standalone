import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../explorer/nodeStyle";
import type { HealthApi, SectionKey, SummaryCard } from "./healthApi";
import { relativeTime, scoreText, severityLabel } from "./healthFormat";
import { ScoreRing, SeverityBadge, useSeverityColor } from "./healthParts";

type Props = { api: HealthApi; onOpenSection: (section: SectionKey) => void };

function CategoryCard({ card, onOpen }: { card: SummaryCard; onOpen: () => void }) {
  const color = useSeverityColor()(card.severity);
  const hasScore = card.score !== null;
  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={{ textAlign: "left", font: "inherit", color: "inherit", bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 3, p: 2, cursor: "pointer", "&:hover": { borderColor: "primary.main" } }}
    >
      <Stack direction="row" gap={2} alignItems="center">
        {card.scored ? (
          <ScoreRing score={card.score} severity={card.severity} size={64} />
        ) : (
          <Box sx={{ width: 64, height: 64, borderRadius: "50%", border: 3, borderColor: hasScore ? color : "divider", flexShrink: 0 }} />
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {card.label}
          </Typography>
          {card.scored ? <SeverityBadge severity={card.severity} /> : <Typography variant="caption" color="text.secondary">Not scored</Typography>}
        </Box>
      </Stack>
      <Typography variant="body2" sx={{ mt: 1.5 }}>
        {card.topSignal ?? card.note}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {card.computedAt ? `Updated ${relativeTime(card.computedAt)}` : card.live ? "Not run yet" : "Not available yet"}
        {card.complete ? "" : " · incomplete"}
      </Typography>
    </Box>
  );
}

export function OverviewView({ api, onOpenSection }: Props) {
  const summary = useQuery({ queryKey: ["health-summary", api.key], queryFn: () => api.summary() });
  if (summary.isLoading) return <CircularProgress size={24} />;
  if (summary.isError || !summary.data) return <Alert severity="error">{errorMessage(summary.error)}</Alert>;
  const { findings } = summary.data;
  // The Overview itself is not a category; its card only carries the roll-up.
  const cards = summary.data.cards.filter((c) => c.section !== "overview");

  const stats: Array<[string, number]> = [
    ["Active findings", findings.active],
    ["Critical", findings.activeBySeverity.critical],
    ["Warning", findings.activeBySeverity.warning],
    ["Overdue", findings.overdue],
    ["Unassigned", findings.unassigned],
    ["Risk expiring soon", findings.riskExpiringSoon],
  ];

  return (
    <Stack gap={2.5}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1.5 }}>
        {stats.map(([label, value]) => (
          <Box key={label} sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="h6">{scoreText(value)}</Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2 }}>
        {cards.map((card) => (
          <CategoryCard key={card.section} card={card} onOpen={() => onOpenSection(card.section)} />
        ))}
      </Box>
      {cards.some((c) => !c.complete && c.computedAt) && (
        <Alert severity="warning">
          Some sections are incomplete ({cards.filter((c) => !c.complete && c.computedAt).map((c) => `${c.label}: ${severityLabel(c.severity)}`).join(", ")}). Open them for details.
        </Alert>
      )}
    </Stack>
  );
}
