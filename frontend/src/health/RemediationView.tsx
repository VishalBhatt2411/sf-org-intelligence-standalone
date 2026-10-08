import { useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../explorer/nodeStyle";
import { useToast } from "../toast";
import { FINDING_SECTIONS, FINDING_STATUSES, type FindingSection, type FindingStatus, type HealthApi, type RemediationFilters, type Severity } from "./healthApi";
import { ACTIVE_STATUSES, DEFAULT_FILTERS, SECTION_LABEL, STATUS_LABEL, pageRange, remediationParams, severityLabel } from "./healthFormat";
import { FindingsTable } from "./FindingsTable";

const SEVERITIES: Severity[] = ["critical", "warning", "good"];

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const current = list ?? [];
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

function ChipFilter<T extends string>({ label, options, selected, text, onToggle }: { label: string; options: readonly T[]; selected: T[] | undefined; text: (v: T) => string; onToggle: (v: T) => void }) {
  return (
    <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 64 }}>
        {label}
      </Typography>
      {options.map((o) => (
        <Chip key={o} size="small" label={text(o)} color={selected?.includes(o) ? "primary" : "default"} variant={selected?.includes(o) ? "filled" : "outlined"} onClick={() => onToggle(o)} />
      ))}
    </Stack>
  );
}

type Props = { api: HealthApi; onOpenFinding: (id: string) => void };

export function RemediationView({ api, onOpenFinding }: Props) {
  const notify = useToast();
  const [filters, setFilters] = useState<RemediationFilters>(DEFAULT_FILTERS);
  const [glossary, setGlossary] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Changing any filter returns to the first page.
  const change = (patch: Partial<RemediationFilters>) => setFilters((f) => ({ ...f, offset: 0, ...patch }));

  const page = useQuery({ queryKey: ["health-list", api.key, "remediation", filters], queryFn: () => api.remediation(remediationParams(filters)), placeholderData: (prev) => prev });
  const summary = useQuery({ queryKey: ["health-summary", api.key, "remediation"], queryFn: () => api.remediationSummary() });

  const onSort = (key: string) => change({ sort: key, direction: filters.sort === key && filters.direction === "desc" ? "asc" : "desc" });

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await api.exportCsv(remediationParams(filters, { paged: false }));
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "org-health-remediation.csv";
      link.click();
      URL.revokeObjectURL(url);
      if (response.headers["x-truncated"] === "true") notify(`Export holds the first ${response.headers["x-total-rows"]} rows; narrow the filters to get the rest.`, "warning");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  const data = page.data;
  return (
    <Stack gap={2}>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Typography variant="h5" sx={{ flex: 1 }}>
          Remediation
        </Typography>
        <Button size="small" onClick={() => setGlossary(true)}>
          Severity guide
        </Button>
        <Button size="small" variant="outlined" onClick={exportCsv} disabled={exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </Stack>

      {summary.data && (
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Chip label={`${summary.data.active} active`} />
          <Chip label={`${summary.data.overdue} overdue`} color={summary.data.overdue ? "error" : "default"} variant="outlined" onClick={() => change({ overdue: !filters.overdue })} />
          <Chip label={`${summary.data.unassigned} unassigned`} variant="outlined" onClick={() => change({ owner: filters.owner === "unassigned" ? "" : "unassigned" })} />
          <Chip label={`${summary.data.riskExpiringSoon} risk expiring soon`} variant="outlined" onClick={() => change({ expiringRisk: !filters.expiringRisk })} />
        </Stack>
      )}

      <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
        <Stack gap={1}>
          <ChipFilter label="Status" options={FINDING_STATUSES} selected={filters.statuses} text={(s: FindingStatus) => STATUS_LABEL[s]} onToggle={(s) => change({ statuses: toggle(filters.statuses, s) })} />
          <ChipFilter label="Severity" options={SEVERITIES} selected={filters.severities} text={severityLabel} onToggle={(s) => change({ severities: toggle(filters.severities, s) })} />
          <ChipFilter label="Section" options={FINDING_SECTIONS} selected={filters.sections} text={(s: FindingSection) => SECTION_LABEL[s]} onToggle={(s) => change({ sections: toggle(filters.sections, s) })} />
          <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
            <TextField size="small" label="Search" value={filters.search ?? ""} onChange={(e) => change({ search: e.target.value })} />
            <TextField size="small" label="Owner" value={filters.owner ?? ""} onChange={(e) => change({ owner: e.target.value })} helperText="A name, or “unassigned”" />
            <FormControlLabel control={<Checkbox size="small" checked={Boolean(filters.overdue)} onChange={(e) => change({ overdue: e.target.checked })} />} label="Overdue only" />
            <Button size="small" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Reset
            </Button>
          </Stack>
        </Stack>
      </Box>

      {page.isError && <Alert severity="error">{errorMessage(page.error)}</Alert>}
      {page.isLoading ? <CircularProgress size={24} /> : (
        <>
          <FindingsTable rows={data?.rows ?? []} onOpen={onOpenFinding} sort={{ key: filters.sort, direction: filters.direction, onChange: onSort }} empty="No findings match these filters." />
          {data && data.total > 0 && (
            <Stack direction="row" gap={1} alignItems="center" justifyContent="flex-end">
              <Typography variant="caption" color="text.secondary">
                {pageRange(data.total, data.limit, data.offset)}
              </Typography>
              <Button size="small" disabled={filters.offset === 0} onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}>
                Previous
              </Button>
              <Button size="small" disabled={filters.offset + filters.limit >= data.total} onClick={() => setFilters((f) => ({ ...f, offset: f.offset + f.limit }))}>
                Next
              </Button>
            </Stack>
          )}
        </>
      )}
      <Typography variant="caption" color="text.secondary">
        Opens on {ACTIVE_STATUSES.map((s) => STATUS_LABEL[s].toLowerCase()).join(", ")} findings; clear the status chips to see resolved ones.
      </Typography>

      <GlossaryDialog api={api} open={glossary} onClose={() => setGlossary(false)} />
    </Stack>
  );
}

function GlossaryDialog({ api, open, onClose }: { api: HealthApi; open: boolean; onClose: () => void }) {
  const registry = useQuery({ queryKey: ["health-registry", api.key], queryFn: () => api.registry(), enabled: open, staleTime: Infinity });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Severity guide</DialogTitle>
      <DialogContent>
        {registry.isLoading && <CircularProgress size={22} />}
        {registry.isError && <Alert severity="error">{errorMessage(registry.error)}</Alert>}
        {registry.data && (
          <Stack gap={2}>
            {registry.data.bands.map((b) => (
              <Box key={b.severity}>
                <Typography variant="subtitle2">
                  {b.label} · {b.range}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {b.meaning}
                </Typography>
              </Box>
            ))}
            <Typography variant="subtitle2">Rules that raise findings</Typography>
            {registry.data.rules.map((r) => (
              <Typography key={r.ruleKey} variant="body2">
                <b>{SECTION_LABEL[r.section]}</b> · {r.title} — {r.threshold}
              </Typography>
            ))}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
