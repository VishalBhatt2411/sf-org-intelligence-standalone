import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertTitle, Box, Button, Collapse, IconButton, Skeleton, Stack, Tooltip, Typography, useMediaQuery } from "@mui/material";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import ChevronRight from "@mui/icons-material/ChevronRight";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import KeyboardDoubleArrowLeft from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRight from "@mui/icons-material/KeyboardDoubleArrowRight";
import LockOutlined from "@mui/icons-material/LockOutlined";
import PushPin from "@mui/icons-material/PushPin";
import PushPinOutlined from "@mui/icons-material/PushPinOutlined";
import type { GraphApi, RecordNode } from "./graphApi";
import { errorMessage } from "./nodeStyle";
import { deriveRecordHierarchy, hierarchyCount, orgWideDefaultRows, recordOverviewRows } from "./recordPanelModel";
import { recordUrl } from "./salesforceLinks";

// Record mode's detail panel (port of the record branch of native oiNodeDetailPanel): Overview, Hierarchy and
// Sharing for whichever record is selected on the canvas. Like native, the selected record's own fragment is read
// (a neighbour gets its full detail, not just its label); the centre's is already in the query cache. Pin and
// collapse behave exactly as the Intelligence Panel's.

const mono = { fontFamily: "'JetBrains Mono', Consolas, monospace" } as const;

type SectionId = "overview" | "hierarchy" | "sharing";

// Hierarchy comes from the same fragment that resolved the record, so it starts open; Sharing is a separate live
// read and starts collapsed, loading only when expanded.
const DEFAULT_OPEN: Record<SectionId, boolean> = { overview: true, hierarchy: true, sharing: false };

const TINT: Record<SectionId, string> = { overview: "#2B50DD", hierarchy: "#5E35B1", sharing: "#A61B7B" };

function CountPill({ value }: { value: ReactNode }) {
  return (
    <Box component="span" sx={{ px: 0.9, minWidth: 22, textAlign: "center", borderRadius: 999, bgcolor: "action.hover", color: "text.secondary", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </Box>
  );
}

type SectionProps = { id: SectionId; title: string; icon: ReactNode; open: boolean; onToggle: (id: SectionId) => void; count?: ReactNode; hint?: string; children: ReactNode };

function Section({ id, title, icon, open, onToggle, count, hint, children }: SectionProps) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", borderLeft: `3px solid ${TINT[id]}` }}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        title={hint}
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

function KeyValueGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{k}</Typography>
          <Typography sx={{ fontSize: 13, wordBreak: "break-word", ...(k === "Record Id" || k === "Object" ? mono : {}) }}>{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}

const SubLabel = ({ children }: { children: ReactNode }) => <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "text.secondary", mt: 1, mb: 0.5 }}>{children}</Typography>;
const Note = ({ children }: { children: ReactNode }) => <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1 }}>{children}</Typography>;
const cell = { fontSize: 12, py: 0.5, pr: 1, verticalAlign: "top", borderTop: "1px solid", borderColor: "divider", textAlign: "left" } as const;
const headCell = { textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "text.secondary", pb: 0.5, pr: 1, whiteSpace: "nowrap" } as const;

