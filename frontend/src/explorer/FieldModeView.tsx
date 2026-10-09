import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, CircularProgress, Link, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { GraphCanvas, type CanvasLayout } from "./GraphCanvas";
import { clusterHubs } from "./clustering";
import { ImpactHeader, NodeDetailView } from "./DetailPanel";
import { AnchorSearch } from "./AnchorSearch";
import { ReadyToMap } from "./ReadyToMap";
import type { GraphNode, GraphSummary, ImpactDirection } from "./graphApi";
import { errorMessage } from "./nodeStyle";
import { useExplorer } from "./useExplorer";
import type { VisibleGraph, VisibleNode } from "./viewState";
import { useToast } from "../toast";

type Impact = { key: string; direction: ImpactDirection; depth: number };

type FieldModeViewProps = {
  connectionId: string;
  summary: GraphSummary;
  dark: boolean;
  // A node handed in from outside (an Org Health finding) to focus on arrival; reported back once handled.
  pendingNode: GraphNode | null;
  onPendingHandled: () => void;
};

// Field analyze mode: anchors on a field (or, from a deep link, any other node) and shows its neighbourhood on
// the radial canvas with the one-hop expansion model.
export function FieldModeView({ connectionId, summary, dark, pendingNode, onPendingHandled }: FieldModeViewProps) {
  const notify = useToast();
  const ex = useExplorer(connectionId);
  const { api, state } = ex;
  const fieldTypeKey = summary.nodesByType.find((t) => t.kind === "CustomField")?.typeKey ?? null;
  const [layoutChoice, setLayoutChoice] = useState<CanvasLayout | null>(null);
  const [openClusters, setOpenClusters] = useState<ReadonlySet<string>>(new Set());
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactSelected, setImpactSelected] = useState<string | null>(null);

  const impactQuery = useQuery({
    queryKey: ["graph", "impact", connectionId, impact?.key, impact?.direction, impact?.depth],
    queryFn: () => api.impact(impact!.key, impact!.direction, impact!.depth),
    enabled: Boolean(impact),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!pendingNode) return;
    ex.focus(pendingNode);
    onPendingHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNode]);

  // A new focus starts a clean picture.
  useEffect(() => {
    setOpenClusters(new Set());
    setLayoutChoice(null);
    setImpact(null);
  }, [state.rootKey, connectionId]);

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => notify("Copied"),
        () => notify("Couldn't copy to the clipboard", "error"),
      );
    },
    [notify],
  );

  const impactGraph = useMemo<VisibleGraph | null>(() => {
    const d = impactQuery.data;
    if (!impact || !d) return null;
    const nodes: VisibleNode[] = [{ ...d.root, ring: 0 }];
    for (const { distance, ...n } of d.nodes) if (n.nodeKey !== d.root.nodeKey) nodes.push({ ...n, ring: Math.max(1, distance) });
    return { nodes, edges: d.edges };
  }, [impact, impactQuery.data]);

  const inImpact = Boolean(impact);
  const rootKey = inImpact ? (impact?.key ?? null) : state.rootKey;
  const source = inImpact ? impactGraph : ex.graph;
  const selectedKey = inImpact ? (impactSelected ?? impact?.key ?? null) : state.selectedKey;

  const rendered = useMemo(() => {
    if (!source || !rootKey) return null;
    const pinned = new Set<string>([rootKey, ...(selectedKey ? [selectedKey] : []), ...(inImpact ? [] : ex.expandedKeys)]);
    return clusterHubs(source, { pinned, openClusters });
  }, [source, rootKey, selectedKey, inImpact, ex.expandedKeys, openClusters]);

  const rootNode = rootKey ? state.nodes[rootKey] : undefined;
  const layout: CanvasLayout = inImpact ? "lanes" : (layoutChoice ?? (rootNode?.kind === "CustomField" ? "radial" : "lanes"));
  const fitToken = [inImpact ? "impact" : "explore", rootKey, layout, ex.expandedKeys.has(rootKey ?? "") ? "open" : "closed", impact?.direction, impact?.depth].join("|");

  const focusKey = (key: string) => {
    const node = state.nodes[key] ?? impactQuery.data?.nodes.find((n) => n.nodeKey === key) ?? (impactQuery.data?.root.nodeKey === key ? impactQuery.data.root : undefined);
    if (!node) return;
    setImpact(null);
    const { distance: _distance, ...plain } = node as GraphNode & { distance?: number };
    ex.focus(plain);
  };

  const startImpact = (key: string, direction: ImpactDirection) => {
    setImpact({ key, direction, depth: 2 });
    setImpactSelected(key);
  };

  // Related components may be off screen, so fall back to focusing on them.
  const openRelated = async (key: string) => {
    if (inImpact) {
      if (impactGraph?.nodes.some((n) => n.nodeKey === key)) return setImpactSelected(key);
    } else if (ex.graph.nodes.some((n) => n.nodeKey === key)) {
      return ex.select(key);
    }
    try {
      const detail = await api.detail(key);
      setImpact(null);
      ex.focus(detail.node);
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const trail = state.trail.map((key) => ({ key, label: state.nodes[key]?.label ?? "…" }));
  const detailKey = selectedKey && !selectedKey.startsWith("cluster:") ? selectedKey : null;
  const expansion = detailKey ? state.expansions[detailKey] : undefined;
  const rootExpanded = rootKey ? ex.expandedKeys.has(rootKey) : false;
  const emptyRoot = !inImpact && rendered?.nodes.length === 1 && rootExpanded && ex.loading.size === 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap" sx={{ px: { xs: 2, md: 3 }, py: 1.25, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        <AnchorSearch
          api={api}
          connectionId={connectionId}
          typeKey={fieldTypeKey ?? ""}
          label="Choose a field"
          placeholder="Search relationship fields…"
          typeLabel="Field"
          disabled={!fieldTypeKey}
          onPick={(node) => {
            setImpact(null);
            ex.focus(node);
          }}
        />
        <Breadcrumbs maxItems={5} separator="›" sx={{ flexGrow: 1, minWidth: 0, fontSize: 13 }}>
          <Link component="button" underline="hover" color="text.secondary" onClick={() => { setImpact(null); ex.clear(); }} sx={{ fontSize: 13 }}>
            Explorer
          </Link>
          {trail.map((t, i) =>
            i === trail.length - 1 && !inImpact ? (
              <Typography key={t.key} sx={{ fontSize: 13, fontWeight: 500 }}>
                {t.label}
              </Typography>
            ) : (
              <Link key={t.key} component="button" underline="hover" color="text.secondary" onClick={() => { setImpact(null); ex.trailTo(i); }} sx={{ fontSize: 13 }}>
                {t.label}
              </Link>
            ),
          )}
          {inImpact && (
            <Typography sx={{ fontSize: 13, fontWeight: 500 }}>Impact</Typography>
          )}
        </Breadcrumbs>
        {!inImpact && state.rootKey && (
          <ToggleButtonGroup exclusive size="small" value={layout} onChange={(_, v) => v && setLayoutChoice(v)} aria-label="Layout">
            <ToggleButton value="lanes" sx={{ textTransform: "none", px: 1.5 }}>
              Lanes
            </ToggleButton>
            <ToggleButton value="radial" sx={{ textTransform: "none", px: 1.5 }}>
              Radial
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0, flexDirection: { xs: "column", md: "row" } }}>
        {!state.rootKey ? (
          <ReadyToMap lens="field" />
        ) : (
          <>
            <Box sx={{ position: "relative", flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {rendered && rootKey ? (
                <GraphCanvas
                  nodes={rendered.nodes}
                  edges={rendered.edges}
                  rootKey={rootKey}
                  layout={layout}
                  force={inImpact ? (impact!.direction === "downstream" ? "right" : "left") : undefined}
                  selectedKey={selectedKey}
                  expandedKeys={ex.expandedKeys}
                  loadingKeys={ex.loading}
                  cycleKeys={inImpact ? new Set(impactQuery.data?.cycleNodeKeys ?? []) : undefined}
                  allowExpand={!inImpact}
                  dark={dark}
                  fitToken={fitToken}
                  onSelect={(key) => (inImpact ? setImpactSelected(key) : ex.select(key))}
                  onToggle={ex.toggle}
                  onFocus={focusKey}
                  onImpact={startImpact}
                  onOpenCluster={(id) => setOpenClusters((s) => new Set(s).add(id))}
                  onCopy={copy}
                  onBackgroundClick={() => (inImpact ? setImpactSelected(impact?.key ?? null) : ex.select(state.rootKey))}
                />
              ) : (
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {impactQuery.isError ? <Alert severity="error">{errorMessage(impactQuery.error)}</Alert> : <CircularProgress />}
                </Box>
              )}
              {emptyRoot && (
                <Alert severity="info" sx={{ position: "absolute", top: 12, left: 12, maxWidth: 360 }}>
                  No relationships were found for {rootNode?.label}. It may be unused, or the scan could not read the parts that connect to it.
                </Alert>
              )}
            </Box>

            <Box component="aside" sx={{ width: { xs: "100%", md: 360 }, flexShrink: 0, maxHeight: { xs: "45%", md: "none" }, overflowY: "auto", borderLeft: { md: "1px solid" }, borderTop: { xs: "1px solid", md: "none" }, borderColor: "divider", bgcolor: "background.paper" }}>
              {impact && (
                <ImpactHeader
                  loading={impactQuery.isLoading}
                  error={impactQuery.isError ? errorMessage(impactQuery.error) : undefined}
                  data={impactQuery.data}
                  direction={impact.direction}
                  depth={impact.depth}
                  rootLabel={impactQuery.data?.root.label ?? state.nodes[impact.key]?.label ?? "…"}
                  onDirection={(direction) => setImpact({ ...impact, direction })}
                  onDepth={(depth) => setImpact({ ...impact, depth })}
                  onBack={() => setImpact(null)}
                />
              )}
              {detailKey && (
                <NodeDetailView
                  key={detailKey}
                  api={api}
                  connectionId={connectionId}
                  nodeKey={detailKey}
                  allowExpand={!inImpact}
                  expanded={ex.expandedKeys.has(detailKey)}
                  loading={ex.loading.has(detailKey)}
                  error={ex.errors[detailKey]}
                  hasMore={Boolean(expansion?.nextCursor)}
                  truncated={Boolean(expansion?.truncated)}
                  onToggle={() => ex.toggle(detailKey)}
                  onFocus={() => focusKey(detailKey)}
                  onImpact={(direction) => startImpact(detailKey, direction)}
                  onLoadMore={() => void ex.expand(detailKey, true)}
                  onOpenRelated={(key) => void openRelated(key)}
                  onCopy={copy}
                />
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
