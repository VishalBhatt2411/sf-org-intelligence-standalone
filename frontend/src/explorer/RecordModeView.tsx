import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link, Stack, Typography } from "@mui/material";
import { AnchorSearch } from "./AnchorSearch";
import { graphApi, type GraphNode, type GraphSummary, type RecordNode, type RecordSummary } from "./graphApi";
import { errorMessage } from "./nodeStyle";
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

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "—");

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
              {view && centerKey && <RelationshipCanvas kind="Record" view={view} centerNodeKey={centerKey} dark={dark} onSelect={setSelectedKey} onExploreFromHere={exploreFrom} onOpenInSalesforce={openRecord} />}
            </Box>

            <Box
              component="aside"
              aria-label="Record Panel"
              sx={{ flex: { md: 1 }, minWidth: { md: 320 }, maxWidth: { md: 420 }, maxHeight: { xs: "45%", md: "none" }, display: "flex", flexDirection: "column", overflow: "hidden", borderLeft: { md: "1px solid" }, borderTop: { xs: "1px solid", md: "none" }, borderColor: "divider", bgcolor: "background.paper" }}
            >
              <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Record Panel</Typography>
              </Box>
              <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: 2 }}>
                {selected ? (
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{selected.label}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
                        {selected.objectApiName} · {selected.recordId}
                      </Typography>
                    </Box>
                    {selected.nodeKey === centerKey && data?.overview && (
                      <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
                        <tbody>
                          {[
                            ["Owner", data.overview.ownerName ?? "—"],
                            ["Created", when(data.overview.createdDate)],
                            ["Last Modified", when(data.overview.lastModifiedDate)],
                          ].map(([k, v]) => (
                            <Box component="tr" key={k}>
                              <Box component="td" sx={{ py: 0.5, fontSize: 12, color: "text.secondary", width: "40%" }}>{k}</Box>
                              <Box component="td" sx={{ py: 0.5, fontSize: 12 }}>{v}</Box>
                            </Box>
                          ))}
                        </tbody>
                      </Box>
                    )}
                    <Stack direction="row" spacing={1}>
                      {selected.nodeKey !== centerKey && (
                        <Button size="small" variant="contained" disableElevation onClick={() => exploreFrom(selected.nodeKey)} sx={{ textTransform: "none" }}>
                          Explore From Here
                        </Button>
                      )}
                      {instanceUrl && (
                        <Button size="small" variant="outlined" onClick={() => window.open(recordUrl(instanceUrl, selected.objectApiName, selected.recordId), "_blank", "noopener")} sx={{ textTransform: "none" }}>
                          Open in Salesforce
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                ) : (
                  <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Select a record to see its details.</Typography>
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
