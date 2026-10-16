import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertTitle, Box, Button, Chip, CircularProgress, Collapse, IconButton, InputAdornment, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery } from "@mui/material";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import ChevronRight from "@mui/icons-material/ChevronRight";
import CodeOutlined from "@mui/icons-material/CodeOutlined";
import ExpandMore from "@mui/icons-material/ExpandMore";
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
import type { ConnectionRow, GraphApi, GraphNode, ImpactDirection, IntelligenceCategory, IntelligenceItem, IntelligenceStatus, NodeDetail } from "./graphApi";
import { rowSetupRef } from "./drilldownModel";
import { IntelligenceDrilldown, type DrilldownSelection } from "./IntelligenceDrilldown";
import {
  buildEmptyStateMessage,
  COUNTS_ERROR_TITLE,
  COUNTS_TRUNCATED_NOTE,
  DETAIL_ERROR_TITLE,
  DETAIL_MISSING,
  directConnectionNote,
  directionLabel,
  distinctTargets,
  drillDirection,
  FIELDS_EMPTY,
  FIELDS_ERROR_FALLBACK,
  FIELDS_ERROR_TITLE,
  FIELDS_NO_MATCH,
  fieldRelationshipRows,
  fieldRowTitle,
  fieldTotals,
  filterFields,
  formatTargets,
  groupIntelligenceItems,
  GROUP_DRILL_TITLE,
  hasFields,
  IMPACT_EMPTY,
  IMPACT_ERROR_FALLBACK,
  IMPACT_ERROR_TITLE,
  impactColumnHeader,
  impactTypeBreakdown,
  incomingEdgeCounts,
  LOAD_COUNTS_LABEL,
  LOAD_COUNTS_TITLE,
  LOOKUP_EDGE_TYPE_KEY,
  MASTER_DETAIL_EDGE_TYPE_KEY,
  outgoingFieldRows,
  OUTGOING_EMPTY,
  OUTGOING_HEADING,
  overviewRows,
  relationshipCounts,
  relationshipRows,
  sortFieldsByLabel,
  targetWithCount,
  technicalAttributes,
  type FieldFilter,
  type FieldTotals,
} from "./intelligenceModel";
import { errorMessage } from "./nodeStyle";
import type { ObjectRelationshipView, VisibilityMode } from "./objectRelationshipView";
import type { OpenResult } from "./openInSalesforce";
import type { MetadataNodeRef } from "./salesforceLinks";

// The Intelligence Panel (port of native oiNodeDetailPanel) for Object analyze mode: everything the graph and
// the live org can say about the selected component, in collapsible sections. The server groups and explains
// (intelligence service); this file only lays it out. Restyled with the Tech Debt MUI theme.

const mono = { fontFamily: "'JetBrains Mono', Consolas, monospace" } as const;

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

const itemRow = (i: IntelligenceItem): Row => ({ nodeKey: i.nodeKey, label: i.label, sub: `${i.kindLabel} · ${directionLabel(i.direction)}`, status: i.status });

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
      {cols.map((c, i) => (
        <Box key={`${c}:${i}`} component="th" sx={{ textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "text.secondary", pb: 0.5, pr: 1, whiteSpace: "nowrap" }}>
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
  // The object the canvas is centred on. The Self / Referenced / Referencing counts only describe that object,
  // so they are hidden for any other selection. Defaults to the view's root object.
  centerNodeKey?: string | null;
  // The canvas's Business / System / All filter, which also decides whether system lookups are listed.
  visibilityMode?: VisibilityMode;
  // Drill-down row actions. Without them the buttons are hidden.
  openSetup?: (node: MetadataNodeRef) => Promise<OpenResult>;
  onShowOnGraph?: (nodeKey: string) => void;
};

export function IntelligencePanel(p: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState<Record<SectionId, boolean>>(DEFAULT_OPEN);
  // "Coverage details" open state per Intelligence section; kept with the layout while pinned.
  const [coverageOpen, setCoverageOpen] = useState<Record<string, boolean>>({});

  // Pinning keeps the section layout the user arranged; unpinned, every new node starts from the defaults.
  useEffect(() => {
    if (!pinned) {
      setOpen(DEFAULT_OPEN);
      setCoverageOpen({});
    }
  }, [p.nodeKey, pinned]);

  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const toggleCoverage = (id: string) => setCoverageOpen((o) => ({ ...o, [id]: !o[id] }));

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
          {p.nodeKey ? <PanelBody key={p.nodeKey} {...p} nodeKey={p.nodeKey} open={open} onToggle={toggle} coverageOpen={coverageOpen} onToggleCoverage={toggleCoverage} /> : <Typography sx={{ p: 2, fontSize: 13, color: "text.secondary" }}>Select a node to see its details.</Typography>}
        </Box>
      )}
    </Box>
  );
}

