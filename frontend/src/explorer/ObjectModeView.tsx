import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link, Stack, Typography } from "@mui/material";
import { AnchorSearch } from "./AnchorSearch";
import { ConnectorDetailDialog } from "./ConnectorDetailDialog";
import { NodeDetailView } from "./DetailPanel";
import type { GraphNode, GraphSummary } from "./graphApi";
import { OBJECT_MODE_EDGE_TYPES, type ConnectorField, type ObjectConnector, type ObjectRef } from "./objectRelationshipView";
import { ReadyToMap } from "./ReadyToMap";
import { RelationshipCanvas } from "./RelationshipCanvas";
import { fieldsSetupUrl, objectOfField, objectSetupUrl } from "./salesforceLinks";
import { errorMessage } from "./nodeStyle";
import { useExplorer } from "./useExplorer";
import { useToast } from "../toast";

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
  const notify = useToast();
  const options = useMemo(() => ({ hops: 2, limit: 500, edgeTypes: [...OBJECT_MODE_EDGE_TYPES] }), []);
  const ex = useExplorer(connectionId, options);
  const { api, state } = ex;
  const objectTypeKey = summary.nodesByType.find((t) => t.kind === "CustomObject")?.typeKey ?? null;
  const [connector, setConnector] = useState<{ connector: ObjectConnector; root: ObjectRef } | null>(null);

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

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => notify("Copied"),
        () => notify("Couldn't copy to the clipboard", "error"),
      );
    },
    [notify],
  );

  const openObject = instanceUrl ? (o: ObjectRef) => window.open(objectSetupUrl(instanceUrl, o.fqn), "_blank", "noopener") : undefined;
  const openField = instanceUrl ? (f: ConnectorField) => window.open(fieldsSetupUrl(instanceUrl, objectOfField(f.fieldFqn ?? "")), "_blank", "noopener") : undefined;

  const trail = state.trail.map((key) => ({ key, label: state.nodes[key]?.label ?? "…" }));
  const detailKey = state.selectedKey;
  const detailExpansion = detailKey ? state.expansions[detailKey] : undefined;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap" sx={{ px: { xs: 2, md: 3 }, py: 1.25, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        <AnchorSearch api={api} connectionId={connectionId} typeKey={objectTypeKey ?? ""} label="Choose an object" placeholder="Search objects…" typeLabel="Object" disabled={!objectTypeKey} onPick={ex.focus} />
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
              {rootExpansion?.truncated && (
                <Alert severity="info">This object has more relationships than can be drawn at once, so the most connected ones may be missing. Use Explore From Here on a related object to follow a specific path.</Alert>
              )}
              {rootReady ? (
                <RelationshipCanvas
                  nodes={ex.graph.nodes}
                  edges={ex.graph.edges}
                  centerNodeKey={rootKey}
                  dark={dark}
                  onSelect={ex.select}
                  onExploreFromHere={(key) => {
                    const node = state.nodes[key];
                    if (node) ex.focus(node);
                  }}
                  onConnectorClick={(c, root) => setConnector({ connector: c, root })}
                  onOpenInSalesforce={openObject}
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

            <Box component="aside" sx={{ flex: { md: 1 }, minWidth: { md: 288 }, maxWidth: { md: 380 }, maxHeight: { xs: "45%", md: "none" }, overflowY: "auto", borderLeft: { md: "1px solid" }, borderTop: { xs: "1px solid", md: "none" }, borderColor: "divider", bgcolor: "background.paper" }}>
              {detailKey && (
                <NodeDetailView
                  key={detailKey}
                  api={api}
                  connectionId={connectionId}
                  nodeKey={detailKey}
                  allowExpand={false}
                  expanded={false}
                  loading={false}
                  error={undefined}
                  hasMore={false}
                  truncated={Boolean(detailExpansion?.truncated)}
                  onToggle={() => undefined}
                  onFocus={() => {
                    const node = state.nodes[detailKey];
                    if (node) ex.focus(node);
                  }}
                  onLoadMore={() => undefined}
                  onOpenRelated={(key) =>
                    void api
                      .detail(key)
                      .then((d) => ex.focus(d.node))
                      .catch((e) => notify(errorMessage(e), "error"))
                  }
                  onCopy={copy}
                />
              )}
            </Box>
          </>
        )}
      </Box>

      {connector && <ConnectorDetailDialog connector={connector.connector} root={connector.root} onClose={() => setConnector(null)} onOpenObject={openObject} onOpenField={openField} />}
    </Box>
  );
}
