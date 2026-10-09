import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, IconButton, InputAdornment, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery } from "@mui/material";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import ChevronRight from "@mui/icons-material/ChevronRight";
import CodeOutlined from "@mui/icons-material/CodeOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import KeyboardDoubleArrowLeft from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRight from "@mui/icons-material/KeyboardDoubleArrowRight";
import ListAltOutlined from "@mui/icons-material/ListAltOutlined";
import LockOutlined from "@mui/icons-material/LockOutlined";
import PushPin from "@mui/icons-material/PushPin";
import PushPinOutlined from "@mui/icons-material/PushPinOutlined";
import SearchRounded from "@mui/icons-material/SearchRounded";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import type { GraphApi, GraphNode, ImpactDirection, IntelligenceCategory, IntelligenceItem, IntelligenceStatus, NodeDetail } from "./graphApi";
import {
  buildEmptyStateMessage,
  directionLabel,
  distinctTargets,
  fieldMetrics,
  filterFields,
  formatTargets,
  groupIntelligenceItems,
  incomingDrillEntries,
  outgoingRelationshipFields,
  overviewRows,
  pluralizeTypeLabel,
  relationshipCounts,
  relationshipKindLabel,
  targetWithCount,
  technicalAttributes,
  yesNoUnknown,
  type DrillEntry,
  type FieldFilter,
} from "./intelligenceModel";
import { errorMessage } from "./nodeStyle";
import type { ObjectRelationshipView } from "./objectRelationshipView";

// The Intelligence Panel (port of native oiNodeDetailPanel) for Object analyze mode: everything the graph and
// the live org can say about the selected component, in collapsible sections. The server groups and explains
// (intelligence service); this file only lays it out. Restyled with the Tech Debt MUI theme.

const mono = { fontFamily: "'JetBrains Mono', Consolas, monospace" } as const;
const IMPACT_DEPTH = 2;

type SectionId = "overview" | "fieldRelationship" | "fields" | "relationships" | "sharing" | "automation" | "code" | "security" | "impact" | "technical";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  overview: true,
  fieldRelationship: true,
  fields: false,
  relationships: true,
  sharing: false,
  automation: false,
  code: false,
  security: false,
  impact: false,
  technical: false,
};

// Fixed per-section hues, so a section is recognisable at a glance (same idea as the native icon tints).
const TINT: Record<SectionId, string> = {
  overview: "#2B50DD",
  fieldRelationship: "#5E35B1",
  fields: "#0B827C",
  relationships: "#5E35B1",
  sharing: "#A61B7B",
  automation: "#B45309",
  code: "#0E7490",
  security: "#B91C1C",
  impact: "#7C3AED",
  technical: "#5E6878",
};

const STATUS_STYLE: Record<IntelligenceStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "#14854F" },
  inactive: { label: "Inactive", color: "#5E6878" },
  draft: { label: "Draft", color: "#5E6878" },
  obsolete: { label: "Obsolete", color: "#B91C1C" },
};

function Badge({ label, color }: { label: string; color: string }) {
  return <Chip size="small" label={label} sx={{ height: 20, fontSize: 11, fontWeight: 600, bgcolor: `${color}1F`, color }} />;
}

