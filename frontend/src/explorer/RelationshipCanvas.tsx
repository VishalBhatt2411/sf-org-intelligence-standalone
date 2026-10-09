import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, IconButton, MenuItem, Select, Stack, ThemeProvider, ToggleButton, ToggleButtonGroup, Tooltip, Typography, createTheme, useTheme } from "@mui/material";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import FitScreen from "@mui/icons-material/FitScreen";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import OpenInFull from "@mui/icons-material/OpenInFull";
import CloseFullscreen from "@mui/icons-material/CloseFullscreen";
import Add from "@mui/icons-material/Add";
import Remove from "@mui/icons-material/Remove";
import type { GraphEdge, GraphNode } from "./graphApi";
import { buildObjectRelationshipView, filterByVisibility, type ObjectConnector, type ObjectRef, type VisibilityMode } from "./objectRelationshipView";
import { CARD_HEIGHT, CARD_WIDTH, MAX_ZOOM, MIN_ZOOM, SELF_CARD_HEIGHT, SELF_CARD_WIDTH, ZOOM_STEP, clamp, computeDiagram, type LaneEntry } from "./relationshipLayout";
import { buildSvgExport } from "./relationshipExport";
import { relationshipTokens, type RelationshipTokens } from "./relationshipTokens";
import { ObjectGlyph } from "./ObjectGlyph";

// Object analyze mode's directional canvas (port of native oiRelationshipCanvas): objects that reference the
// centre on the left, objects it references on the right, self-relationships below. All geometry comes from
// relationshipLayout; this component only draws it and owns view state (selection, zoom, filter, maximise).

export type RelationshipCanvasProps = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  centerNodeKey: string;
  dark: boolean;
  onSelect: (nodeKey: string) => void;
  onExploreFromHere: (nodeKey: string) => void;
  onConnectorClick: (connector: ObjectConnector, root: ObjectRef) => void;
  // Absent when the connection has no instance URL to open objects against.
  onOpenInSalesforce?: (object: ObjectRef) => void;
  // Objects to emphasise (the Intelligence Panel's "Highlight on Graph"); connectors to other objects dim.
  highlightKeys?: ReadonlySet<string>;
};

const ZOOM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "fit", label: "Fit to Screen" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
];

const typeText = (o: { isCustom: boolean }) => (o.isCustom ? "Custom Object" : "Standard Object");

const connectorColor = (c: ObjectConnector, t: RelationshipTokens): string => (c.direction === "self" ? t.self : c.primaryRelationshipType === "MasterDetail" ? t.masterDetail : c.direction === "incoming" ? t.incoming : t.outgoing);

