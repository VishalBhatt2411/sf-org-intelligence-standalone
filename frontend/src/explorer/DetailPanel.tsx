import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Divider, MenuItem, Select, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import type { GraphApi, ImpactDirection, ImpactResponse } from "./graphApi";
import { CONFIDENCE_LABEL, errorMessage, humanizeKind, kindStyle } from "./nodeStyle";

const mono = { fontFamily: "'JetBrains Mono', Consolas, monospace" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 2.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    return json.length > 160 ? `${json.slice(0, 159)}…` : json;
  } catch {
    return "—";
  }
};

type DetailProps = {
  api: GraphApi;
  connectionId: string;
  nodeKey: string;
  // Impact views are read-only, so the expand controls are hidden there.
  allowExpand: boolean;
  expanded: boolean;
  loading: boolean;
  error?: string;
  hasMore: boolean;
  truncated: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onImpact: (direction: ImpactDirection) => void;
  onLoadMore: () => void;
  onOpenRelated: (nodeKey: string) => void;
  onCopy: (text: string) => void;
};

export function NodeDetailView(p: DetailProps) {
  const detail = useQuery({
    queryKey: ["graph", "detail", p.connectionId, p.nodeKey],
    queryFn: () => p.api.detail(p.nodeKey),
    staleTime: 60_000,
  });
  const [showFields, setShowFields] = useState(false);
  const node = detail.data?.node;
  const apiName = node?.kind === "CustomObject" ? node.fqn : null;
  const fields = useQuery({
    queryKey: ["graph", "fields", p.connectionId, apiName],
    queryFn: () => p.api.fields(apiName!),
    enabled: showFields && Boolean(apiName),
    staleTime: 60_000,
  });

  if (detail.isLoading) {
    return (
      <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={22} />
      </Box>
    );
  }
  if (detail.isError || !detail.data || !node) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {detail.isError ? errorMessage(detail.error) : "This node is no longer in the graph."}
      </Alert>
    );
  }

  const { parent, edgeSummary, edges, edgeTotal, capped } = detail.data;
  const style = kindStyle(node.kind);
  const attributes = Object.entries(node.attributes ?? {});

  return (
    <Box sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Chip size="small" label={node.kindLabel} sx={{ bgcolor: `${style.color}1F`, color: style.color, fontWeight: 500 }} />
        {node.namespace && <Chip size="small" variant="outlined" label={`Package: ${node.namespace}`} />}
      </Stack>
      <Typography variant="h6" sx={{ wordBreak: "break-word", lineHeight: 1.25 }}>
        {node.label}
      </Typography>
      {node.fqn !== node.label && (
        <Typography variant="caption" color="text.secondary" sx={{ ...mono, wordBreak: "break-all" }}>
          {node.fqn}
        </Typography>
      )}
      {parent && (
        <Typography variant="body2" sx={{ mt: 0.75 }} color="text.secondary">
          In{" "}
          <Box component="a" href="#" onClick={(e) => { e.preventDefault(); p.onOpenRelated(parent.nodeKey); }} sx={{ color: "primary.main", textDecoration: "none", fontWeight: 500 }}>
            {parent.label}
          </Box>
        </Typography>
      )}

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
        {p.allowExpand && (
          <Button size="small" variant="contained" disabled={p.loading} onClick={p.onToggle}>
            {p.loading ? <CircularProgress size={16} color="inherit" /> : p.expanded ? "Collapse" : "Expand"}
          </Button>
        )}
        <Button size="small" variant="outlined" onClick={p.onFocus}>
          Focus here
        </Button>
        <Button size="small" variant="outlined" onClick={() => p.onImpact("downstream")}>
          What depends on this
        </Button>
        <Button size="small" variant="outlined" onClick={() => p.onImpact("upstream")}>
          What this depends on
        </Button>
        <Button size="small" onClick={() => p.onCopy(node.fqn)}>
          Copy API name
        </Button>
      </Stack>
      {p.error && (
        <Alert severity="error" sx={{ mt: 1.5 }} action={<Button size="small" color="inherit" onClick={p.onToggle}>Retry</Button>}>
          {p.error}
        </Alert>
      )}
      {p.allowExpand && (p.hasMore || p.truncated) && (
        <Alert severity="info" sx={{ mt: 1.5 }} action={p.hasMore ? <Button size="small" color="inherit" disabled={p.loading} onClick={p.onLoadMore}>Load more</Button> : undefined}>
          {p.hasMore ? "More neighbours are available." : "Only the first neighbours are shown."}
        </Alert>
      )}

      <Section title="Relationships">
        {edgeSummary.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No relationships found in the last scan.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {edgeSummary.map((row) => (
              <Stack key={`${row.typeKey}:${row.direction}`} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2">
                  {row.direction === "out" ? "→" : "←"} {row.role || humanizeKind(row.kind)}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {row.confidence.heuristic > 0 && <Chip size="small" variant="outlined" label={`${row.confidence.heuristic} heuristic`} sx={{ height: 20, fontSize: 11 }} />}
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 24, textAlign: "right" }}>
                    {row.count}
                  </Typography>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Section>

      {edges.length > 0 && (
        <Section title={capped ? `Connections (first ${edges.length} of ${edgeTotal})` : `Connections (${edgeTotal})`}>
          <Stack divider={<Divider flexItem />} sx={{ maxHeight: 280, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            {edges.map((e) => (
              <Box key={e.edgeKey} onClick={() => p.onOpenRelated(e.other.nodeKey)} sx={{ px: 1.25, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                <Typography variant="body2" noWrap>
                  {e.direction === "out" ? "→" : "←"} {e.other.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                  {e.other.kindLabel} · {humanizeKind(e.kind)}
                  {e.viaField ? ` via ${e.viaField}` : ""}
                  {e.confidence !== "exact" ? ` · ${CONFIDENCE_LABEL[e.confidence]}` : ""}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Section>
      )}

      {apiName && (
        <Section title="Fields">
          <Button size="small" onClick={() => setShowFields((v) => !v)}>
            {showFields ? "Hide fields" : "Show fields"}
          </Button>
          <Collapse in={showFields} unmountOnExit>
            {fields.isLoading ? (
              <CircularProgress size={18} sx={{ mt: 1 }} />
            ) : fields.isError ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {errorMessage(fields.error)}
              </Alert>
            ) : (
              <Box sx={{ mt: 1, maxHeight: 260, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
                {(fields.data?.fields ?? []).slice(0, 300).map((f) => (
                  <Box key={f.name} sx={{ px: 1.25, py: 0.6, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Typography variant="body2" noWrap>
                      {f.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", ...mono }}>
                      {f.name} · {f.type}
                      {f.referenceTo.length ? ` → ${f.referenceTo.join(", ")}` : ""}
                      {f.masterDetail ? " (master-detail)" : ""}
                    </Typography>
                  </Box>
                ))}
                {(fields.data?.fields.length ?? 0) > 300 && (
                  <Typography variant="caption" color="text.secondary" sx={{ p: 1.25, display: "block" }}>
                    Showing 300 of {fields.data!.fields.length} fields.
                  </Typography>
                )}
              </Box>
            )}
          </Collapse>
        </Section>
      )}

      {attributes.length > 0 && (
        <Section title="Attributes">
          <Stack spacing={0.5}>
            {attributes.map(([k, v]) => (
              <Stack key={k} direction="row" spacing={1} alignItems="baseline">
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 96, flexShrink: 0 }}>
                  {k}
                </Typography>
                <Typography variant="caption" sx={{ ...mono, wordBreak: "break-word" }}>
                  {stringify(v)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      )}
    </Box>
  );
}

const CAVEAT_SEVERITY: Record<string, "warning" | "info"> = {
  "no-scan": "warning",
  "coverage-degraded": "warning",
  "coverage-partial": "warning",
  scope: "info",
  heuristic: "info",
  truncated: "info",
};

type ImpactProps = {
  loading: boolean;
  error?: string;
  data?: ImpactResponse;
  direction: ImpactDirection;
  depth: number;
  rootLabel: string;
  onDirection: (d: ImpactDirection) => void;
  onDepth: (d: number) => void;
  onBack: () => void;
};

export function ImpactHeader(p: ImpactProps) {
  const data = p.data;
  return (
    <Box sx={{ p: 2.5, borderBottom: "1px solid", borderColor: "divider" }}>
      <Button size="small" startIcon={<ArrowBackRoundedIcon />} onClick={p.onBack} sx={{ mb: 1, ml: -1 }}>
        Back to graph
      </Button>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Impact analysis
      </Typography>
      <Typography variant="h6" sx={{ wordBreak: "break-word", lineHeight: 1.25 }}>
        {p.rootLabel}
      </Typography>
      <ToggleButtonGroup exclusive size="small" value={p.direction} onChange={(_, v) => v && p.onDirection(v)} sx={{ mt: 1.5, display: "flex" }}>
        <ToggleButton value="downstream" sx={{ flex: 1, textTransform: "none" }}>
          What depends on this
        </ToggleButton>
        <ToggleButton value="upstream" sx={{ flex: 1, textTransform: "none" }}>
          What this depends on
        </ToggleButton>
      </ToggleButtonGroup>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Depth
        </Typography>
        <Select size="small" value={p.depth} onChange={(e) => p.onDepth(Number(e.target.value))} sx={{ minWidth: 72 }}>
          {[1, 2, 3].map((d) => (
            <MenuItem key={d} value={d}>
              {d} {d === 1 ? "hop" : "hops"}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {p.loading && <CircularProgress size={20} sx={{ mt: 2 }} />}
      {p.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {p.error}
        </Alert>
      )}
      {data && (
        <>
          <Typography variant="body2" sx={{ mt: 2 }}>
            {data.nodes.length === 0 ? "Nothing found within this range." : `${data.nodes.length} ${data.nodes.length === 1 ? "component" : "components"} within ${data.depth} ${data.depth === 1 ? "hop" : "hops"}.`}
          </Typography>
          {data.summary.length > 0 && (
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              {data.summary.map((s) => (
                <Chip key={s.typeKey} size="small" label={`${s.count} ${s.kindLabel}`} variant="outlined" />
              ))}
            </Stack>
          )}
          {data.hasCycle && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              A circular dependency exists in this range. Affected components are outlined in red.
            </Alert>
          )}
          {data.truncated && (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              The result was capped. Reduce the depth or focus on a narrower component to see everything.
            </Alert>
          )}
          {data.caveats
            .filter((c) => c.code !== "truncated")
            .map((c) => (
              <Alert key={c.code} severity={CAVEAT_SEVERITY[c.code] ?? "info"} sx={{ mt: 1.5 }}>
                {c.message}
              </Alert>
            ))}
        </>
      )}
    </Box>
  );
}
