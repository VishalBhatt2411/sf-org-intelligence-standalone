import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link, Stack, Typography } from "@mui/material";
import { AnchorSearch } from "./AnchorSearch";
import { graphApi, type GraphNode, type GraphSummary, type RecordNode, type RecordSummary } from "./graphApi";
import { errorMessage } from "./nodeStyle";
import { RecordPanel } from "./RecordPanel";
import { RecordPicker } from "./RecordPicker";
import { buildRecordRelationshipView } from "./recordRelationshipView";
import { ReadyToMap } from "./ReadyToMap";
import { RelationshipCanvas } from "./RelationshipCanvas";
import { recordUrl } from "./salesforceLinks";
import type { ObjectRef } from "./objectRelationshipView";

type RecordModeViewProps = {
  connectionId: string;
  summary: GraphSummary;
  dark: boolean;
  instanceUrl: string | null;
};

type Anchor = { objectApiName: string; recordId: string; label: string };
type ObjectChoice = { apiName: string; label: string };

// Record analyze mode (port of native Record Analysis, ADR-0021): choose an object, then one of its records, and
// the canvas shows that record's parents (right) and child records (left). Everything is read live from the org
// and never stored; "Explore From Here" re-anchors on a neighbouring record and extends the breadcrumb trail.
export function RecordModeView({ connectionId, summary, dark, instanceUrl }: RecordModeViewProps) {
  const api = useMemo(() => graphApi(connectionId), [connectionId]);
  const objectTypeKey = summary.nodesByType.find((t) => t.kind === "CustomObject")?.typeKey ?? null;
  const [object, setObject] = useState<ObjectChoice | null>(null);
  const [trail, setTrail] = useState<Anchor[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const anchor = trail.length ? trail[trail.length - 1] : null;
  const fragment = useQuery({
    queryKey: ["graph", "recordFragment", connectionId, anchor?.objectApiName, anchor?.recordId],
    queryFn: () => api.recordFragment(anchor!.objectApiName, anchor!.recordId),
    enabled: Boolean(anchor),
    staleTime: 30_000,
    retry: false,
  });
  const data = fragment.data;
  const centerKey = data?.centerNodeKey ?? null;
  const view = useMemo(() => (data && centerKey ? buildRecordRelationshipView(data.nodes, data.edges, centerKey) : null), [data, centerKey]);
  useEffect(() => setSelectedKey(centerKey), [centerKey]);

  const pickObject = (node: GraphNode) => {
    setObject({ apiName: node.fqn, label: node.label });
    setTrail([]);
  };
  const changeObject = () => {
    setObject(null);
    setTrail([]);
  };
  const pickRecord = (r: RecordSummary) => setTrail([{ objectApiName: r.objectApiName, recordId: r.recordId, label: r.label }]);
  const exploreFrom = (nodeKey: string) => {
    const n = data?.nodes.find((x) => x.nodeKey === nodeKey);
    if (n) setTrail((t) => [...t, { objectApiName: n.objectApiName, recordId: n.recordId, label: n.label }]);
  };

  const openRecord = instanceUrl ? (o: ObjectRef) => o.recordId && window.open(recordUrl(instanceUrl, o.secondaryKey ?? o.fqn, o.recordId), "_blank", "noopener") : undefined;
  const selected: RecordNode | undefined = data?.nodes.find((n) => n.nodeKey === selectedKey);
  const canvasNodeKeys = useMemo(() => new Set((data?.nodes ?? []).map((n) => n.nodeKey)), [data]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap" sx={{ px: { xs: 2, md: 3 }, py: 1.25, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        {object ? (
          <>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 0.5, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <Box sx={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, bgcolor: "primary.main", color: "primary.contrastText" }}>1</Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.1 }}>
                  Searching records in
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{object.label}</Typography>
              </Box>
              <Button size="small" onClick={changeObject} sx={{ textTransform: "none" }}>
                Change object
              </Button>
            </Stack>
            <RecordPicker api={api} connectionId={connectionId} objectApiName={object.apiName} placeholder={`Search ${object.label}…`} onPick={pickRecord} />
          </>
        ) : (
          <AnchorSearch api={api} connectionId={connectionId} typeKey={objectTypeKey ?? ""} label="Choose an object" placeholder="First, search for the object this record belongs to (e.g. Account)…" typeLabel="Object" disabled={!objectTypeKey} onPick={pickObject} />
        )}
        <Breadcrumbs maxItems={5} separator="›" sx={{ flexGrow: 1, minWidth: 0, fontSize: 13 }}>
          <Link component="button" underline="hover" color="text.secondary" onClick={changeObject} sx={{ fontSize: 13 }}>
            Records
          </Link>
          {trail.map((a, i) =>
            i === trail.length - 1 ? (
              <Typography key={`${a.recordId}-${i}`} sx={{ fontSize: 13, fontWeight: 500 }}>
                {a.label}
              </Typography>
            ) : (
              <Link key={`${a.recordId}-${i}`} component="button" underline="hover" color="text.secondary" onClick={() => setTrail((t) => t.slice(0, i + 1))} sx={{ fontSize: 13 }}>
                {a.label}
              </Link>
            ),
          )}
        </Breadcrumbs>
      </Stack>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0, flexDirection: { xs: "column", md: "row" } }}>
        {!anchor ? (
          <ReadyToMap lens="record" />
        ) : (
          <>
            <Box sx={{ position: "relative", flex: 3, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", p: { xs: 1, md: 2 }, gap: 1 }}>
              {fragment.isError && (
                <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void fragment.refetch()}>Retry</Button>}>
                  <strong>Couldn't load that record.</strong> {errorMessage(fragment.error)}
                </Alert>
              )}
              {data?.hasMore && <Alert severity="info">This record has more related records than can be drawn at once, so some are not shown. Use Explore From Here on a related record to follow a specific path.</Alert>}
              {fragment.isLoading && (
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5 }}>
                  <CircularProgress size={22} />
                  <Typography color="text.secondary">Mapping {anchor.label}…</Typography>
                </Box>
              )}
              {data && !centerKey && (
                <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0.5, textAlign: "center", p: 3 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700 }}>No record found</Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>No record found for that selection.</Typography>
                </Box>
              )}
              {view && centerKey && <RelationshipCanvas kind="Record" view={view} centerNodeKey={centerKey} dark={dark} onSelect={setSelectedKey} onExploreFromHere={exploreFrom} onOpenInSalesforce={openRecord} />}
            </Box>

            <RecordPanel api={api} connectionId={connectionId} node={selected ?? null} centerNodeKey={centerKey} instanceUrl={instanceUrl} onExploreFromHere={exploreFrom} onSelectNode={setSelectedKey} canvasNodeKeys={canvasNodeKeys} />
          </>
        )}
      </Box>
    </Box>
  );
}
