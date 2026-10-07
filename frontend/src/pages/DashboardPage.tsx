import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Grid, Paper, Typography, Chip, Stack, Button, Menu, MenuItem, Collapse, Divider } from "@mui/material";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { api, Finding, HealthHistoryPoint, HealthScore, ScanDiff } from "../api/client";
import { SEVERITY_COLOR, SEVERITY_HEX } from "../severity";
import type { FindingsFilter } from "./FindingsPage";

// Fixed status roles — reused everywhere a score/health value needs color, never
// repurposed for series identity.
const STATUS = { good: "#14854F", warning: "#EE9A12", critical: "#D93A3F" };
const MUTED_TEXT = "#5E6878";
const RISK_PILL = {
  good: { label: "Healthy", bg: "#E8F7EF", fg: "#0B5333" },
  warning: { label: "Needs attention", bg: "#FFF7E6", fg: "#9E5E0A" },
  critical: { label: "At risk", bg: "#FCE4E4", fg: "#B82A2F" },
};
const GAUGE_ARC = "M 20 110 A 80 80 0 0 1 180 110";
const GAUGE_ARC_LENGTH = Math.PI * 80;

function statusOf(score: number): keyof typeof STATUS {
  if (score >= 75) return "good";
  if (score >= 50) return "warning";
  return "critical";
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score: number) {
  return STATUS[statusOf(score)];
}

const RADIAN = Math.PI / 180;

function renderSliceLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, value } = props;
  const radius = outerRadius + 18;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={13} fontWeight={700} fill="#11151B">
      {value}
    </text>
  );
}

function HealthTrendTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Paper sx={{ px: 1.5, py: 1 }} elevation={3}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {new Date(p.startedAt).toLocaleDateString()}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {p.overall} / 100
      </Typography>
    </Paper>
  );
}

async function downloadReport(scanId: string, format: "pdf" | "xlsx") {
  const res = await api.get(`/scans/${scanId}/export`, { params: { format }, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = `tech-debt-report.${format}`;
  a.click();
  window.URL.revokeObjectURL(url);
}

function ExportReportButton({ scanId }: { scanId: string }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <>
      <Button variant="outlined" size="small" onClick={(e) => setAnchorEl(e.currentTarget)}>
        Export Report
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            downloadReport(scanId, "pdf");
          }}
        >
          Download as PDF
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            downloadReport(scanId, "xlsx");
          }}
        >
          Download as Excel
        </MenuItem>
      </Menu>
    </>
  );
}