type BodyProps = Props & { nodeKey: string; open: Record<SectionId, boolean>; onToggle: (id: SectionId) => void; coverageOpen: Record<string, boolean>; onToggleCoverage: (id: string) => void };

function PanelBody({ api, connectionId, nodeKey, view, highlighted, onSelectNode, onHighlight, centerNodeKey, visibilityMode = "all", openSetup, onShowOnGraph, open, onToggle, coverageOpen, onToggleCoverage }: BodyProps) {
  const detail = useQuery({ queryKey: ["graph", "detail", connectionId, nodeKey], queryFn: () => api.detail(nodeKey), staleTime: 60_000 });
  const node = detail.data?.node;
  const isObject = node?.kind === "CustomObject";
  const isField = node?.kind === "CustomField";
  const intelligence = useQuery({ queryKey: ["graph", "intelligence", connectionId, nodeKey], queryFn: () => api.intelligence(nodeKey), enabled: Boolean(node), staleTime: 60_000 });

  const [showFields, setShowFields] = useState(false);
  const [drilldown, setDrilldown] = useState<DrilldownSelection | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [showTech, setShowTech] = useState(false);
  const [wantCounts, setWantCounts] = useState(false);
  const [impactDir, setImpactDir] = useState<ImpactDirection | null>(null);

  // The live field list: only fetched once the user asks to see the fields, and kept cached when hidden again.
  const fields = useQuery({ queryKey: ["graph", "fields", connectionId, node?.fqn], queryFn: () => api.fields(node!.fqn), enabled: Boolean(isObject) && showFields, staleTime: 60_000 });
  // Outgoing Lookup / Master-Detail fields straight from the scanned graph.
  const relFields = useQuery({ queryKey: ["graph", "relationshipFields", connectionId, nodeKey], queryFn: () => api.relationshipFields(nodeKey), enabled: Boolean(isObject) && open.relationships, staleTime: 60_000 });
  const sharing = useQuery({ queryKey: ["graph", "sharing", connectionId, node?.fqn], queryFn: () => api.sharing(node!.fqn), enabled: Boolean(isObject) && open.sharing, staleTime: 60_000, retry: false });
  const outgoingRows = useMemo(() => outgoingFieldRows(relFields.data ?? [], visibilityMode), [relFields.data, visibilityMode]);
  const targets = useMemo(() => distinctTargets(outgoingRows.map((r) => ({ referenceTo: r.targets }))), [outgoingRows]);
  const counts = useQuery({ queryKey: ["graph", "recordCounts", connectionId, targets.join(",")], queryFn: () => api.recordCounts(targets), enabled: wantCounts && targets.length > 0, staleTime: 60_000, retry: false });
  const impact = useQuery({ queryKey: ["graph", "impact", connectionId, nodeKey, impactDir], queryFn: () => api.impact(nodeKey, impactDir!), enabled: impactDir !== null, staleTime: 60_000, retry: false });

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
        <AlertTitle>{detail.isError ? DETAIL_ERROR_TITLE : DETAIL_MISSING}</AlertTitle>
        {detail.isError ? errorMessage(detail.error) : null}
      </Alert>
    );
  }

  const data: NodeDetail = detail.data;
  const counted = counts.data?.counts;
  const centreKey = centerNodeKey === undefined ? (view?.rootObject?.nodeKey ?? null) : centerNodeKey;
  const centreCounts = isObject && nodeKey === centreKey ? relationshipCounts(view) : null;
  const incoming = incomingEdgeCounts(data.edgeSummary);
  const totals = fieldTotals(node, data.edgeSummary, fields.data?.fields);
  const category = (key: string): IntelligenceCategory | undefined => intelligence.data?.categories.find((c) => c.category === key);
  const technical = technicalAttributes(node);
  const relationshipSectionRows = !isObject ? relationshipRows(data.edgeSummary) : [];
  const fieldRelRows = isField ? fieldRelationshipRows(node) : [];

  const openDrilldown = (direction: DrilldownSelection["direction"], edgeTypeKey: string, relationshipLabel: string) => setDrilldown({ nodeKey, anchorLabel: node.label, direction, edgeTypeKey, relationshipLabel });
  const toggleGroup = (key: string) =>
    setOpenGroups((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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
                {groups.map((g) => {
                  const expanded = openGroups.has(`${id}:${g.groupKey}`);
                  return (
                    <Box key={g.groupKey}>
                      <Box
                        component="button"
                        type="button"
                        title={g.drillDown ? GROUP_DRILL_TITLE : undefined}
                        aria-expanded={g.drillDown ? undefined : expanded}
                        onClick={() => (g.drillDown ? openDrilldown(drillDirection(g.direction), g.edgeTypeKey, g.label) : toggleGroup(`${id}:${g.groupKey}`))}
                        sx={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 1, py: 0.25, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}
                      >
                        <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{g.label}</Typography>
                        <CountPill value={g.items.length} />
                        {g.drillDown ? <ChevronRight sx={{ fontSize: 16, color: "text.secondary" }} /> : <ExpandMore sx={{ fontSize: 16, color: "text.secondary", transform: expanded ? "none" : "rotate(-90deg)" }} />}
                      </Box>
                      {!g.drillDown && expanded && <RowList rows={g.items.map(itemRow)} onOpen={onSelectNode} />}
                    </Box>
                  );
                })}
              </Stack>
            )}
            {cat.truncated && <Typography sx={{ mt: 1, fontSize: 11.5, color: "text.secondary" }}>Showing the first results only — more exist than are listed here.</Typography>}
            <Box sx={{ mt: 1 }}>
              <Box component="button" type="button" aria-expanded={Boolean(coverageOpen[id])} onClick={() => onToggleCoverage(id)} sx={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 11.5, color: "text.secondary", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}>
                <ChevronRight sx={{ fontSize: 14, transform: coverageOpen[id] ? "rotate(90deg)" : "none" }} />
                Coverage details
              </Box>
              {coverageOpen[id] && <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.5 }}>{cat.coverageNote ?? "No coverage limitations were reported for this category."}</Typography>}
            </Box>
          </>
        )}
      </Section>
    );
  };

  return (
    <Box>
      <Section id="overview" title="Overview" icon={<InfoOutlined />} open={open.overview} onToggle={onToggle}>
        <KeyValueGrid rows={overviewRows(node, data.parent?.label ?? null)} />
      </Section>

      {fieldRelRows.length > 0 && (
        <Section id="fieldRelationship" title="Relationship" icon={<HubOutlined />} open={open.fieldRelationship} onToggle={onToggle}>
          <KeyValueGrid rows={fieldRelRows} />
        </Section>
      )}

      {isObject && hasFields(totals) && (
        <Section id="fields" title="Fields" icon={<ListAltOutlined />} open={open.fields} onToggle={onToggle} count={fields.data ? fields.data.fields.length : (totals.total ?? "—")}>
          <FieldsBody fields={fields} totals={totals} show={showFields} onShow={setShowFields} onSelectNode={onSelectNode} />
        </Section>
      )}

      {!isField && (
        <Section id="relationships" title="Relationships" icon={<HubOutlined />} open={open.relationships} onToggle={onToggle} count={isObject ? (centreCounts ? 5 : 2) : relationshipSectionRows.length}>
          {isObject ? (
            <Stack spacing={1.25}>
              <Stack spacing={0.5}>
                {centreCounts && (
                  <>
                    <CountRow label="Self Relationships" value={centreCounts.selfRelationships} />
                    <CountRow label="Referenced Objects" value={centreCounts.referencedObjects} />
                    <CountRow label="Referencing Objects" value={centreCounts.referencingObjects} />
                  </>
                )}
                <CountRow label="Incoming Lookups" value={incoming.incomingLookups} onClick={() => openDrilldown("incoming", LOOKUP_EDGE_TYPE_KEY, "Incoming Lookups")} />
                <CountRow label="Incoming Master-Detail" value={incoming.incomingMasterDetail} onClick={() => openDrilldown("incoming", MASTER_DETAIL_EDGE_TYPE_KEY, "Incoming Master-Detail")} />
              </Stack>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary" }}>{OUTGOING_HEADING}</Typography>
              {relFields.isLoading ? (
                <Skeleton variant="rounded" height={48} />
              ) : relFields.isError ? (
                <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void relFields.refetch()}>Retry</Button>}>
                  {errorMessage(relFields.error)}
                </Alert>
              ) : outgoingRows.length === 0 ? (
                <Alert severity="info">
                  <AlertTitle>{OUTGOING_EMPTY.title}</AlertTitle>
                  {OUTGOING_EMPTY.message}
                </Alert>
              ) : (
                <>
                  <Box sx={{ overflowX: "auto" }}>
                    <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                      <TableHead cols={["Field", "Type", "Required", "Cascade Delete", "Target Object(s)"]} />
                      <Box component="tbody">
                        {outgoingRows.map((r) => {
                          const t = formatTargets(r.targets, (n) => targetWithCount(n, counted));
                          return (
                            <Box component="tr" key={r.nodeKey}>
                              <Box component="td" sx={cell} title={r.apiName}>{r.label}</Box>
                              <Box component="td" sx={cell}>{r.type}</Box>
                              <Box component="td" sx={cell}>{r.required}</Box>
                              <Box component="td" sx={cell}>{r.cascadeDelete}</Box>
                              <Box component="td" sx={cell} title={t.title}>{t.text}</Box>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  </Box>
                  {targets.length > 0 && !counts.data && (
                    <Button size="small" variant="outlined" title={LOAD_COUNTS_TITLE} disabled={counts.isFetching} onClick={() => (wantCounts ? void counts.refetch() : setWantCounts(true))} sx={{ alignSelf: "flex-start", ...outlineButton }}>
                      {counts.isFetching ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                      {LOAD_COUNTS_LABEL}
                    </Button>
                  )}
                  {counts.isError && (
                    <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void counts.refetch()}>Retry</Button>}>
                      <AlertTitle>{COUNTS_ERROR_TITLE}</AlertTitle>
                      {errorMessage(counts.error)}
                    </Alert>
                  )}
                  {counts.data?.truncated && <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{COUNTS_TRUNCATED_NOTE}</Typography>}
                </>
              )}
            </Stack>
          ) : (
            <Stack spacing={0.5}>
              {relationshipSectionRows.length === 0 ? (
                <Typography sx={{ fontSize: 13, color: "text.secondary" }}>No relationships found in the last scan.</Typography>
              ) : (
                relationshipSectionRows.map((row) => <CountRow key={row.key} label={row.label} value={row.count} onClick={() => openDrilldown(row.direction, row.edgeTypeKey, row.relationshipLabel)} />)
              )}
              {data.edgeTotal > 0 && <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.5 }}>{directConnectionNote(data.edgeTotal)}</Typography>}
            </Stack>
          )}
        </Section>
      )}

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
        {impactDir && impact.isLoading && (
          <Stack role="status" aria-label="Computing impact" spacing={0.75} sx={{ mt: 1.5 }}>
            <Skeleton variant="rounded" height={24} />
            <Skeleton variant="rounded" height={24} />
            <Skeleton variant="rounded" height={24} />
          </Stack>
        )}
        {impact.isError && (
          <Alert severity="error" sx={{ mt: 1.5 }} action={<Button size="small" color="inherit" onClick={() => void impact.refetch()}>Retry</Button>}>
            <AlertTitle>{IMPACT_ERROR_TITLE}</AlertTitle>
            {errorMessage(impact.error) === "Something went wrong" ? IMPACT_ERROR_FALLBACK : errorMessage(impact.error)}
          </Alert>
        )}
        {impact.data && impactDir && (
          <Box sx={{ mt: 1.5 }}>
            {impact.data.caveats.filter((c) => c.code !== "truncated").map((c) => (
              <Alert key={c.code} severity={c.code === "scope" || c.code === "heuristic" ? "info" : "warning"} sx={{ mb: 1, fontSize: 12 }}>{c.message}</Alert>
            ))}
            {impact.data.nodes.length === 0 ? (
              <Alert severity="info">
                <AlertTitle>{IMPACT_EMPTY.title}</AlertTitle>
                {IMPACT_EMPTY.message}
              </Alert>
            ) : (
              <>
                {impactTypeBreakdown(impact.data.nodes).length > 0 && (
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                    {impactTypeBreakdown(impact.data.nodes).map((s) => (
                      <Chip key={s.typeKey} size="small" variant="outlined" label={`${s.count} ${s.label}`} />
                    ))}
                  </Stack>
                )}
                {impact.data.truncated && <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>The result was capped; focus on a narrower component to see everything.</Typography>}
                <Box sx={{ maxHeight: 260, overflow: "auto" }}>
                  <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                    <TableHead cols={[impactColumnHeader(impactDir), "Type", "Hops", ""]} />
                    <Box component="tbody">
                      {impact.data.nodes.map((n) => (
                        <Box component="tr" key={n.nodeKey} tabIndex={0} onClick={() => onSelectNode(n.nodeKey)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelectNode(n.nodeKey))} sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } }}>
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

      {technical.length > 0 && (
        <Section id="technical" title="Technical Details" icon={<TuneOutlined />} open={open.technical} onToggle={onToggle}>
          <Button size="small" onClick={() => setShowTech((v) => !v)} sx={{ ml: -0.5, ...outlineButton }}>{showTech ? "Hide technical details" : "Show technical details"}</Button>
          {showTech && (
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
          )}
        </Section>
      )}

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", px: 1.5, py: 1.25 }}>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
          {intelligence.data?.lastScannedAt ? `Metadata intelligence last scanned ${new Date(intelligence.data.lastScannedAt).toLocaleString()}` : intelligence.data ? "Never scanned — run a scan to build metadata intelligence." : " "}
          {intelligence.data?.hasCoverageLimitations && <Box component="span" sx={{ color: "warning.main" }}> · Some dependency types were not fully scanned</Box>}
        </Typography>
      </Box>

      {drilldown && (
        <IntelligenceDrilldown
          api={api}
          connectionId={connectionId}
          selection={drilldown}
          onClose={() => setDrilldown(null)}
          onShowOnGraph={(row: ConnectionRow) => {
            setDrilldown(null);
            (onShowOnGraph ?? onSelectNode)(row.nodeKey);
          }}
          onOpenSetup={openSetup ? (row: ConnectionRow) => openSetup(rowSetupRef(row)) : undefined}
        />
      )}
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
    <Box component="button" type="button" title={GROUP_DRILL_TITLE} onClick={onClick} sx={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 1, py: 0.25, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}>
      {content}
    </Box>
  ) : (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>{content}</Box>
  );
}

type FieldsQuery = ReturnType<typeof useQuery<import("./graphApi").ObjectFields>>;

function FieldsBody({ fields, totals, show, onShow, onSelectNode }: { fields: FieldsQuery; totals: FieldTotals; show: boolean; onShow: (v: boolean) => void; onSelectNode: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("all");
  const all = fields.data?.fields;
  const tiles: Array<[string, number | null]> = [["Total", totals.total], ["Standard", totals.standard], ["Custom", totals.custom], ["Relationship", totals.relationship]];
  const shown = useMemo(() => (all ? sortFieldsByLabel(filterFields(all, query, filter)) : []), [all, query, filter]);
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
            <AlertTitle>{FIELDS_ERROR_TITLE}</AlertTitle>
            {errorMessage(fields.error) === "Something went wrong" ? FIELDS_ERROR_FALLBACK : errorMessage(fields.error)}
          </Alert>
        ) : !all || all.length === 0 ? (
          <Alert severity="info">
            <AlertTitle>{FIELDS_EMPTY.title}</AlertTitle>
            {FIELDS_EMPTY.message}
          </Alert>
        ) : (
          <>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                placeholder="Search fields..."
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
            {shown.length === 0 ? (
              <Alert severity="info" sx={{ fontSize: 12 }}>
                <AlertTitle>{FIELDS_NO_MATCH.title}</AlertTitle>
                {FIELDS_NO_MATCH.message}
              </Alert>
            ) : (
              <Box sx={{ maxHeight: 280, overflow: "auto" }}>
                <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                  <TableHead cols={["Field", "API Name", "Data Type", ""]} />
                  <Box component="tbody">
                    {shown.map((f) => {
                      const key = f.nodeKey ?? null;
                      const rowProps = key
                        ? { role: "button", tabIndex: 0, onClick: () => onSelectNode(key), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelectNode(key)) }
                        : {};
                      return (
                        <Box component="tr" key={f.name} title={fieldRowTitle(key)} {...rowProps} sx={key ? { cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } } : undefined}>
                          <Box component="td" sx={{ ...cell, ...(key ? { color: "primary.main" } : {}) }}>{f.label}</Box>
                          <Box component="td" sx={{ ...cell, ...mono, wordBreak: "break-all" }}>{f.name}</Box>
                          <Box component="td" sx={cell}>{f.type || "—"}</Box>
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
