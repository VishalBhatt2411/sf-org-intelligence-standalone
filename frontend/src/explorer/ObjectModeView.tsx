import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link, Stack, Typography } from "@mui/material";
import { AnchorSearch } from "./AnchorSearch";
import { ConnectorDetailDialog } from "./ConnectorDetailDialog";
import type { GraphNode, GraphSummary, ImpactResponse } from "./graphApi";
import { CEILING_MESSAGE, atCeiling, findImpactResponse, mergeImpactOverlay } from "./impactOverlay";
import { openSetupFor, type OpenResult } from "./openInSalesforce";
import { IntelligencePanel } from "./IntelligencePanel";
import { buildObjectRelationshipView, OBJECT_MODE_EDGE_TYPES, type ConnectorField, type ObjectConnector, type ObjectRef, type VisibilityMode } from "./objectRelationshipView";
import { ReadyToMap } from "./ReadyToMap";
import { RelationshipCanvas } from "./RelationshipCanvas";
import type { MetadataNodeRef } from "./salesforceLinks";
import { useExplorer } from "./useExplorer";

type ObjectModeViewProps = {
  connectionId: string;
  summary: GraphSummary;
  dark: boolean;
  // Absent until the connection has loaded, or when it has no instance URL; Setup links are then hidden.
  instanceUrl: string | null;
  // A node handed in from outside (an Org Health finding) to centre on arrival; reported back once handled.
  pendingNode: GraphNode | null;
  onPendingHandled: () => void;
};