function DiffFindingList({ findings }: { findings: Finding[] }) {
  return (
    <Stack spacing={0.75} sx={{ mt: 1.5 }}>
      {findings.map((f) => (
        <Stack key={f.id} direction="row" spacing={1} alignItems="center">
          <Chip size="small" label={f.severity} color={SEVERITY_COLOR[f.severity]} sx={{ flexShrink: 0 }} />
          <Typography variant="body2" noWrap>
            {f.title}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function SinceLastScanCard({ scanId }: { scanId: string }) {
  const [expanded, setExpanded] = useState<"new" | "resolved" | null>(null);

  const diff = useQuery({
    queryKey: ["scanDiff", scanId],
    queryFn: () => api.get<ScanDiff>(`/scans/${scanId}/diff`).then((r) => r.data),
  });

  if (!diff.data?.previousScanId) return null;

  return (
    <Grid item xs={12} md={4}>
      <Paper sx={{ p: 3, height: "100%" }}>
        <Typography variant="subtitle1" gutterBottom>
          Since Last Scan
        </Typography>
        <Stack direction="row" spacing={2}>
          <Chip
            label={`+${diff.data.newFindings.length} new`}
            color={diff.data.newFindings.length > 0 ? "error" : "default"}
            onClick={() => setExpanded(expanded === "new" ? null : "new")}
          />
          <Chip
            label={`−${diff.data.resolvedFindings.length} resolved`}
            color={diff.data.resolvedFindings.length > 0 ? "success" : "default"}
            onClick={() => setExpanded(expanded === "resolved" ? null : "resolved")}
          />
        </Stack>
        <Collapse in={expanded === "new"}>
          <DiffFindingList findings={diff.data.newFindings} />
        </Collapse>
        <Collapse in={expanded === "resolved"}>
          <DiffFindingList findings={diff.data.resolvedFindings} />
        </Collapse>
      </Paper>
    </Grid>
  );
}

export function DashboardPage({
  scanId,
  connectionId,
  onNavigateToFindings,
}: {
  scanId: string;
  connectionId: string;
  onNavigateToFindings: (filter: FindingsFilter) => void;
}) {
  const health = useQuery({
    queryKey: ["health", scanId],
    queryFn: () => api.get<HealthScore>(`/scans/${scanId}/health`).then((r) => r.data),
  });

  const findings = useQuery({
    queryKey: ["findings", scanId],
    queryFn: () => api.get<Finding[]>(`/findings?scanId=${scanId}`).then((r) => r.data),
  });

  const healthHistory = useQuery({
    queryKey: ["healthHistory", connectionId],
    queryFn: () =>
      api.get<HealthHistoryPoint[]>(`/connections/${connectionId}/health-history`).then((r) => r.data),
  });

  if (health.isLoading || findings.isLoading) return <Typography sx={{ p: 4 }}>Loading...</Typography>;
  if (!health.data?.categoryScores) return <Typography sx={{ p: 4 }}>No health data yet.</Typography>;

  const overall = health.data.overall;
  const openFindings = (findings.data || []).filter((f) => f.status !== "resolved" && f.status !== "wont_fix");

  const categoryData = Object.entries(health.data.categoryScores)
    .map(([category, score]) => ({
      category: titleCase(category),
      rawCategory: category,
      score,
      openCount: openFindings.filter((f) => f.category === category).length,
    }))
    .sort((a, b) => a.score - b.score);

  const weakestCategory = categoryData[0];
  const strongestCategory = categoryData[categoryData.length - 1];
  const priorOverall =
    healthHistory.data && healthHistory.data.length >= 2
      ? healthHistory.data[healthHistory.data.length - 2].overall
      : null;
  const overallDelta = priorOverall != null ? overall - priorOverall : null;

  const severityData = ["critical", "high", "medium", "low"]
    .map((severity) => ({
      name: severity,
      value: openFindings.filter((f) => f.severity === severity).length,
    }))
    .filter((d) => d.value > 0);

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h6">Overview</Typography>
        <ExportReportButton scanId={scanId} />
      </Box>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, height: 320, display: "flex", flexDirection: "column" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle1">Org health score</Typography>
              <Box
                sx={{
                  px: 1.25,
                  py: 0.4,
                  borderRadius: 999,
                  fontSize: 11.5,
                  bgcolor: RISK_PILL[statusOf(overall)].bg,
                  color: RISK_PILL[statusOf(overall)].fg,
                }}
              >
                {RISK_PILL[statusOf(overall)].label}
              </Box>
            </Stack>
            <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Box component="svg" viewBox="0 0 200 128" sx={{ width: "100%", maxWidth: 230, overflow: "visible" }}>
                <path d={GAUGE_ARC} fill="none" stroke="#E9EDF2" strokeWidth={16} strokeLinecap="round" />
                <path
                  d={GAUGE_ARC}
                  fill="none"
                  stroke={scoreColor(overall)}
                  strokeWidth={16}
                  strokeLinecap="round"
                  strokeDasharray={`${(overall / 100) * GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`}
                />
                <text
                  x="100"
                  y="102"
                  textAnchor="middle"
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
                  fontSize={46}
                  fontWeight={500}
                  fill="#11151B"
                >
                  {overall}
                </text>
              </Box>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: -1 }}>
              out of 100
              {overallDelta != null &&
                ` · ${
                  overallDelta === 0
                    ? "no change"
                    : overallDelta > 0
                    ? `up ${overallDelta} point${overallDelta === 1 ? "" : "s"}`
                    : `down ${-overallDelta} point${overallDelta === -1 ? "" : "s"}`
                }`}
            </Typography>
            <Divider sx={{ mt: 2, mb: 1.5 }} />
            <Stack spacing={1}>
              {weakestCategory && (
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Weakest category
                  </Typography>
                  <Typography variant="body2">
                    {weakestCategory.category} &middot; {weakestCategory.score}
                  </Typography>
                </Stack>
              )}
              {strongestCategory && strongestCategory !== weakestCategory && (
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Strongest
                  </Typography>
                  <Typography variant="body2">
                    {strongestCategory.category} &middot; {strongestCategory.score}
                  </Typography>
                </Stack>
              )}
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, height: 320 }}>
            <Typography variant="subtitle1" gutterBottom>
              Findings by Severity
            </Typography>
            {severityData.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 2 }}>
                No open findings — nice and clean.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2, height: "90%" }}>
                <Stack spacing={1} sx={{ minWidth: 130, flexShrink: 0 }}>
                  {severityData.map((d) => (
                    <Stack
                      key={d.name}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      onClick={() => onNavigateToFindings({ severity: d.name })}
                      sx={{ cursor: "pointer", "&:hover": { opacity: 0.75 } }}
                    >
                      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: SEVERITY_HEX[d.name], flexShrink: 0 }} />
                      <Typography variant="body2" sx={{ textTransform: "capitalize", flexGrow: 1 }}>
                        {d.name}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {d.value}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>

                <Box sx={{ position: "relative", flexGrow: 1, height: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={severityData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        onClick={(entry) => onNavigateToFindings({ severity: entry.name })}
                        cursor="pointer"
                        label={renderSliceLabel}
                        labelLine={{ stroke: "#D8DEE7" }}
                      >
                        {severityData.map((entry) => (
                          <Cell key={entry.name} fill={SEVERITY_HEX[entry.name]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box
                    sx={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      textAlign: "center",
                      pointerEvents: "none",
                    }}
                  >
                    <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                      {openFindings.length}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      open
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}
          </Paper>
        </Grid>

        <SinceLastScanCard scanId={scanId} />

        {(healthHistory.data?.length || 0) > 1 && (
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 3, height: "100%" }}>
              <Typography variant="subtitle1" gutterBottom>
                Health Score Trend
              </Typography>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={healthHistory.data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E9EDF2" vertical={false} />
                  <XAxis
                    dataKey="startedAt"
                    tickFormatter={(v) => new Date(v).toLocaleDateString()}
                    tick={{ fill: MUTED_TEXT, fontSize: 12 }}
                    axisLine={{ stroke: "#D8DEE7" }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fill: MUTED_TEXT, fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<HealthTrendTooltip />} />
                  <Line type="monotone" dataKey="overall" stroke={scoreColor(overall)} strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        )}

        <Grid item xs={12} sx={{ mt: 1 }}>
          <Typography variant="h6">Details</Typography>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
              <Typography variant="subtitle1" gutterBottom>
                Category Scores
              </Typography>
              <Stack direction="row" spacing={2}>
                {(["good", "warning", "critical"] as const).map((s) => (
                  <Stack key={s} direction="row" spacing={0.75} alignItems="center">
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: STATUS[s] }} />
                    <Typography variant="caption" color="text.secondary">
                      {s === "good" ? "Healthy (≥75)" : s === "warning" ? "Needs attention (50–74)" : "Critical (<50)"}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Box sx={{ mt: 0.5 }}>
              {categoryData.map((c, i) => (
                <Box
                  key={c.category}
                  onClick={() => onNavigateToFindings({ category: c.rawCategory })}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(110px, 150px) minmax(0, 1fr) 44px",
                    alignItems: "center",
                    gap: 2.5,
                    py: 1.5,
                    borderTop: i === 0 ? "none" : "1px solid",
                    borderColor: "divider",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Typography variant="body2">{c.category}</Typography>
                  <Box sx={{ height: 8, borderRadius: 999, bgcolor: "#E9EDF2", overflow: "hidden" }}>
                    <Box
                      sx={{
                        height: "100%",
                        borderRadius: 999,
                        width: `${Math.max(c.score, 0.6)}%`,
                        bgcolor: scoreColor(c.score),
                      }}
                    />
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                  >
                    {c.score}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>

      </Grid>
    </Box>
  );
}
