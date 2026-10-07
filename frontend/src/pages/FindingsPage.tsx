import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  Collapse,
  CircularProgress,
  Divider,
  TextField,
  MenuItem,
  Select,
  Stack,
  Pagination,
} from "@mui/material";
import { api, Finding, FindingStatus } from "../api/client";
import { SEVERITY_COLOR, SEVERITY_HEX, sortBySeverity } from "../severity";
import { useToast } from "../toast";
import { OpenInSalesforceButton } from "../components/OpenInSalesforceButton";

type FindingDetail = Finding & { recommendations: { explanation: string; recommendation: string }[] };

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  wont_fix: "Won't Fix",
};

function StatusSelect({ finding }: { finding: Finding }) {
  const queryClient = useQueryClient();
  const notify = useToast();

  const updateStatus = useMutation({
    mutationFn: (status: FindingStatus) => api.patch(`/findings/${finding.id}/status`, { status }),
    onSuccess: (_res, status) => {
      queryClient.invalidateQueries({ queryKey: ["findings"] });
      notify(`Marked as ${STATUS_LABEL[status]}`);
    },
    onError: () => notify("Couldn't update status", "error"),
  });

  return (
    <Select
      size="small"
      value={finding.status}
      onChange={(e) => updateStatus.mutate(e.target.value as FindingStatus)}
      onClick={(e) => e.stopPropagation()}
      disabled={updateStatus.isPending}
      sx={{ minWidth: 150 }}
    >
      {Object.entries(STATUS_LABEL).map(([value, label]) => (
        <MenuItem key={value} value={value}>
          {label}
        </MenuItem>
      ))}
    </Select>
  );
}

function AssigneeField({ finding }: { finding: Finding }) {
  const [value, setValue] = useState(finding.assignedTo || "");
  const queryClient = useQueryClient();
  const notify = useToast();

  useEffect(() => setValue(finding.assignedTo || ""), [finding.assignedTo]);

  const updateAssignee = useMutation({
    mutationFn: (assignedTo: string) => api.patch(`/findings/${finding.id}/assign`, { assignedTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["findings"] });
      notify("Assignee updated");
    },
    onError: () => notify("Couldn't update assignee", "error"),
  });

  return (
    <TextField
      size="small"
      placeholder="Assign to…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== (finding.assignedTo || "")) updateAssignee.mutate(value);
      }}
      onClick={(e) => e.stopPropagation()}
      sx={{ minWidth: 140 }}
    />
  );
}

const FindingRow = memo(function FindingRow({ finding, scanId }: { finding: Finding; scanId: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const notify = useToast();

  const detail = useQuery({
    queryKey: ["finding", finding.id],
    queryFn: () => api.get<FindingDetail>(`/findings/${finding.id}`).then((r) => r.data),
    enabled: expanded,
  });

  const explain = useMutation({
    mutationFn: () => api.post(`/findings/${finding.id}/explain`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finding", finding.id] }),
    onError: () => notify("AI explanation failed", "error"),
  });

  const recommendation = detail.data?.recommendations?.[0];

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 1.5,
        borderLeft: "4px solid",
        borderLeftColor: SEVERITY_HEX[finding.severity] || "divider",
        opacity: finding.status === "resolved" || finding.status === "wont_fix" ? 0.6 : 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Chip size="small" label={finding.severity} color={SEVERITY_COLOR[finding.severity]} />
        <Box sx={{ flexGrow: 1, minWidth: 200 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>
            {finding.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {finding.componentType} &middot;{" "}
            <Box component="span" sx={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {finding.componentName}
            </Box>
          </Typography>
        </Box>
        <StatusSelect finding={finding} />
        <AssigneeField finding={finding} />
        <OpenInSalesforceButton scanId={scanId} type={finding.componentType} name={finding.componentName} />
        <Button size="small" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "Details"}
        </Button>
      </Box>
      <Collapse in={expanded}>
        <Divider sx={{ my: 2 }} />
        <Box>
          <Typography variant="body2" color="text.secondary">
            {finding.detail}
          </Typography>
          {recommendation ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">AI Explanation</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>{recommendation.explanation}</Typography>
              <Typography variant="subtitle2">Recommendation</Typography>
              <Typography variant="body2">{recommendation.recommendation}</Typography>
            </Box>
          ) : (
            <Button
              sx={{ mt: 1.5 }}
              size="small"
              variant="outlined"
              disabled={explain.isPending}
              onClick={() => explain.mutate()}
            >
              {explain.isPending ? <CircularProgress size={16} /> : "Explain with AI"}
            </Button>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
});

const ALL = "all";
const PAGE_SIZE = 20;

export type FindingsFilter = { category?: string; severity?: string; search?: string };

export function FindingsPage({ scanId, initialFilter }: { scanId: string; initialFilter?: FindingsFilter }) {
  const findings = useQuery({
    queryKey: ["findings", scanId],
    queryFn: () => api.get<Finding[]>(`/findings?scanId=${scanId}`).then((r) => r.data),
  });

  const [category, setCategory] = useState(initialFilter?.category || ALL);
  const [severity, setSeverity] = useState(initialFilter?.severity || ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState(initialFilter?.search || "");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (initialFilter) {
      setCategory(initialFilter.category || ALL);
      setSeverity(initialFilter.severity || ALL);
      setSearch(initialFilter.search || "");
    }
  }, [initialFilter]);

  useEffect(() => {
    setPage(1);
  }, [category, severity, status, search]);

  const categories = useMemo(
    () => Array.from(new Set((findings.data || []).map((f) => f.category))).sort(),
    [findings.data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scoped = (findings.data || []).filter(
      (f) =>
        (category === ALL || f.category === category) &&
        (severity === ALL || f.severity === severity) &&
        (status === ALL || f.status === status) &&
        (!q || f.title.toLowerCase().includes(q) || f.componentName.toLowerCase().includes(q))
    );
    return sortBySeverity(scoped);
  }, [findings.data, category, severity, status, search]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  return (
    <Box sx={{ p: 4 }}>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {filtered.length} of {findings.data?.length ?? 0} issue{findings.data?.length === 1 ? "" : "s"}
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Search findings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 220 }}
        />
        <Select size="small" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value={ALL}>All categories</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c} value={c}>
              {c.replace("_", " ")}
            </MenuItem>
          ))}
        </Select>
        <Select size="small" value={severity} onChange={(e) => setSeverity(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value={ALL}>All severities</MenuItem>
          {["critical", "high", "medium", "low"].map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </Select>
        <Select size="small" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value={ALL}>All Status</MenuItem>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {findings.isLoading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : filtered.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            {findings.data?.length ? "No findings match these filters." : "No findings for this scan."}
          </Typography>
        </Paper>
      ) : (
        <>
          {paged.map((f) => (
            <FindingRow key={f.id} finding={f} scanId={scanId} />
          ))}
          {pageCount > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Pagination count={pageCount} page={page} onChange={(_e, v) => setPage(v)} color="primary" />
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
