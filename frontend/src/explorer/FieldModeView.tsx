import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link, Skeleton, Stack, Typography } from "@mui/material";
import { AnchorSearch } from "./AnchorSearch";
import { clusterHubs } from "./clustering";
import { ownFieldOptions } from "./fieldOptions";
import { FieldPicker } from "./FieldPicker";
import { GraphCanvas } from "./GraphCanvas";
import type { GraphNode, GraphSummary } from "./graphApi";
import { IntelligencePanel } from "./IntelligencePanel";
import { errorMessage } from "./nodeStyle";
import { HAS_FIELD_EDGE, OBJECT_TYPE_KEY } from "./objectRelationshipView";
import { ReadyToMap } from "./ReadyToMap";
import { useExplorer } from "./useExplorer";
import { useToast } from "../toast";

type FieldModeViewProps = {
  connectionId: string;
  summary: GraphSummary;
  dark: boolean;
  // A node handed in from outside (an Org Health finding) to focus on arrival; reported back once handled.
  pendingNode: GraphNode | null;
  onPendingHandled: () => void;
};

const ribbon = { display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 0.75, borderRadius: 2, border: "1px solid", borderColor: "divider", bgcolor: "action.hover" } as const;

// Field analyze mode (port of native oiGraphExplorer's Field lens): two steps, pick an object, then one of its
// fields. The field becomes the centre of a radial graph that grows one hop at a time, beside the same
// Intelligence panel Object mode uses.
export function FieldModeView({ connectionId, summary, dark, pendingNode, onPendingHandled }: FieldModeViewProps) {
  const notify = useToast();
  const ex = useExplorer(connectionId);
  const { api, state } = ex;
  const objectTypeKey = summary.nodesByType.find((t) => t.kind === "CustomObject")?.typeKey ?? OBJECT_TYPE_KEY;
  const [pickedObject, setPickedObject] = useState<GraphNode | null>(null);
  const [openClusters, setOpenClusters] = useState<ReadonlySet<string>>(new Set());

  // Step 1 result: the object's own relationship fields, one hop over HAS_FIELD.
  const fieldsQuery = useQuery({
    queryKey: ["graph", "fieldOptions", connectionId, pickedObject?.nodeKey],
    queryFn: async () => ownFieldOptions(pickedObject!.nodeKey, await api.expand(pickedObject!.nodeKey, { hops: 1, limit: 500, edgeTypes: [HAS_FIELD_EDGE] })),
    enabled: Boolean(pickedObject),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!pendingNode) return;
    ex.focus(pendingNode);
    onPendingHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNode]);

  // A new focus starts a clean picture.
  useEffect(() => setOpenClusters(new Set()), [state.rootKey, connectionId]);

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => notify("Copied"),
        () => notify("Couldn't copy to the clipboard", "error"),
      );
    },
    [notify],
  );

  const rootKey = state.rootKey;
  const selectedKey = state.selectedKey;
  const rootNode = rootKey ? state.nodes[rootKey] : undefined;
  const rootReady = rootKey ? ex.expandedKeys.has(rootKey) : false;
  const rootError = rootKey ? ex.errors[rootKey] : undefined;

  const rendered = useMemo(() => {
    if (!rootKey) return null;
    const pinned = new Set<string>([rootKey, ...(selectedKey ? [selectedKey] : []), ...ex.expandedKeys]);
    return clusterHubs(ex.graph, { pinned, openClusters });
  }, [ex.graph, rootKey, selectedKey, ex.expandedKeys, openClusters]);

  // Related components may be off screen, so fall back to focusing on them.
  const selectOrFocus = async (key: string) => {
    if (ex.graph.nodes.some((n) => n.nodeKey === key)) return ex.select(key);
    try {
      ex.focus((await api.detail(key)).node);
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const changeObject = () => {
    setPickedObject(null);
    ex.clear();
  };

  const trail = state.trail.map((key) => ({ key, label: state.nodes[key]?.label ?? "…" }));
  const detailKey = selectedKey && !selectedKey.startsWith("cluster:") ? selectedKey : null;
  const expansion = rootKey ? state.expansions[rootKey] : undefined;
  const emptyRoot = rendered?.nodes.length === 1 && rootReady && ex.loading.size === 0;
  const fitToken = ["field", rootKey, rootReady ? "open" : "closed"].join("|");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap" sx={{ px: { xs: 2, md: 3 }, py: 1.25, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        {pickedObject ? (
          <>
            <Box sx={ribbon} data-id="field-mode-object-banner">
              <Box sx={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: "primary.contrastText", bgcolor: "primary.main" }}>1</Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.2 }}>
                  Object selected
                </Typography>
                <Typography variant="body2" fontWeight={700} noWrap>
                  {pickedObject.label}
                </Typography>
              </Box>
              <Button size="small" onClick={changeObject} sx={{ textTransform: "none" }} data-id="field-mode-change-object">
                Change object
              </Button>
            </Box>
            {fieldsQuery.isLoading ? (
              <Skeleton variant="rounded" width={320} height={36} aria-label="Loading fields" />
            ) : fieldsQuery.isError ? (
              <Alert severity="error" sx={{ py: 0 }}>
                {errorMessage(fieldsQuery.error)}
              </Alert>
            ) : fieldsQuery.data && fieldsQuery.data.length > 0 ? (
              <>
                <FieldPicker options={fieldsQuery.data} onPick={(o) => ex.focus(o.node)} />
                <Typography variant="caption" color="text.secondary" sx={{ flexBasis: "100%" }} data-id="field-mode-hint">
                  Lists lookup and master-detail fields, the fields that connect objects in the graph. The object's detail panel lists every field.
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" data-id="field-mode-no-fields">
                This object has no relationship fields in the graph yet.
              </Typography>
            )}
          </>
        ) : (
          <AnchorSearch api={api} connectionId={connectionId} typeKey={objectTypeKey} label="Choose an object" placeholder="Search objects…" typeLabel="Object" onPick={setPickedObject} />
        )}
        {rootKey && (
          <Breadcrumbs maxItems={5} separator="›" sx={{ flexGrow: 1, minWidth: 0, fontSize: 13 }}>
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
        )}
      </Stack>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0, flexDirection: { xs: "column", md: "row" } }}>
        {!rootKey ? (
          <ReadyToMap lens="field" />
        ) : (
          <>
            <Box sx={{ position: "relative", flex: 3, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", p: { xs: 1, md: 2 }, gap: 1 }}>
              {rootError && (
                <Alert severity="error" action={<Button size="small" color="inherit" onClick={() => void ex.expand(rootKey)}>Retry</Button>}>
                  <strong>Couldn't load that part of the graph.</strong> {rootError}
                </Alert>
              )}
              {expansion?.truncated && <Alert severity="info">This field has more relationships than can be drawn at once, so the most connected ones may be missing.</Alert>}
              {rendered ? (
                <GraphCanvas
                  nodes={rendered.nodes}
                  edges={rendered.edges}
                  rootKey={rootKey}
                  layout="radial"
                  selectedKey={selectedKey}
                  expandedKeys={ex.expandedKeys}
                  loadingKeys={ex.loading}
                  allowExpand
                  dark={dark}
                  fitToken={fitToken}
                  onSelect={ex.select}
                  onToggle={ex.toggle}
                  onFocus={(key) => {
                    const node = state.nodes[key];
                    if (node) ex.focus(node);
                  }}
                  onOpenCluster={(id) => setOpenClusters((s) => new Set(s).add(id))}
                  onCopy={copy}
                  onBackgroundClick={() => ex.select(rootKey)}
                />
              ) : (
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CircularProgress />
                </Box>
              )}
              {emptyRoot && (
                <Alert severity="info" sx={{ position: "absolute", top: 12, left: 12, maxWidth: 360 }}>
                  No relationships were found for {rootNode?.label}. It may be unused, or the scan could not read the parts that connect to it.
                </Alert>
              )}
            </Box>

            <IntelligencePanel api={api} connectionId={connectionId} nodeKey={detailKey} view={null} workingNodes={ex.graph.nodes} highlighted={false} onSelectNode={(key) => void selectOrFocus(key)} />
          </>
        )}
      </Box>
    </Box>
  );
}