export function RelationshipCanvas(props: RelationshipCanvasProps) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMaximized(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);
  // The app theme is light-only, so a dark canvas re-skins the MUI controls (toggle, select, menus) inside it
  // with the canvas tokens instead of leaving dim light-theme controls on a dark panel.
  const baseTheme = useTheme();
  const scoped = useMemo(() => {
    const t = relationshipTokens(props.dark);
    return createTheme(baseTheme, {
      palette: { mode: props.dark ? "dark" : "light", text: { primary: t.text, secondary: t.muted }, background: { paper: t.surface, default: t.sunken }, divider: t.border },
    });
  }, [baseTheme, props.dark]);
  // Keyed by centre so a new centre resets selection, show-more and zoom; maximise survives because it lives here.
  return (
    <ThemeProvider theme={scoped}>
      <Box sx={maximized ? { position: "fixed", inset: 0, zIndex: (th) => th.zIndex.modal, bgcolor: "background.default", p: 2, display: "flex" } : { display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
        <Inner key={props.centerNodeKey} {...props} maximized={maximized} onToggleMaximize={() => setMaximized((m) => !m)} />
      </Box>
    </ThemeProvider>
  );
}

function Inner({ nodes, edges, centerNodeKey, dark, onSelect, onExploreFromHere, onConnectorClick, onOpenInSalesforce, highlightKeys, maximized, onToggleMaximize }: RelationshipCanvasProps & { maximized: boolean; onToggleMaximize: () => void }) {
  const t = useMemo(() => relationshipTokens(dark), [dark]);
  const view = useMemo(() => buildObjectRelationshipView(nodes, edges, centerNodeKey), [nodes, edges, centerNodeKey]);
  const [mode, setMode] = useState<VisibilityMode>("business");
  const [showAllIncoming, setShowAllIncoming] = useState(false);
  const [showAllOutgoing, setShowAllOutgoing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState("fit");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const incoming = useMemo(() => filterByVisibility(view.incomingRelationships, mode), [view, mode]);
  const outgoing = useMemo(() => filterByVisibility(view.outgoingRelationships, mode), [view, mode]);
  const self = useMemo(() => filterByVisibility(view.selfRelationships, mode), [view, mode]);
  const diagram = useMemo(() => computeDiagram({ incoming, outgoing, self, showAllIncoming, showAllOutgoing, selectedConnectorKey: selectedKey }), [incoming, outgoing, self, showAllIncoming, showAllOutgoing, selectedKey]);

  const root = view.rootObject;

  const fit = useCallback(() => {
    const el = wrapperRef.current;
    if (!el || el.clientWidth === 0) return;
    setZoom(clamp(Math.min(el.clientWidth / diagram.canvasWidth, el.clientHeight / diagram.canvasHeight), MIN_ZOOM, MAX_ZOOM));
    setZoomMode("fit");
  }, [diagram.canvasWidth, diagram.canvasHeight]);

  // First paint fits the diagram to the pane; after that zoom is the user's until they ask to fit again.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Maximise changes the pane size, so a fitted view re-fits.
  useEffect(() => {
    if (zoomMode === "fit") fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maximized]);

  const setZoomTo = (z: number) => {
    setZoom(clamp(Math.round(z * 100) / 100, MIN_ZOOM, MAX_ZOOM));
    setZoomMode("custom");
  };

  const exportSvg = () => {
    if (!root) return;
    const blob = new Blob([buildSvgExport(diagram, root.label, typeText(root), t)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${root.fqn}-relationships.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const selectEntry = (e: LaneEntry) => {
    setSelectedKey(e.connector.connectorKey);
    onSelect(e.connector.counterpartObject.nodeKey);
  };

  if (!root) return null;

  const laneTitle = (eyebrow: string, title: string, tip: string, align: "left" | "right") => (
    <Box sx={{ flex: 1, textAlign: align }}>
      <Stack direction="row" alignItems="center" justifyContent={align === "right" ? "flex-end" : "flex-start"} spacing={0.5}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: t.accent }}>{eyebrow}</Typography>
        <Tooltip title={tip} arrow>
          <InfoOutlined sx={{ fontSize: 14, color: t.muted }} aria-label={tip} />
        </Tooltip>
      </Stack>
      <Typography sx={{ fontSize: 12, color: t.muted }}>{title}</Typography>
    </Box>
  );

  const emptyMessage = (lane: "incoming" | "outgoing") => {
    const hiddenByFilter = mode === "business" && (lane === "incoming" ? view.incomingRelationships : view.outgoingRelationships).length > 0;
    if (hiddenByFilter) {
      return (
        <Box>
          <Typography sx={{ fontSize: 13, color: t.good, fontWeight: 600 }}>✓ No business relationships {lane === "outgoing" ? `from ${root.label}` : `to ${root.label}`}.</Typography>
          <Button size="small" onClick={() => setMode("all")} sx={{ mt: 0.5, textTransform: "none", px: 0 }}>
            Show system relationships
          </Button>
        </Box>
      );
    }
    return <Typography sx={{ fontSize: 13, color: t.muted }}>{lane === "incoming" ? "No objects reference this object." : "This object references no other objects."}</Typography>;
  };

  const laneEntries = (entries: LaneEntry[]) =>
    entries.map((e) => {
      const c = e.connector;
      const color = connectorColor(c, t);
      const active = selectedKey === c.connectorKey || hoveredKey === c.connectorKey;
      const lit = highlightKeys?.has(c.counterpartObject.nodeKey) ?? false;
      const dimmed = Boolean(highlightKeys) && !lit;
      const cardSelected = selectedKey === c.connectorKey || lit;
      return (
        <g key={e.rowKey} opacity={dimmed ? 0.35 : 1} onMouseEnter={() => setHoveredKey(c.connectorKey)} onMouseLeave={() => setHoveredKey(null)}>
          <path
            d={e.path}
            fill="none"
            stroke={color}
            strokeWidth={active ? 3.5 : c.primaryRelationshipType === "MasterDetail" ? 3 : 1.5}
            strokeDasharray={c.isSystemRelationship ? "5 4" : undefined}
            strokeLinecap="round"
            style={{ filter: active ? `drop-shadow(0 0 3px ${color}88)` : undefined }}
          />
          {/* Wider invisible stroke so a thin line is easy to hit. */}
          <path d={e.path} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: "pointer" }} onClick={() => onConnectorClick(c, root)} />
          <foreignObject x={e.labelX} y={e.labelY} width={240} height={28} style={{ overflow: "visible", pointerEvents: "none" }}>
            <Box
              onClick={() => onConnectorClick(c, root)}
              sx={{ pointerEvents: "auto", cursor: "pointer", display: "inline-block", maxWidth: 236, px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", border: "1px solid", borderColor: active ? color : "transparent", bgcolor: t.surface }}
            >
              {e.label}
            </Box>
          </foreignObject>
          <foreignObject x={e.x} y={e.y} width={e.width} height={e.height} style={{ overflow: "visible" }}>
            <Box
              role="button"
              tabIndex={0}
              aria-pressed={cardSelected}
              aria-label={`${c.counterpartObject.label}, ${typeText(c.counterpartObject)}`}
              onClick={() => selectEntry(e)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  selectEntry(e);
                }
              }}
              sx={{ width: CARD_WIDTH, height: CARD_HEIGHT, boxSizing: "border-box", bgcolor: t.surface, border: "1px solid", borderColor: cardSelected ? t.accent : t.border, borderRadius: 2, boxShadow: cardSelected ? `0 0 0 2px ${t.accentWash}` : "0 2px 8px rgba(15,23,42,.10)", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", "&:hover": { boxShadow: "0 4px 16px rgba(15,23,42,.14)" }, "&:focus-visible": { outline: `2px solid ${t.accent}` } }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 1.25, pt: 1 }}>
                <ObjectGlyph label={c.counterpartObject.label} custom={c.counterpartObject.isCustom} size={32} dark={dark} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: t.text, lineHeight: 1.25 }}>
                    {c.counterpartObject.label}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: 11, color: t.muted }}>
                    {typeText(c.counterpartObject)}
                  </Typography>
                </Box>
                {onOpenInSalesforce && (
                  <Box
                    component="span"
                    role="link"
                    title="Open in Salesforce"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenInSalesforce(c.counterpartObject);
                    }}
                    sx={{ fontSize: 11, color: t.accent, whiteSpace: "nowrap", "&:hover": { textDecoration: "underline" } }}
                  >
                    ↗ Open
                  </Box>
                )}
              </Stack>
              <Box sx={{ borderTop: "1px solid", borderColor: t.border, px: 1.25, py: 0.4, fontSize: 11, color, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.label}</Box>
            </Box>
          </foreignObject>
        </g>
      );
    });

  const showMoreTile = (m: NonNullable<typeof diagram.incomingShowMore>, onClick: () => void) => (
    <foreignObject x={m.x} y={m.y} width={m.width} height={CARD_HEIGHT}>
      <Box component="button" onClick={onClick} sx={{ width: "100%", height: CARD_HEIGHT, border: `1.5px dashed ${t.accent}`, borderRadius: 2, bgcolor: "transparent", color: t.accent, fontWeight: 600, fontSize: 13, cursor: "pointer", font: "inherit", "&:hover": { bgcolor: t.accentWash } }}>
        {m.label}
      </Box>
    </foreignObject>
  );

  const c = diagram.centerBox;
  const legend: Array<{ label: string; color: string; width: number; dashed?: boolean }> = [
    { label: "Lookup", color: t.outgoing, width: 1.5 },
    { label: "Master-Detail", color: t.masterDetail, width: 3 },
    { label: "Self Relationship", color: t.self, width: 1.5 },
    { label: "System Relationship", color: t.muted, width: 1.5, dashed: true },
  ];
  const zoomSelectValue = zoomMode === "fit" ? "fit" : ZOOM_OPTIONS.some((o) => Number(o.value) === zoom) ? String(zoom) : "custom";

  return (
    <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", bgcolor: t.sunken, border: "1px solid", borderColor: t.border, borderRadius: maximized ? 2 : 3, overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ px: 1.5, py: 1, bgcolor: t.surface, borderBottom: "1px solid", borderColor: t.border }}>
        <Chip
          size="small"
          label={
            <span>
              <strong>Analyzing Object:</strong> {root.label} · {root.isCustom ? "Custom" : "Standard"}
            </span>
          }
          sx={{ bgcolor: t.accentWash, color: t.accent }}
        />
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography sx={{ fontSize: 12, color: t.muted }}>Relationship View</Typography>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v: VisibilityMode | null) => v && setMode(v)} aria-label="Relationship view">
            <ToggleButton value="business" sx={{ textTransform: "none", px: 1.25 }}>
              Business
            </ToggleButton>
            <ToggleButton value="system" sx={{ textTransform: "none", px: 1.25 }}>
              System
            </ToggleButton>
            <ToggleButton value="all" sx={{ textTransform: "none", px: 1.25 }}>
              All
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Select
          size="small"
          value={zoomSelectValue}
          renderValue={(v) => (v === "custom" ? `${Math.round(zoom * 100)}%` : (ZOOM_OPTIONS.find((o) => o.value === v)?.label ?? ""))}
          onChange={(e) => (e.target.value === "fit" ? fit() : setZoomTo(Number(e.target.value)))}
          inputProps={{ "aria-label": "View Options" }}
          sx={{ minWidth: 130, fontSize: 13 }}
        >
          {ZOOM_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
          <MenuItem value="custom" sx={{ display: "none" }} />
        </Select>
        <Tooltip title="Fit to screen">
          <IconButton size="small" onClick={fit} aria-label="Fit to screen">
            <FitScreen fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Export as SVG">
          <IconButton size="small" onClick={exportSvg} aria-label="Export as SVG">
            <FileDownloadOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" sx={{ px: 2, py: 1, bgcolor: t.surface, borderBottom: "1px solid", borderColor: t.border }}>
        {laneTitle("OBJECTS REFERENCING THIS OBJECT", "Incoming Relationships", "Objects with a Lookup or Master-Detail field pointing to this object", "left")}
        {laneTitle("OBJECTS THIS OBJECT REFERENCES", "Outgoing Relationships", "Fields on this object that look up or master-detail to another object", "right")}
      </Stack>

      <Box ref={wrapperRef} sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto" }}>
        <IconButton
          size="small"
          onClick={onToggleMaximize}
          aria-label={maximized ? "Exit full screen" : "Maximize"}
          sx={{ position: "sticky", float: "right", top: 8, right: 8, zIndex: 2, bgcolor: t.surface, border: "1px solid", borderColor: t.border, "&:hover": { bgcolor: t.surface } }}
        >
          {maximized ? <CloseFullscreen fontSize="small" /> : <OpenInFull fontSize="small" />}
        </IconButton>
        <svg width={diagram.canvasWidth * zoom} height={diagram.canvasHeight * zoom} viewBox={`0 0 ${diagram.canvasWidth} ${diagram.canvasHeight}`} role="group" aria-label={`Relationships of ${root.label}`} style={{ display: "block", margin: "0 auto" }}>
          {laneEntries(diagram.incoming)}
          {laneEntries(diagram.outgoing)}
          {incoming.length === 0 && (
            <foreignObject x={24} y={c.y + c.height / 2 - 40} width={CARD_WIDTH} height={80}>
              {emptyMessage("incoming")}
            </foreignObject>
          )}
          {outgoing.length === 0 && (
            <foreignObject x={diagram.canvasWidth - 24 - CARD_WIDTH} y={c.y + c.height / 2 - 40} width={CARD_WIDTH} height={80}>
              {emptyMessage("outgoing")}
            </foreignObject>
          )}
          {diagram.incomingShowMore && showMoreTile(diagram.incomingShowMore, () => setShowAllIncoming(true))}
          {diagram.outgoingShowMore && showMoreTile(diagram.outgoingShowMore, () => setShowAllOutgoing(true))}

          {diagram.self.map((s) => {
            const active = selectedKey === s.connector.connectorKey || hoveredKey === s.connector.connectorKey;
            return (
              <g key={s.rowKey} onMouseEnter={() => setHoveredKey(s.connector.connectorKey)} onMouseLeave={() => setHoveredKey(null)}>
                <path d={s.downPath} fill="none" stroke={t.self} strokeWidth={active ? 3.5 : 1.5} />
                <path d={s.upPath} fill="none" stroke={t.self} strokeWidth={active ? 3.5 : 1.5} />
                <foreignObject x={s.captionX} y={s.captionY} width={s.captionWidth} height={40}>
                  <Typography sx={{ fontSize: 11, textAlign: "center", color: t.muted }}>This object references itself</Typography>
                </foreignObject>
                <foreignObject x={s.cardX} y={s.cardY} width={SELF_CARD_WIDTH} height={SELF_CARD_HEIGHT}>
                  <Box sx={{ width: SELF_CARD_WIDTH, height: SELF_CARD_HEIGHT, boxSizing: "border-box", border: `1.5px dashed ${t.self}`, borderRadius: 2, bgcolor: t.sunken, display: "flex", flexDirection: "column", justifyContent: "center", px: 1.5 }}>
                    <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                      {root.label} (Self)
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 11, color: t.muted }}>
                      {typeText(root)}
                    </Typography>
                  </Box>
                </foreignObject>
                <foreignObject x={s.labelX} y={s.labelY} width={s.labelWidth} height={28}>
                  <Box onClick={() => onConnectorClick(s.connector, root)} sx={{ cursor: "pointer", textAlign: "center", fontSize: 12, fontWeight: 600, color: t.self, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.label}
                  </Box>
                </foreignObject>
              </g>
            );
          })}

          <foreignObject x={c.x} y={c.y} width={c.width} height={c.height} style={{ overflow: "visible" }}>
            <Box sx={{ width: c.width, height: c.height, boxSizing: "border-box", bgcolor: t.surface, border: `2px solid ${t.object}`, borderRadius: 2.5, boxShadow: `0 0 0 4px ${t.object}22, 0 4px 16px rgba(15,23,42,.14)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0.75, px: 1.5, textAlign: "center" }}>
              <ObjectGlyph label={root.label} custom={root.isCustom} size={44} dark={dark} />
              <Typography sx={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: t.text, wordBreak: "break-word" }}>{root.label.toUpperCase()}</Typography>
              <Typography sx={{ fontSize: 11, color: t.muted }}>{typeText(root)}</Typography>
              <Box sx={{ mt: 0.5, px: 1.25, py: 0.25, borderRadius: 999, bgcolor: `${t.object}22`, color: t.object, fontSize: 11, fontWeight: 700 }}>● Analyzing</Box>
            </Box>
          </foreignObject>

          {diagram.explore && (
            <foreignObject x={diagram.explore.x} y={diagram.explore.y} width={diagram.explore.width} height={diagram.explore.height}>
              <Box component="button" onClick={() => onExploreFromHere(diagram.explore!.nodeKey)} sx={{ width: "100%", height: "100%", border: 0, borderRadius: 1, bgcolor: t.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit", "&:hover": { filter: "brightness(1.1)" } }}>
                Explore From Here →
              </Box>
            </foreignObject>
          )}
        </svg>
      </Box>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 0.75, bgcolor: t.surface, borderTop: "1px solid", borderColor: t.border }}>
        <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
          {legend.map((l) => (
            <Stack key={l.label} direction="row" spacing={0.75} alignItems="center">
              <svg width="26" height="8" aria-hidden>
                <line x1="0" y1="4" x2="26" y2="4" stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dashed ? "5 4" : undefined} />
              </svg>
              <Typography sx={{ fontSize: 11, color: t.muted }}>{l.label}</Typography>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <IconButton size="small" aria-label="Zoom out" onClick={() => setZoomTo(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
            <Remove fontSize="small" />
          </IconButton>
          <Button size="small" onClick={() => setZoomTo(1)} aria-label="Reset zoom" sx={{ minWidth: 48, fontSize: 12, textTransform: "none" }}>
            {Math.round(zoom * 100)}%
          </Button>
          <IconButton size="small" aria-label="Zoom in" onClick={() => setZoomTo(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
            <Add fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    </Box>
  );
}
