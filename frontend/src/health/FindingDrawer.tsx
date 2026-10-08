import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Divider, Drawer, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../explorer/nodeStyle";
import { useToast } from "../toast";
import { FINDING_STATUSES, type FindingDetail, type HealthApi } from "./healthApi";
import { STATUS_LABEL, TEXT_LIMITS, formFromFinding, formatDate, hasChanges, relativeTime, scoreText, triagePatch, type TriageForm } from "./healthFormat";
import { SeverityBadge } from "./healthParts";

type Props = {
  api: HealthApi;
  findingId: string | null;
  onClose: () => void;
  onOpenFinding: (id: string) => void;
  onOpenInExplorer: (nodeKey: string) => void;
};

const Section = ({ label, children }: { label: string; children: React.ReactNode }) =>
  children ? (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {children}
      </Typography>
    </Box>
  ) : null;

export function FindingDrawer({ api, findingId, onClose, onOpenFinding, onOpenInExplorer }: Props) {
  const detail = useQuery({ queryKey: ["health-finding", findingId], queryFn: () => api.finding(findingId!), enabled: Boolean(findingId) });
  return (
    <Drawer anchor="right" open={Boolean(findingId)} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 520 }, p: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Finding</Typography>
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Stack>
      {detail.isLoading && <CircularProgress size={24} />}
      {detail.isError && <Alert severity="error">{errorMessage(detail.error)}</Alert>}
      {detail.data && <DrawerBody key={detail.data.id} api={api} finding={detail.data} onOpenFinding={onOpenFinding} onOpenInExplorer={onOpenInExplorer} />}
    </Drawer>
  );
}

function DrawerBody({ api, finding, onOpenFinding, onOpenInExplorer }: { api: HealthApi; finding: FindingDetail; onOpenFinding: (id: string) => void; onOpenInExplorer: (nodeKey: string) => void }) {
  const notify = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<TriageForm>(() => formFromFinding(finding));
  useEffect(() => setForm(formFromFinding(finding)), [finding]);

  const check = triagePatch(finding, form);
  const related = useQuery({ queryKey: ["health-related", finding.id], queryFn: () => api.related(finding.id) });
  const history = useQuery({ queryKey: ["health-history", finding.id], queryFn: () => api.history(finding.id) });

  const save = useMutation({
    mutationFn: () => api.triage(finding.id, check.patch),
    onSuccess: (saved) => {
      client.setQueryData(["health-finding", finding.id], saved);
      client.invalidateQueries({ queryKey: ["health-history", finding.id] });
      client.invalidateQueries({ queryKey: ["health-list"] });
      client.invalidateQueries({ queryKey: ["health-summary"] });
      notify("Finding updated");
    },
    onError: (e) => notify(errorMessage(e), "error"),
  });

  const open = useMutation({
    mutationFn: () => api.navigate(finding.id),
    onSuccess: (target) => onOpenInExplorer(target.nodeKey),
    onError: (e) => notify(errorMessage(e), "error"),
  });

  const set = <K extends keyof TriageForm>(key: K, value: TriageForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canSave = hasChanges(check.patch) && !check.error && !save.isPending;

  return (
    <Stack gap={2}>
      <Box>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <SeverityBadge severity={finding.severity} />
          <Chip size="small" label={STATUS_LABEL[finding.status]} />
          <Chip size="small" variant="outlined" label={`Score ${scoreText(finding.score)}`} />
          <Chip size="small" variant="outlined" label={`${finding.confidence} confidence`} />
        </Stack>
        <Typography variant="h6" sx={{ mt: 1 }}>
          {finding.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {finding.componentType} · {finding.componentLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          First seen {formatDate(finding.firstDetectedAt)} · last seen {relativeTime(finding.lastDetectedAt)}
          {finding.resolvedAt ? ` · resolved ${formatDate(finding.resolvedAt)}` : ""}
        </Typography>
        <Button size="small" sx={{ mt: 1 }} onClick={() => open.mutate()} disabled={open.isPending}>
          Open in Graph Explorer
        </Button>
      </Box>

      <Section label="Measured vs expected">{`${finding.measured} (expected ${finding.expected})`}</Section>
      <Section label="Evidence">{finding.evidence}</Section>
      <Section label="Why it matters">{finding.explanation}</Section>
      <Section label="Risk">{finding.risk}</Section>
      <Section label="Impact">{finding.impact}</Section>
      <Section label="How to fix it">{finding.remediation}</Section>
      <Section label="How to check the fix">{finding.validation}</Section>

      {finding.contributors.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            What makes up the score
          </Typography>
          {finding.contributors.map((c) => (
            <Tooltip key={c.key} title={c.note} placement="left">
              <Stack direction="row" justifyContent="space-between" sx={{ py: 0.25, opacity: c.wasCorrelatedOut ? 0.5 : 1 }}>
                <Typography variant="body2">
                  {c.label}
                  {c.wasCorrelatedOut ? " (counted elsewhere)" : ""}
                  {c.hasCompensatingControl ? " (compensating control)" : ""}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {scoreText(Math.round(c.contribution * 10) / 10)}
                </Typography>
              </Stack>
            </Tooltip>
          ))}
        </Box>
      )}

      <Divider />
      <Typography variant="subtitle1" fontWeight={600}>
        Triage
      </Typography>
      <Stack gap={1.5}>
        <TextField select size="small" label="Status" value={form.status} onChange={(e) => set("status", e.target.value as TriageForm["status"])}>
          {FINDING_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" label="Owner" value={form.owner} onChange={(e) => set("owner", e.target.value)} inputProps={{ maxLength: TEXT_LIMITS.owner }} />
        <TextField size="small" type="date" label="Due date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} InputLabelProps={{ shrink: true }} />
        {form.status === "risk_accepted" && (
          <>
            <TextField size="small" type="date" label="Risk acceptance expires" value={form.riskAcceptanceExpiry} onChange={(e) => set("riskAcceptanceExpiry", e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" multiline minRows={2} label="Compensating control" value={form.compensatingControl} onChange={(e) => set("compensatingControl", e.target.value)} inputProps={{ maxLength: TEXT_LIMITS.compensatingControl }} />
          </>
        )}
        {form.status === "false_positive" && (
          <TextField size="small" multiline minRows={2} required label="Why is this a false positive?" value={form.falsePositiveReason} onChange={(e) => set("falsePositiveReason", e.target.value)} inputProps={{ maxLength: TEXT_LIMITS.falsePositiveReason }} />
        )}
        <TextField size="small" multiline minRows={2} label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} inputProps={{ maxLength: TEXT_LIMITS.notes }} />
        {check.error && <Alert severity="warning">{check.error}</Alert>}
        <Box>
          <Button variant="contained" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </Box>
      </Stack>

      {(related.data?.length ?? 0) > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Related findings
          </Typography>
          {related.data!.map((r) => (
            <Box key={r.id} onClick={() => onOpenFinding(r.id)} sx={{ py: 0.5, cursor: "pointer", "&:hover": { color: "primary.main" } }}>
              <Typography variant="body2">
                {r.title} · {r.componentLabel}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {(history.data?.length ?? 0) > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            History
          </Typography>
          {history.data!.map((e) => (
            <Typography key={e.id} variant="caption" display="block" color="text.secondary">
              {formatDate(e.changedAt)} · {e.field}: {e.oldValue ?? "—"} → {e.newValue ?? "—"}
            </Typography>
          ))}
        </Box>
      )}
    </Stack>
  );
}
