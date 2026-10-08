import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, LinearProgress, Stack, Typography, useTheme } from "@mui/material";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../explorer/nodeStyle";
import { useToast } from "../toast";
import type { FindingSection, HealthApi, Kpi, SectionKey } from "./healthApi";
import { ACTIVE_STATUSES, formatDate, isNotRun, relativeTime, remediationParams, trendDelta } from "./healthFormat";
import { BreakdownList, Facts, FormulaDisclosure, Heatmap, KpiStrip, ScoreRing, SeverityBadge, StateBanner } from "./healthParts";
import { FindingsTable } from "./FindingsTable";

const FINDING_SECTION_KEYS: SectionKey[] = ["metadata", "automation", "code", "security", "data"];

// Sections whose result is recomputed on the server by a POST; Data runs in the background instead.
const SYNCABLE: SectionKey[] = ["metadata", "automation", "code", "security"];

type Props = { api: HealthApi; section: SectionKey; onOpenFinding: (id: string) => void };

export function SectionView({ api, section, onOpenFinding }: Props) {
  const client = useQueryClient();
  const notify = useToast();
  const [drill, setDrill] = useState<Kpi | null>(null);

  const result = useQuery({ queryKey: ["health-section", api.key, section], queryFn: () => api.section(section) });
  const hasFindings = FINDING_SECTION_KEYS.includes(section);
  const findings = useQuery({
    queryKey: ["health-list", api.key, "section", section],
    queryFn: () => api.findings(remediationParams({ sections: [section as FindingSection], statuses: ACTIVE_STATUSES, sort: "severity", direction: "desc", limit: 50, offset: 0 })),
    enabled: hasFindings,
  });
  const trend = useQuery({ queryKey: ["health-trend", api.key, section], queryFn: () => api.trend(section), enabled: Boolean(result.data?.scored) });

  const refreshAll = () => {
    client.invalidateQueries({ queryKey: ["health-section", api.key] });
    client.invalidateQueries({ queryKey: ["health-list", api.key] });
    client.invalidateQueries({ queryKey: ["health-trend", api.key] });
    client.invalidateQueries({ queryKey: ["health-summary", api.key] });
  };

  const sync = useMutation({
    mutationFn: () => api.sync(section),
    onSuccess: (report) => {
      refreshAll();
      const f = report.findings;
      notify(f ? `Updated — ${f.created} new, ${f.reopened} reopened, ${f.resolved} resolved` : "Updated");
    },
    onError: (e) => notify(errorMessage(e), "error"),
  });

  if (result.isLoading) return <CircularProgress size={24} />;
  if (result.isError || !result.data) return <Alert severity="error">{errorMessage(result.error)}</Alert>;
  const data = result.data;
  const notRun = isNotRun(data);

  return (
    <Stack gap={2.5}>
      <Stack direction="row" gap={2.5} alignItems="center" flexWrap="wrap">
        {data.scored && <ScoreRing score={data.score} severity={data.severity} />}
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Stack direction="row" gap={1} alignItems="center">
            <Typography variant="h5">{data.label}</Typography>
            {data.scored && <SeverityBadge severity={data.severity} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {notRun ? "Not run yet" : `Updated ${relativeTime(data.computedAt)}`} · {data.basis === "live" ? "read live from Salesforce" : "from the last scan"}
          </Typography>
          {data.scored && <TrendLine points={trend.data ?? []} />}
        </Box>
        {section === "data" ? (
          <DataRunControl api={api} onFinished={refreshAll} />
        ) : SYNCABLE.includes(section) ? (
          <Button variant="contained" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Working…" : section === "security" ? "Run check" : "Refresh"}
          </Button>
        ) : section === "storage" ? (
          <Button variant="outlined" onClick={() => result.refetch()} disabled={result.isFetching}>
            Refresh
          </Button>
        ) : null}
      </Stack>

      <StateBanner result={data} />
      <KpiStrip kpis={data.kpis} onOpen={setDrill} />
      <FormulaDisclosure formula={data.formula} />
      <BreakdownList {...data.breakdown} />
      <Heatmap heatmap={data.heatmap} />
      <Facts facts={data.facts} />

      {hasFindings && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Open findings
          </Typography>
          {findings.isLoading ? <CircularProgress size={20} /> : <FindingsTable rows={findings.data?.rows ?? []} onOpen={onOpenFinding} showSection={false} empty={notRun ? "Run the check to see findings." : "No open findings — nothing needs attention here."} />}
          {(findings.data?.total ?? 0) > (findings.data?.rows.length ?? 0) && (
            <Typography variant="caption" color="text.secondary">
              Showing the first {findings.data!.rows.length} of {findings.data!.total}. The Remediation tab lists them all.
            </Typography>
          )}
        </Box>
      )}

      <DrilldownDialog api={api} section={section} kpi={drill} onClose={() => setDrill(null)} />
    </Stack>
  );
}