function EmptyState({ title, message }: { title: string; message: string | null }) {
  return (
    <Box sx={{ mt: 0.5, p: 1.25, borderRadius: 1, bgcolor: "action.hover" }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{title}</Typography>
      {message && <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{message}</Typography>}
    </Box>
  );
}

function PairTable({ rows }: { rows: Array<{ key: string; head: string; value: string; onClick?: () => void }> }) {
  return (
    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <tbody>
        {rows.map((r) => (
          <Box component="tr" key={r.key}>
            <Box component="th" scope="row" sx={{ ...cell, fontWeight: 600, width: "42%", wordBreak: "break-word", ...mono, fontSize: 11.5 }}>
              {r.head}
            </Box>
            <Box component="td" sx={{ ...cell, wordBreak: "break-word" }}>
              {r.onClick ? (
                <Box component="button" type="button" onClick={r.onClick} sx={{ all: "unset", cursor: "pointer", color: "primary.main", "&:hover": { textDecoration: "underline" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}>
                  {r.value}
                </Box>
              ) : (
                r.value
              )}
            </Box>
          </Box>
        ))}
      </tbody>
    </Box>
  );
}

type Props = {
  api: GraphApi;
  connectionId: string;
  // The selected canvas record; null when nothing is selected.
  node: RecordNode | null;
  centerNodeKey: string | null;
  instanceUrl: string | null;
  onExploreFromHere: (nodeKey: string) => void;
  // Selects a record already on the canvas (a parent row of the centre); absent rows are plain text.
  onSelectNode: (nodeKey: string) => void;
  canvasNodeKeys: ReadonlySet<string>;
};

export function RecordPanel(p: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState<Record<SectionId, boolean>>(DEFAULT_OPEN);
  const nodeKey = p.node?.nodeKey ?? null;

  // Pinning keeps the section layout the user arranged; unpinned, every new record starts from the defaults.
  useEffect(() => {
    if (!pinned) setOpen(DEFAULT_OPEN);
  }, [nodeKey, pinned]);

  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <Box
      component="aside"
      aria-label="Record Panel"
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
        {!collapsed && <Typography sx={{ flex: 1, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Record Panel</Typography>}
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
          {p.node ? <RecordBody key={p.node.nodeKey} {...p} node={p.node} open={open} onToggle={toggle} /> : <Typography sx={{ p: 2, fontSize: 13, color: "text.secondary" }}>Select a record to see its details.</Typography>}
        </Box>
      )}
    </Box>
  );
}

type BodyProps = Props & { node: RecordNode; open: Record<SectionId, boolean>; onToggle: (id: SectionId) => void };

function RecordBody({ api, connectionId, node, centerNodeKey, instanceUrl, onExploreFromHere, onSelectNode, canvasNodeKeys, open, onToggle }: BodyProps) {
  // Same key as the canvas's own fragment read, so selecting the centre costs nothing.
  const fragment = useQuery({
    queryKey: ["graph", "recordFragment", connectionId, node.objectApiName, node.recordId],
    queryFn: () => api.recordFragment(node.objectApiName, node.recordId),
    staleTime: 30_000,
    retry: false,
  });
  // A record's sharing is never presented as a possibly-stale answer: read live each time the section opens.
  const sharing = useQuery({
    queryKey: ["graph", "recordSharing", connectionId, node.objectApiName, node.recordId],
    queryFn: () => api.recordSharing(node.objectApiName, node.recordId),
    enabled: open.sharing,
    staleTime: 0,
    retry: false,
  });

  const data = fragment.data;
  const found = Boolean(data?.centerNodeKey && data.nodes.some((n) => n.nodeKey === data.centerNodeKey));
  const hierarchy = useMemo(() => (data && found && data.centerNodeKey ? deriveRecordHierarchy(data, data.centerNodeKey) : null), [data, found]);
  const isCenter = node.nodeKey === centerNodeKey;

  const header = (
    <Box sx={{ p: 2, pb: 1.5 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 700, wordBreak: "break-word" }}>{node.label}</Typography>
      <Typography variant="caption" color="text.secondary" sx={mono}>
        {node.objectApiName} · {node.recordId}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} useFlexGap flexWrap="wrap">
        {!isCenter && (
          <Button size="small" variant="contained" disableElevation onClick={() => onExploreFromHere(node.nodeKey)} sx={{ textTransform: "none" }}>
            Explore From Here
          </Button>
        )}
        {instanceUrl && (
          <Button size="small" variant="outlined" onClick={() => window.open(recordUrl(instanceUrl, node.objectApiName, node.recordId), "_blank", "noopener")} sx={{ textTransform: "none" }}>
            Open in Salesforce
          </Button>
        )}
      </Stack>
    </Box>
  );

  if (fragment.isLoading) {
    return (
      <>
        {header}
        <Box sx={{ px: 2 }} aria-label="Loading record">
          <Skeleton height={22} />
          <Skeleton height={22} />
          <Skeleton height={22} width="60%" />
        </Box>
      </>
    );
  }
  if (fragment.isError) {
    return (
      <>
        {header}
        <Alert severity="error" sx={{ mx: 2 }} action={<Button size="small" color="inherit" onClick={() => void fragment.refetch()}>Retry</Button>}>
          <strong>Couldn't load this record.</strong> {errorMessage(fragment.error)}
        </Alert>
      </>
    );
  }
  if (!found || !hierarchy) {
    return (
      <>
        {header}
        <Box sx={{ px: 2 }}>
          <EmptyState title="No record found" message="No record found for that selection." />
        </Box>
      </>
    );
  }

  const owdRows = orgWideDefaultRows(sharing.data?.orgWideDefault ?? null);
  const rows = sharing.data?.shareRows ?? [];

  return (
    <>
      {header}
      <Section id="overview" title="Overview" icon={<InfoOutlined />} open={open.overview} onToggle={onToggle}>
        <KeyValueGrid rows={recordOverviewRows(node, data?.overview ?? null)} />
      </Section>

      <Section id="hierarchy" title="Hierarchy" icon={<AccountTreeOutlined />} open={open.hierarchy} onToggle={onToggle} count={hierarchyCount(hierarchy)} hint="Parent and child records directly connected to this record">
        {hierarchy.parentRows.length > 0 && (
          <>
            <SubLabel>Parent records</SubLabel>
            <PairTable
              rows={hierarchy.parentRows.map((r) => ({
                key: r.key,
                head: r.relationshipLabel,
                value: `${r.typeLabel} · ${r.label}`,
                onClick: canvasNodeKeys.has(r.nodeKey) ? () => onSelectNode(r.nodeKey) : undefined,
              }))}
            />
          </>
        )}
        {hierarchy.childRows.length > 0 && (
          <>
            <SubLabel>Child records (by relationship)</SubLabel>
            <PairTable rows={hierarchy.childRows.map((r) => ({ key: r.key, head: r.relationshipLabel, value: `${r.typeLabel} · ${r.count} shown` }))} />
          </>
        )}
        {hierarchy.hasMore && <Note>Additional parent lookups, relationship types, or child records exist beyond what's shown here — bounded to keep this within governor limits.</Note>}
        {hierarchy.parentRows.length === 0 && hierarchy.childRows.length === 0 && <EmptyState title="No related records" message="No parent lookups or child records were found for this record." />}
      </Section>

      <Section id="sharing" title="Sharing" icon={<LockOutlined />} open={open.sharing} onToggle={onToggle} hint="Who has access to this specific record, and why">
        {sharing.data && (
          <>
            <SubLabel>Org-Wide Default</SubLabel>
            {sharing.data.orgWideDefault?.supported ? <KeyValueGrid rows={owdRows} /> : <Note>{sharing.data.orgWideDefault?.unavailableReason ?? "Sharing settings are not available for this object."}</Note>}
            {sharing.data.isLockedByApproval && (
              <Alert severity="error" icon={<LockOutlined fontSize="small" />} sx={{ mt: 1.25 }}>
                <AlertTitle sx={{ fontSize: 13 }}>Locked by an approval process</AlertTitle>
                {sharing.data.pendingApprovalDetail}
              </Alert>
            )}
          </>
        )}
        {sharing.isLoading ? (
          <Box aria-label="Loading sharing" sx={{ mt: 0.5 }}>
            <Skeleton height={22} />
            <Skeleton height={22} />
            <Skeleton height={22} width="60%" />
          </Box>
        ) : sharing.isError ? (
          <Alert severity="error" sx={{ mt: 0.5 }} action={<Button size="small" color="inherit" onClick={() => void sharing.refetch()}>Retry</Button>}>
            <strong>Couldn't load sharing.</strong> {errorMessage(sharing.error)}
          </Alert>
        ) : sharing.data ? (
          sharing.data.supportsSharing ? (
            rows.length > 0 ? (
              <>
                <SubLabel>Share rows</SubLabel>
                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                  <Box component="thead">
                    <Box component="tr">
                      {["Shared With", "Access", "Reason"].map((c) => (
                        <Box key={c} component="th" scope="col" sx={headCell}>
                          {c}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <tbody>
                    {rows.map((r, i) => (
                      <Box component="tr" key={r.userOrGroupId ? `${r.userOrGroupId}-${i}` : `row-${i}`}>
                        <Box component="td" sx={{ ...cell, wordBreak: "break-word" }}>
                          {r.userOrGroupLabel ?? <Box component="span" sx={mono}>{r.userOrGroupId ?? "—"}</Box>}
                        </Box>
                        <Box component="td" sx={cell}>{r.accessLevel ?? "—"}</Box>
                        <Box component="td" sx={cell}>{r.rowCause ?? "—"}</Box>
                      </Box>
                    ))}
                  </tbody>
                </Box>
                {sharing.data.truncated && <Note>Additional share rows exist beyond what's shown here — bounded to keep this within governor limits.</Note>}
              </>
            ) : (
              <EmptyState title="No share rows" message={sharing.data.coverageNote} />
            )
          ) : (
            <EmptyState title="Not applicable" message={sharing.data.coverageNote} />
          )
        ) : null}
      </Section>
    </>
  );
}