function CountPill({ value }: { value: ReactNode }) {
  return (
    <Box component="span" sx={{ px: 0.9, minWidth: 22, textAlign: "center", borderRadius: 999, bgcolor: "action.hover", color: "text.secondary", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </Box>
  );
}

type SectionProps = { id: SectionId; title: string; icon: ReactNode; open: boolean; onToggle: (id: SectionId) => void; count?: ReactNode; children: ReactNode };

function Section({ id, title, icon, open, onToggle, count, children }: SectionProps) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", borderLeft: `3px solid ${TINT[id]}` }}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        sx={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } }}
      >
        <Box sx={{ display: "flex", color: TINT[id], "& svg": { fontSize: 18 } }}>{icon}</Box>
        <Typography sx={{ flex: 1, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.primary" }}>{title}</Typography>
        {count !== undefined && <CountPill value={count} />}
        <ChevronRight sx={{ fontSize: 18, color: "text.secondary", transition: reduceMotion ? "none" : "transform .15s", transform: open ? "rotate(90deg)" : "none" }} />
      </Box>
      <Collapse in={open} timeout={reduceMotion ? 0 : "auto"} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

const outlineButton = { textTransform: "none", fontWeight: 600, fontSize: 12.5 } as const;

function KeyValueGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{k}</Typography>
          <Typography sx={{ fontSize: 13, wordBreak: "break-word", ...(k === "API Name" ? mono : {}) }}>{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}

type Row = { nodeKey: string; label: string; sub: string | null; status?: IntelligenceStatus | null };
type Drill = { title: string; rows: Row[] };

const itemRow = (i: IntelligenceItem): Row => ({ nodeKey: i.nodeKey, label: i.label, sub: `${i.kindLabel} · ${directionLabel(i.direction)}`, status: i.status });
const entryRow = (e: DrillEntry): Row => ({ nodeKey: e.nodeKey, label: e.label, sub: e.detail });

function RowList({ rows, onOpen }: { rows: Row[]; onOpen: (nodeKey: string) => void }) {
  return (
    <Stack divider={<Box sx={{ borderTop: "1px solid", borderColor: "divider" }} />} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
      {rows.map((r, i) => (
        <Box key={`${r.nodeKey}:${i}`} role="button" tabIndex={0} onClick={() => onOpen(r.nodeKey)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(r.nodeKey))} sx={{ px: 1.25, py: 0.75, cursor: "pointer", display: "flex", alignItems: "center", gap: 1, "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>{r.label}</Typography>
            {r.sub && <Typography noWrap sx={{ fontSize: 11, color: "text.secondary" }}>{r.sub}</Typography>}
          </Box>
          {r.status && <Badge label={STATUS_STYLE[r.status].label} color={STATUS_STYLE[r.status].color} />}
        </Box>
      ))}
    </Stack>
  );
}

const TableHead = ({ cols }: { cols: string[] }) => (
  <Box component="thead">
    <Box component="tr">
      {cols.map((c) => (
        <Box key={c} component="th" sx={{ textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "text.secondary", pb: 0.5, pr: 1, whiteSpace: "nowrap" }}>
          {c}
        </Box>
      ))}
    </Box>
  </Box>
);

const cell = { fontSize: 12, py: 0.5, pr: 1, verticalAlign: "top", borderTop: "1px solid", borderColor: "divider" } as const;

type Props = {
  api: GraphApi;
  connectionId: string;
  nodeKey: string | null;
  // The canvas working set around the anchored object, for the curated relationship counts and field links.
  view: ObjectRelationshipView | null;
  workingNodes: readonly GraphNode[];
  highlighted: boolean;
  onSelectNode: (nodeKey: string) => void;
  // Absent where the canvas cannot emphasise nodes (the radial Field canvas), which hides the button.
  onHighlight?: (nodeKeys: string[] | null) => void;
};

export function IntelligencePanel(p: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState<Record<SectionId, boolean>>(DEFAULT_OPEN);

  // Pinning keeps the section layout the user arranged; unpinned, every new node starts from the defaults.
  useEffect(() => {
    if (!pinned) setOpen(DEFAULT_OPEN);
  }, [p.nodeKey, pinned]);

  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <Box
      component="aside"
      aria-label="Intelligence Panel"
      sx={{
        flex: { md: collapsed ? "0 0 44px" : 1 },
        minWidth: { md: collapsed ? 44 : 320 },
        maxWidth: { md: collapsed ? 44 : 420 },
        maxHeight: { xs: collapsed ? "none" : "45%", md: "none" },
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderLeft: { md: "1px solid" },
        borderTop: { xs: "1px solid", md: "none" },
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack direction={collapsed ? { xs: "row", md: "column" } : "row"} alignItems="center" spacing={0.5} sx={{ px: collapsed ? 0.5 : 1.5, py: 0.75, borderBottom: collapsed ? undefined : "1px solid", borderColor: "divider" }}>
        {!collapsed && <Typography sx={{ flex: 1, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Intelligence Panel</Typography>}
        {!collapsed && (
          <Tooltip title={pinned ? "Unpin sections" : "Keep this section layout when the selection changes"}>
            <IconButton size="small" aria-label={pinned ? "Unpin sections" : "Pin sections"} aria-pressed={pinned} onClick={() => setPinned((v) => !v)} color={pinned ? "primary" : "default"}>
              {pinned ? <PushPin fontSize="small" /> : <PushPinOutlined fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={collapsed ? "Expand panel" : "Collapse panel"}>
          <IconButton size="small" aria-label={collapsed ? "Expand panel" : "Collapse panel"} aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? <KeyboardDoubleArrowLeft fontSize="small" /> : <KeyboardDoubleArrowRight fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
      {!collapsed && (
        <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {p.nodeKey ? <PanelBody key={p.nodeKey} {...p} nodeKey={p.nodeKey} open={open} onToggle={toggle} /> : <Typography sx={{ p: 2, fontSize: 13, color: "text.secondary" }}>Select a node to see its details.</Typography>}
        </Box>
      )}
    </Box>
  );
}

type BodyProps = Props & { nodeKey: string; open: Record<SectionId, boolean>; onToggle: (id: SectionId) => void };

function PanelBody({ api, connectionId, nodeKey, view, workingNodes, highlighted, onSelectNode, onHighlight, open, onToggle }: BodyProps) {
  const detail = useQuery({ queryKey: ["graph", "detail", connectionId, nodeKey], queryFn: () => api.detail(nodeKey), staleTime: 60_000 });
  const node = detail.data?.node;
  const isObject = node?.kind === "CustomObject";
  const isField = node?.kind === "CustomField";
  const intelligence = useQuery({ queryKey: ["graph", "intelligence", connectionId, nodeKey], queryFn: () => api.intelligence(nodeKey), enabled: Boolean(node), staleTime: 60_000 });

  const [showFields, setShowFields] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [showTech, setShowTech] = useState(false);
  const [wantCounts, setWantCounts] = useState(false);
  const [impactDir, setImpactDir] = useState<ImpactDirection | null>(null);

  const fields = useQuery({
    queryKey: ["graph", "fields", connectionId, node?.fqn],
    queryFn: () => api.fields(node!.fqn),
    enabled: Boolean(isObject) && (showFields || open.fields || open.relationships),
    staleTime: 60_000,
  });
  const sharing = useQuery({ queryKey: ["graph", "sharing", connectionId, node?.fqn], queryFn: () => api.sharing(node!.fqn), enabled: Boolean(isObject) && open.sharing, staleTime: 60_000, retry: false });
  const outgoing = useMemo(() => outgoingRelationshipFields(fields.data?.fields ?? []), [fields.data]);
  const targets = useMemo(() => distinctTargets(outgoing), [outgoing]);
  const counts = useQuery({ queryKey: ["graph", "recordCounts", connectionId, targets.join(",")], queryFn: () => api.recordCounts(targets), enabled: wantCounts && targets.length > 0, staleTime: 60_000, retry: false });
  const impact = useQuery({ queryKey: ["graph", "impact", connectionId, nodeKey, impactDir], queryFn: () => api.impact(nodeKey, impactDir!, IMPACT_DEPTH), enabled: impactDir !== null, staleTime: 60_000, retry: false });

  if (detail.isLoading) {
    return (
      <Stack spacing={1} sx={{ p: 2 }} aria-busy>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={120} />
      </Stack>
    );
  }
  if (detail.isError || !node || !detail.data) {
    return (
      <Alert severity="error" sx={{ m: 1.5 }} action={detail.isError ? <Button size="small" color="inherit" onClick={() => void detail.refetch()}>Retry</Button> : undefined}>
        <strong>Couldn't load this component.</strong> {detail.isError ? errorMessage(detail.error) : "No detail available."}
      </Alert>
    );
  }

  const data: NodeDetail = detail.data;
  const counted = counts.data?.counts;
  const relCounts = isObject ? relationshipCounts(view) : null;
  const fieldNodeByFqn = new Map(workingNodes.filter((n) => n.kind === "CustomField").map((n) => [n.fqn, n]));
  const category = (key: string): IntelligenceCategory | undefined => intelligence.data?.categories.find((c) => c.category === key);
  const technical = technicalAttributes(node);

  if (drill) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Button size="small" onClick={() => setDrill(null)} sx={{ ml: -0.5, mb: 1, ...outlineButton }}>← Back</Button>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>{drill.title}</Typography>
        <RowList rows={drill.rows} onOpen={(key) => { setDrill(null); onSelectNode(key); }} />
      </Box>
    );
  }

  const openGroup = (g: ReturnType<typeof groupIntelligenceItems>[number], label: string) => setDrill({ title: `${pluralizeTypeLabel(g.label)} · ${label}`, rows: g.items.map(itemRow) });

  const intelligenceSection = (id: "automation" | "code" | "security", icon: ReactNode) => {
    const cat = category(id);
    const title = id === "automation" ? "Automation" : id === "code" ? "Code" : "Security";
    const groups = cat ? groupIntelligenceItems(cat.items) : [];
    return (
      <Section key={id} id={id} title={title} icon={icon} open={open[id]} onToggle={onToggle} count={cat ? cat.total : "—"}>
        {intelligence.isLoading ? (
          <Skeleton variant="rounded" height={48} />
        ) : intelligence.isError || !cat ? (
          <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void intelligence.refetch()}>Retry</Button>}>
            {errorMessage(intelligence.error)}
          </Alert>
        ) : (
          <>
            {cat.items.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>{buildEmptyStateMessage(cat.label, cat.emptyState)}</Typography>
            ) : (
              <Stack spacing={1}>
                {groups.map((g) => (
                  <Box key={g.typeKey}>
                    <Box
                      component="button"
                      type="button"
                      onClick={() => (g.drillDown ? openGroup(g, directionLabel(g.items[0].direction)) : undefined)}
                      sx={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 1, py: 0.25, cursor: g.drillDown ? "pointer" : "default", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}
                    >
                      <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{g.label}</Typography>
                      <CountPill value={g.items.length} />
                      {g.drillDown && <ChevronRight sx={{ fontSize: 16, color: "text.secondary" }} />}
                    </Box>
                    {!g.drillDown && <RowList rows={g.items.map(itemRow)} onOpen={onSelectNode} />}
                  </Box>
                ))}
              </Stack>
            )}
            {cat.truncated && <Typography sx={{ mt: 1, fontSize: 11.5, color: "text.secondary" }}>Showing the first results only — more exist than are listed here.</Typography>}
            {cat.coverageNote && (
              <Box component="details" sx={{ mt: 1, fontSize: 11.5, color: "text.secondary" }}>
                <summary style={{ cursor: "pointer" }}>Coverage details</summary>
                <Typography sx={{ fontSize: 11.5, mt: 0.5 }}>{cat.coverageNote}</Typography>
              </Box>
            )}
          </>
        )}
      </Section>
    );
  };

  const filteredHint = (n: number) => (n === 0 ? "No matches" : null);

  return (
    <Box>
      <Section id="overview" title="Overview" icon={<InfoOutlined />} open={open.overview} onToggle={onToggle}>
        <KeyValueGrid rows={overviewRows(node, data.parent?.label ?? null)} />
      </Section>

      {isField && <FieldRelationshipSection node={node} data={data} open={open.fieldRelationship} onToggle={onToggle} />}

      {isObject && (
        <Section id="fields" title="Fields" icon={<ListAltOutlined />} open={open.fields} onToggle={onToggle} count={fields.data ? fields.data.fields.length : "—"}>
          <FieldsBody fields={fields} apiName={node.fqn} show={showFields} onShow={setShowFields} fieldNodeByFqn={fieldNodeByFqn} onSelectNode={onSelectNode} hint={filteredHint} />
        </Section>
      )}

      <Section id="relationships" title="Relationships" icon={<HubOutlined />} open={open.relationships} onToggle={onToggle}>
        {isObject ? (
          <Stack spacing={1.25}>
            {relCounts && (
              <Stack spacing={0.5}>
                <CountRow label="Incoming Lookups" value={relCounts.incomingLookups} onClick={relCounts.incomingLookups > 0 ? () => setDrill({ title: "Incoming Lookups", rows: incomingDrillEntries(view, "Lookup").map(entryRow) }) : undefined} />
                <CountRow label="Incoming Master-Detail" value={relCounts.incomingMasterDetail} onClick={relCounts.incomingMasterDetail > 0 ? () => setDrill({ title: "Incoming Master-Detail", rows: incomingDrillEntries(view, "MasterDetail").map(entryRow) }) : undefined} />
                <CountRow label="Self Relationships" value={relCounts.selfRelationships} />
                <CountRow label="Referenced Objects" value={relCounts.referencedObjects} />
                <CountRow label="Referencing Objects" value={relCounts.referencingObjects} />
              </Stack>
            )}
            {fields.isLoading ? (
              <Skeleton variant="rounded" height={48} />
            ) : fields.isError ? (
              <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void fields.refetch()}>Retry</Button>}>
                {errorMessage(fields.error)}
              </Alert>
            ) : outgoing.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>No outgoing relationships</Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary" }}>Outgoing relationship fields</Typography>
                <Box sx={{ overflowX: "auto" }}>
                  <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                    <TableHead cols={["Field", "Type", "Required", "Cascade Delete", "Target Object(s)"]} />
                    <Box component="tbody">
                      {outgoing.map((f) => {
                        const t = formatTargets(f.referenceTo, (n) => targetWithCount(n, counted));
                        return (
                          <Box component="tr" key={f.name}>
                            <Box component="td" sx={cell}>{f.label}</Box>
                            <Box component="td" sx={cell}>{relationshipKindLabel(f)}</Box>
                            <Box component="td" sx={cell}>{yesNoUnknown(f.required)}</Box>
                            <Box component="td" sx={cell}>{f.cascadeDelete === null ? "Not available" : yesNoUnknown(f.cascadeDelete)}</Box>
                            <Box component="td" sx={cell} title={t.title}>{t.text}</Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                </Box>
                {targets.length > 0 && !counts.data && (
                  <Button size="small" variant="outlined" disabled={counts.isFetching} onClick={() => (wantCounts ? void counts.refetch() : setWantCounts(true))} sx={{ alignSelf: "flex-start", ...outlineButton }}>
                    {counts.isFetching ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}Load record counts
                  </Button>
                )}
                {counts.isError && <Alert severity="error">{errorMessage(counts.error)}</Alert>}
                {counts.data?.truncated && <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>Counts were loaded for the first {Object.keys(counts.data.counts).length} objects only.</Typography>}
              </>
            )}
          </Stack>
        ) : (
          <Stack spacing={0.5}>
            {data.edgeSummary.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>No relationships found in the last scan.</Typography>
            ) : (
              data.edgeSummary.map((row) => (
                <CountRow
                  key={`${row.typeKey}:${row.direction}`}
                  label={`${row.direction === "out" ? "→" : "←"} ${row.role || row.kind.replace(/_/g, " ").toLowerCase()}`}
                  value={row.count}
                  onClick={() =>
                    setDrill({
                      title: row.role || row.kind,
                      rows: data.edges.filter((e) => e.typeKey === row.typeKey && e.direction === row.direction).map((e) => ({ nodeKey: e.other.nodeKey, label: e.other.label, sub: e.other.kindLabel })),
                    })
                  }
                />
              ))
            )}
            {data.edgeTotal > 0 && <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.5 }}>{data.edgeTotal} direct {data.edgeTotal === 1 ? "connection" : "connections"}{data.capped ? " (list capped)" : ""}.</Typography>}
          </Stack>
        )}
      </Section>

      {isObject && (
        <Section id="sharing" title="Sharing Settings" icon={<LockOutlined />} open={open.sharing} onToggle={onToggle}>
          {sharing.isLoading ? (
            <Skeleton variant="rounded" height={40} />
          ) : sharing.isError ? (
            <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void sharing.refetch()}>Retry</Button>}>
              {errorMessage(sharing.error)}
            </Alert>
          ) : sharing.data && !sharing.data.supported ? (
            <Alert severity="info">
              <strong>Sharing settings unavailable.</strong> {sharing.data.unavailableReason ?? ""}
            </Alert>
          ) : (
            <KeyValueGrid rows={[["Internal Sharing Model", sharing.data?.internalSharingModel || "—"], ["External Sharing Model", sharing.data?.externalSharingModel || "Not enabled"]]} />
          )}
        </Section>
      )}

      {intelligenceSection("automation", <BoltOutlined />)}
      {intelligenceSection("code", <CodeOutlined />)}
      {intelligenceSection("security", <ShieldOutlined />)}

      <Section id="impact" title="Impact" icon={<AccountTreeOutlined />} open={open.impact} onToggle={onToggle}>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button size="small" variant={impactDir === "upstream" ? "contained" : "outlined"} onClick={() => setImpactDir("upstream")} sx={outlineButton}>What does this depend on?</Button>
          <Button size="small" variant={impactDir === "downstream" ? "contained" : "outlined"} onClick={() => setImpactDir("downstream")} sx={outlineButton}>What depends on this?</Button>
        </Stack>
        {impactDir && impact.isLoading && <CircularProgress size={18} sx={{ mt: 1.5 }} />}
        {impact.isError && (
          <Alert severity="error" sx={{ mt: 1.5 }} action={<Button size="small" color="inherit" onClick={() => void impact.refetch()}>Retry</Button>}>
            {errorMessage(impact.error)}
          </Alert>
        )}
        {impact.data && (
          <Box sx={{ mt: 1.5 }}>
            {impact.data.caveats.filter((c) => c.code !== "truncated").map((c) => (
              <Alert key={c.code} severity={c.code === "scope" || c.code === "heuristic" ? "info" : "warning"} sx={{ mb: 1, fontSize: 12 }}>{c.message}</Alert>
            ))}
            {impact.data.nodes.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>No dependencies found in the currently-scanned data.</Typography>
            ) : (
              <>
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                  {impact.data.summary.map((s) => (
                    <Chip key={s.typeKey} size="small" variant="outlined" label={`${s.count} ${s.count === 1 ? s.kindLabel : pluralizeTypeLabel(s.kindLabel)}`} />
                  ))}
                </Stack>
                {impact.data.truncated && <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>The result was capped; focus on a narrower component to see everything.</Typography>}
                <Box sx={{ maxHeight: 260, overflow: "auto" }}>
                  <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                    <TableHead cols={["Affected", "Type", "Hops", ""]} />
                    <Box component="tbody">
                      {impact.data.nodes.map((n) => (
                        <Box component="tr" key={n.nodeKey} onClick={() => onSelectNode(n.nodeKey)} sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                          <Box component="td" sx={cell}>{n.label}</Box>
                          <Box component="td" sx={cell}>{n.kindLabel}</Box>
                          <Box component="td" sx={cell}>{n.distance}</Box>
                          <Box component="td" sx={cell}>{impact.data.cycleNodeKeys.includes(n.nodeKey) ? <Badge label="Cycle" color="#B91C1C" /> : null}</Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
                {onHighlight && (
                  <Button size="small" variant="outlined" onClick={() => onHighlight(highlighted ? null : [nodeKey, ...impact.data!.nodes.map((n) => n.nodeKey)])} sx={{ mt: 1, ...outlineButton }}>
                    {highlighted ? "Clear highlight" : "Highlight on Graph"}
                  </Button>
                )}
              </>
            )}
          </Box>
        )}
      </Section>

      <Section id="technical" title="Technical Details" icon={<TuneOutlined />} open={open.technical} onToggle={onToggle}>
        <Button size="small" onClick={() => setShowTech((v) => !v)} sx={{ ml: -0.5, ...outlineButton }}>{showTech ? "Hide technical details" : "Show technical details"}</Button>
        {showTech &&
          (technical.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5 }}>No additional attributes.</Typography>
          ) : (
            <Box component="table" sx={{ borderCollapse: "collapse", width: "100%", mt: 0.5 }}>
              <Box component="tbody">
                {technical.map(([k, v]) => (
                  <Box component="tr" key={k}>
                    <Box component="td" sx={{ ...cell, color: "text.secondary", width: "40%" }}>{k}</Box>
                    <Box component="td" sx={{ ...cell, ...mono, wordBreak: "break-word" }}>{typeof v === "string" ? v : JSON.stringify(v)}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
      </Section>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", px: 1.5, py: 1.25 }}>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
          {intelligence.data?.lastScannedAt ? `Metadata intelligence last scanned ${new Date(intelligence.data.lastScannedAt).toLocaleString()}` : intelligence.data ? "Never scanned — run a scan to build metadata intelligence." : " "}
          {intelligence.data?.hasCoverageLimitations && <Box component="span" sx={{ color: "warning.main" }}> · Some dependency types were not fully scanned</Box>}
        </Typography>
      </Box>
    </Box>
  );
}

function CountRow({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const content = (
    <>
      <Typography sx={{ flex: 1, fontSize: 13 }}>{label}</Typography>
      <CountPill value={value} />
      {onClick && <ChevronRight sx={{ fontSize: 16, color: "text.secondary" }} />}
    </>
  );
  return onClick ? (
    <Box component="button" type="button" onClick={onClick} sx={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 1, py: 0.25, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}>
      {content}
    </Box>
  ) : (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>{content}</Box>
  );
}

function FieldRelationshipSection({ node, data, open, onToggle }: { node: GraphNode; data: NodeDetail; open: boolean; onToggle: (id: SectionId) => void }) {
  const link = data.edges.find((e) => e.direction === "out" && (e.typeKey.endsWith("LOOKUP_TO") || e.typeKey.endsWith("MASTER_DETAIL_TO")));
  const relName = typeof node.attributes?.relationshipName === "string" && node.attributes.relationshipName ? node.attributes.relationshipName : "—";
  return (
    <Section id="fieldRelationship" title="Field Relationship" icon={<HubOutlined />} open={open} onToggle={onToggle}>
      <KeyValueGrid rows={[["Relationship Type", link ? (link.typeKey.endsWith("MASTER_DETAIL_TO") ? "Master-Detail" : "Lookup") : "—"], ["Target Object", link?.other.label ?? "—"], ["Relationship Name", relName]]} />
    </Section>
  );
}

type FieldsQuery = ReturnType<typeof useQuery<import("./graphApi").ObjectFields>>;

function FieldsBody({ fields, apiName, show, onShow, fieldNodeByFqn, onSelectNode, hint }: { fields: FieldsQuery; apiName: string; show: boolean; onShow: (v: boolean) => void; fieldNodeByFqn: Map<string, GraphNode>; onSelectNode: (key: string) => void; hint: (n: number) => string | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("all");
  const all = fields.data?.fields;
  const metrics = all ? fieldMetrics(all) : null;
  const tiles: Array<[string, number | undefined]> = [["Total", metrics?.total], ["Standard", metrics?.standard], ["Custom", metrics?.custom], ["Relationship", metrics?.relationship]];
  const shown = all ? filterFields(all, query, filter) : [];
  return (
    <Stack spacing={1.25}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0.75 }}>
        {tiles.map(([label, value]) => (
          <Box key={label} sx={{ bgcolor: "action.hover", borderRadius: 1.5, px: 0.75, py: 0.75, textAlign: "center" }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</Typography>
            <Typography sx={{ fontSize: 10, color: "text.secondary" }}>{label}</Typography>
          </Box>
        ))}
      </Box>
      <Button size="small" variant="outlined" onClick={() => onShow(!show)} sx={{ alignSelf: "flex-start", ...outlineButton }}>
        {show ? "Hide Fields" : "Show Fields"}
      </Button>
      {show &&
        (fields.isLoading ? (
          <CircularProgress size={18} />
        ) : fields.isError ? (
          <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void fields.refetch()}>Retry</Button>}>
            {errorMessage(fields.error)}
          </Alert>
        ) : !all || all.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>No fields</Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                placeholder="Search fields…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                inputProps={{ "aria-label": "Search fields" }}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
                sx={{ flex: 1, "& input": { fontSize: 13 } }}
              />
              <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: FieldFilter | null) => v && setFilter(v)} aria-label="Field filter">
                {(["all", "standard", "custom"] as const).map((f) => (
                  <ToggleButton key={f} value={f} sx={{ textTransform: "none", px: 1, fontSize: 12 }}>{f === "all" ? "All" : f === "standard" ? "Standard" : "Custom"}</ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
            {hint(shown.length) ? (
              <Alert severity="info" sx={{ fontSize: 12 }}>{hint(shown.length)}</Alert>
            ) : (
              <Box sx={{ maxHeight: 280, overflow: "auto" }}>
                <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                  <TableHead cols={["Field", "API Name", "Type", ""]} />
                  <Box component="tbody">
                    {shown.map((f) => {
                      const target = fieldNodeByFqn.get(`${apiName}.${f.name}`);
                      return (
                        <Box component="tr" key={f.name}>
                          <Box component="td" sx={cell}>
                            {target ? (
                              <Box component="button" type="button" onClick={() => onSelectNode(target.nodeKey)} sx={{ all: "unset", cursor: "pointer", color: "primary.main", fontSize: 12, "&:hover": { textDecoration: "underline" } }}>
                                {f.label}
                              </Box>
                            ) : (
                              f.label
                            )}
                          </Box>
                          <Box component="td" sx={{ ...cell, ...mono, wordBreak: "break-all" }}>{f.name}</Box>
                          <Box component="td" sx={cell}>{f.type}</Box>
                          <Box component="td" sx={cell}><Badge label={f.custom ? "Custom" : "Standard"} color={f.custom ? "#5E35B1" : "#5E6878"} /></Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
            )}
          </>
        ))}
    </Stack>
  );
}