function TrendLine({ points }: { points: Array<{ at: string; score: number | null }> }) {
  const color = useTheme().palette.primary.main;
  const delta = trendDelta(points);
  if (points.length < 2) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ height: 80, maxWidth: 420 }}>
        <ResponsiveContainer>
          <LineChart data={points.map((p) => ({ at: formatDate(p.at), score: p.score }))}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="at" hide />
            <YAxis domain={[0, 100]} width={28} tick={{ fontSize: 11 }} />
            <ChartTooltip />
            <Line type="monotone" dataKey="score" stroke={color} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Box>
      {delta !== null && (
        <Typography variant="caption" color="text.secondary">
          {delta === 0 ? "No change since the previous run" : `${delta > 0 ? "+" : ""}${delta} since the previous run`}
        </Typography>
      )}
    </Box>
  );
}

function DrilldownDialog({ api, section, kpi, onClose }: { api: HealthApi; section: SectionKey; kpi: Kpi | null; onClose: () => void }) {
  const drill = useQuery({ queryKey: ["health-drill", api.key, section, kpi?.drilldownKey], queryFn: () => api.drilldown(section, kpi!.drilldownKey!), enabled: Boolean(kpi?.drilldownKey) });
  return (
    <Dialog open={Boolean(kpi)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{drill.data?.title ?? kpi?.label}</DialogTitle>
      <DialogContent>
        {drill.isLoading && <CircularProgress size={22} />}
        {drill.isError && <Alert severity="error">{errorMessage(drill.error)}</Alert>}
        {drill.data && (drill.data.rows.length === 0 ? <Typography variant="body2">Nothing to list.</Typography> : <BreakdownList title="" caption={drill.data.caption} columns={drill.data.columns} rows={drill.data.rows} />)}
      </DialogContent>
    </Dialog>
  );
}

// Starts the Data check in the background and follows it until it ends.
function DataRunControl({ api, onFinished }: { api: HealthApi; onFinished: () => void }) {
  const notify = useToast();
  const client = useQueryClient();
  const run = useQuery({
    queryKey: ["health-datarun", api.key],
    queryFn: () => api.dataRun(),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
  const status = run.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === "running" && status && status !== "running") {
      onFinished();
      if (status === "failed") notify(run.data?.message ?? "The Data check failed", "error");
      else notify("Data check finished");
    }
    previous.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useMutation({
    mutationFn: () => api.startDataRun(),
    onSuccess: () => client.invalidateQueries({ queryKey: ["health-datarun", api.key] }),
    onError: (e) => notify(errorMessage(e), "error"),
  });

  const running = status === "running";
  return (
    <Box sx={{ minWidth: 200 }}>
      <Button variant="contained" onClick={() => start.mutate()} disabled={running || start.isPending}>
        {running ? "Checking…" : "Run Data check"}
      </Button>
      {running && <LinearProgress sx={{ mt: 1 }} />}
      {status === "failed" && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
          {run.data?.message ?? "The last run failed."}
        </Typography>
      )}
    </Box>
  );
}