// Object analyze mode: anchors on one object and shows who references it (left) and what it references
// (right). The two-hop expansion over relationship edges brings in the object, its relationship fields and
// the objects on the far side, which is exactly what the canvas turns into connectors.
export function ObjectModeView({ connectionId, summary, dark, instanceUrl, pendingNode, onPendingHandled }: ObjectModeViewProps) {
  const options = useMemo(() => ({ hops: 2, limit: 500, edgeTypes: [...OBJECT_MODE_EDGE_TYPES] }), []);
  const ex = useExplorer(connectionId, options);
  const { api, state } = ex;
  const objectTypeKey = summary.nodesByType.find((t) => t.kind === "CustomObject")?.typeKey ?? null;
  const [connector, setConnector] = useState<{ connector: ObjectConnector; root: ObjectRef } | null>(null);
  // Object keys the panel's impact result asked the canvas to emphasise; cleared whenever the anchor changes.
  const [highlight, setHighlight] = useState<ReadonlySet<string> | null>(null);
  // The impact subgraph "Highlight on Graph" merged into the canvas (adds objects the two-hop view did not hold).
  const [overlay, setOverlay] = useState<ImpactResponse | null>(null);
  const [ceilingHit, setCeilingHit] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityMode>("business");
  const [openError, setOpenError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    setHighlight(null);
    setOverlay(null);
    setCeilingHit(false);
    setOpenError(null);
  }, [state.rootKey]);
  const working = useMemo(() => mergeImpactOverlay(ex.graph, overlay), [ex.graph, overlay]);

  // "Highlight on Graph" hands over keys only; the impact answer is already in the query cache.
  const onHighlight = (keys: string[] | null) => {
    if (!keys || keys.length === 0) {
      setOverlay(null);
      setHighlight(null);
      setCeilingHit(false);
      return;
    }
    const cached = queryClient.getQueriesData<ImpactResponse>({ queryKey: ["graph", "impact", connectionId, keys[0]] });
    const res = findImpactResponse(cached, keys);
    setOverlay(res);
    setHighlight(new Set(keys));
    if (res && atCeiling(mergeImpactOverlay(ex.graph, res).nodes.length)) setCeilingHit(true);
  };

  // Salesforce links work without the instance URL up front: it is resolved on the first click, and a failure
  // is shown inline rather than a link that silently does nothing.
  const openSetup = useCallback(
    async (node: MetadataNodeRef): Promise<OpenResult> => {
      const result = await openSetupFor(node, { instanceUrl, resolveInstanceUrl: () => api.instanceUrl() });
      setOpenError(result.ok ? null : result.error);
      return result;
    },
    [instanceUrl, api],
  );

  useEffect(() => {
    if (!pendingNode) return;
    ex.focus(pendingNode);
    onPendingHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNode]);

  const rootKey = state.rootKey;
  const rootNode = rootKey ? state.nodes[rootKey] : undefined;
  const rootReady = rootKey ? ex.expandedKeys.has(rootKey) : false;
  const rootError = rootKey ? ex.errors[rootKey] : undefined;
  const rootExpansion = rootKey ? state.expansions[rootKey] : undefined;

  const openObject = (o: ObjectRef) => openSetup({ kind: "CustomObject", fqn: o.fqn, label: o.label });
  const openField = (f: ConnectorField) => openSetup({ kind: "CustomField", fqn: f.fieldFqn ?? "", label: f.fieldApiName ?? undefined });

  const trail = state.trail.map((key) => ({ key, label: state.nodes[key]?.label ?? "…" }));
  const detailKey = state.selectedKey;
  const workingView = useMemo(() => (rootKey ? buildObjectRelationshipView(working.nodes, working.edges, rootKey) : null), [working.nodes, working.edges, rootKey]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap" sx={{ px: { xs: 2, md: 3 }, py: 1.25, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        <AnchorSearch api={api} connectionId={connectionId} typeKey={objectTypeKey ?? ""} label="Choose an object" placeholder="Search objects…" typeLabel="Object" disabled={!objectTypeKey} onPick={ex.focus} anchoredLabel={rootNode?.label ?? null} />
        <Breadcrumbs maxItems={5} separator="›" sx={{ flexGrow: 1, minWidth: 0, fontSize: 13 }}>
          <Link component="button" underline="hover" color="text.secondary" onClick={ex.clear} sx={{ fontSize: 13 }}>
            Objects
          </Link>
          {trail.map((t, i) =>
            i === trail.length - 1 ? (
              <Typography key={t.key} sx={{ fontSize: 13, fontWeight: 500 }}>
                {t.label}
              </Typography>
            ) : (
              <Link key={t.key} component="button" underline="hover" color="text.secondary" onClick={() => ex.trailTo(i)} sx={{ fontSize: 13 }}>
                {t.label}
              </Link>
            ),
          )}
        </Breadcrumbs>
      </Stack>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0, flexDirection: { xs: "column", md: "row" } }}>
        {!rootKey ? (
          <ReadyToMap lens="object" />
        ) : (
          <>
            <Box sx={{ position: "relative", flex: 3, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", p: { xs: 1, md: 2 }, gap: 1 }}>
              {rootError && (
                <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void ex.expand(rootKey)}>Retry</Button>}>
                  <strong>Couldn't load that part of the graph.</strong> {rootError}
                </Alert>
              )}
              {openError && (
                <Alert severity="error" onClose={() => setOpenError(null)}>
                  {openError}
                </Alert>
              )}
              {ceilingHit && (
                <Alert severity="warning" onClose={() => setCeilingHit(false)}>
                  {CEILING_MESSAGE}
                </Alert>
              )}
              {rootExpansion?.truncated && (
                <Alert severity="info">This object has more relationships than can be drawn at once, so the most connected ones may be missing. Use Explore From Here on a related object to follow a specific path.</Alert>
              )}
              {rootReady ? (
                <RelationshipCanvas
                  nodes={working.nodes}
                  edges={working.edges}
                  centerNodeKey={rootKey}
                  dark={dark}
                  onSelect={ex.select}
                  onExploreFromHere={(key) => {
                    const node = state.nodes[key];
                    if (node) ex.focus(node);
                  }}
                  onConnectorClick={(c, root) => setConnector({ connector: c, root })}
                  onOpenInSalesforce={(o) => void openObject(o)}
                  activeConnectorKey={connector?.connector.connectorKey ?? null}
                  onModeChange={setVisibility}
                  highlightKeys={highlight ?? undefined}
                />
              ) : (
                !rootError && (
                  <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5 }}>
                    <CircularProgress size={22} />
                    <Typography color="text.secondary">Mapping {rootNode?.label ?? "object"}…</Typography>
                  </Box>
                )
              )}
            </Box>

            <IntelligencePanel
              api={api}
              connectionId={connectionId}
              nodeKey={detailKey}
              view={rootReady ? workingView : null}
              workingNodes={working.nodes}
              highlighted={highlight !== null}
              onSelectNode={ex.select}
              onHighlight={onHighlight}
              centerNodeKey={rootKey}
              visibilityMode={visibility}
              openSetup={openSetup}
            />
          </>
        )}
      </Box>

      {connector && <ConnectorDetailDialog connector={connector.connector} root={connector.root} onClose={() => setConnector(null)} onOpenObject={openObject} onOpenField={openField} />}
    </Box>
  );
}
