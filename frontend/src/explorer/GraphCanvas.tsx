import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, ListItemText, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import CenterFocusStrongRoundedIcon from "@mui/icons-material/CenterFocusStrongRounded";
import type { ImpactDirection } from "./graphApi";
import type { RenderEdge, RenderNode } from "./clustering";
import { NODE_H, NODE_W, layoutLanes, layoutRadial, nearestInDirection, type Bounds, type Direction, type LaneSide, type Point } from "./layout";
import { DASH, canvasTokens, clusterStyle, edgeOpacity, humanizeKind, kindStyle, truncate } from "./nodeStyle";

export type CanvasLayout = "lanes" | "radial";

type Props = {
  nodes: RenderNode[];
  edges: RenderEdge[];
  rootKey: string;
  layout: CanvasLayout;
  // Impact views push everything to one side of the root.
  force?: LaneSide;
  selectedKey: string | null;
  expandedKeys: ReadonlySet<string>;
  loadingKeys: ReadonlySet<string>;
  cycleKeys?: ReadonlySet<string>;
  // Impact views are read-only: no expand toggles.
  allowExpand: boolean;
  dark: boolean;
  // Changes when the canvas should re-fit (new focus, new layout, entering or leaving impact).
  fitToken: string;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
  onFocus: (key: string) => void;
  onImpact: (key: string, direction: ImpactDirection) => void;
  onOpenCluster: (id: string) => void;
  onCopy: (text: string) => void;
  onBackgroundClick: () => void;
};

type View = { x: number; y: number; k: number };
const MIN_K = 0.15;
const MAX_K = 2.5;
const MINI_W = 190;
const MINI_H = 120;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

function fitView(bounds: Bounds, width: number, height: number): View {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = clampK(Math.min((width - 80) / w, (height - 80) / h, 1));
  return { k, x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * k, y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * k };
}

// Where a line from `from` to `to` leaves the card around `from`.
function borderPoint(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const scale = Math.min(dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx), dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

export function GraphCanvas(props: Props) {
  const { nodes, edges, rootKey, layout, force, selectedKey, expandedKeys, loadingKeys, cycleKeys, allowExpand, dark, fitToken } = props;
  const tokens = canvasTokens(dark);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [measured, setMeasured] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const { positions, bounds } = useMemo(() => {
    const layoutNodes = nodes.map((n) => ({ key: n.key, ring: n.ring, sort: n.label.toLowerCase() }));
    return layout === "radial" ? layoutRadial(rootKey, layoutNodes, edges) : layoutLanes(rootKey, layoutNodes, edges, force);
  }, [nodes, edges, rootKey, layout, force]);
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setSize({ width: el.clientWidth || 800, height: el.clientHeight || 520 });
      setMeasured(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => setView(fitView(bounds, size.width, size.height)), [bounds, size.width, size.height]);

  // Re-fit only when the picture changes meaning, not on every expand, so the user keeps their place.
  const fittedFor = useRef("");
  useEffect(() => {
    if (!measured || fittedFor.current === fitToken || positions.size === 0) return;
    fittedFor.current = fitToken;
    fit();
  }, [fitToken, positions, fit, measured]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = clampK(v.k * factor);
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  }, []);

  // Wheel zoom needs a non-passive listener so the page does not scroll underneath.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const reveal = useCallback(
    (key: string) => {
      const p = positions.get(key);
      if (!p) return;
      setView((v) => {
        const sx = p.x * v.k + v.x;
        const sy = p.y * v.k + v.y;
        const margin = 60;
        const inside = sx > margin && sx < size.width - margin && sy > margin && sy < size.height - margin;
        return inside ? v : { ...v, x: size.width / 2 - p.x * v.k, y: size.height / 2 - p.y * v.k };
      });
    },
    [positions, size.width, size.height],
  );

  const moveCursor = useCallback(
    (key: string) => {
      setCursor(key);
      reveal(key);
      if (byKey.get(key)?.kind === "node") props.onSelect(key);
    },
    [byKey, reveal, props],
  );

  const activate = (key: string) => {
    const n = byKey.get(key);
    if (!n) return;
    setCursor(key);
    if (n.kind === "cluster") props.onOpenCluster(key);
    else props.onSelect(key);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = cursor && positions.has(cursor) ? cursor : (selectedKey && positions.has(selectedKey) ? selectedKey : rootKey);
    const arrow: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (arrow[e.key]) {
      e.preventDefault();
      const next = nearestInDirection(positions, current, arrow[e.key]);
      if (next) moveCursor(next);
      return;
    }
    const n = byKey.get(current);
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (n?.kind === "cluster") props.onOpenCluster(current);
        else if (n && allowExpand) props.onToggle(current);
        break;
      case "f":
        if (n?.kind === "node") props.onFocus(current);
        break;
      case "+":
      case "=":
        zoomAt(1.2, size.width / 2, size.height / 2);
        break;
      case "-":
        zoomAt(1 / 1.2, size.width / 2, size.height / 2);
        break;
      case "0":
        fit();
        break;
      case "Escape":
        setMenu(null);
        break;
      case "ContextMenu":
      case "F10":
        if (e.key === "ContextMenu" || e.shiftKey) {
          e.preventDefault();
          const p = positions.get(current);
          const rect = containerRef.current?.getBoundingClientRect();
          if (p && rect) setMenu({ key: current, x: rect.left + p.x * view.k + view.x, y: rect.top + p.y * view.k + view.y });
        }
        break;
    }
  };

  const selectedEdgeKeys = useMemo(() => {
    const focus = hover ?? selectedKey;
    const set = new Set<string>();
    if (focus) for (const e of edges) if (e.source === focus || e.target === focus) set.add(e.key);
    return set;
  }, [edges, hover, selectedKey]);

  // Pan by dragging the background; a drag that never moved counts as a click that clears the selection.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("[data-card]")) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) props.onBackgroundClick();
    drag.current = null;
  };

  const menuNode = menu ? byKey.get(menu.key) : undefined;
  const closeMenu = () => setMenu(null);
  const run = (fn: () => void) => () => {
    closeMenu();
    fn();
  };

  // Mini-map: the whole layout scaled into a corner, with the visible window outlined.
  const mini = useMemo(() => {
    const pad = 40;
    const w = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
    const h = Math.max(1, bounds.maxY - bounds.minY + pad * 2);
    const scale = Math.min(MINI_W / w, MINI_H / h);
    return { scale, ox: bounds.minX - pad - (MINI_W / scale - w) / 2, oy: bounds.minY - pad - (MINI_H / scale - h) / 2 };
  }, [bounds]);
  const viewport = {
    x: (-view.x / view.k - mini.ox) * mini.scale,
    y: (-view.y / view.k - mini.oy) * mini.scale,
    w: (size.width / view.k) * mini.scale,
    h: (size.height / view.k) * mini.scale,
  };
  const onMiniClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / mini.scale + mini.ox;
    const wy = (e.clientY - rect.top) / mini.scale + mini.oy;
    setView((v) => ({ ...v, x: size.width / 2 - wx * v.k, y: size.height / 2 - wy * v.k }));
  };

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="Metadata graph. Arrow keys move between nodes, Enter expands or collapses, F focuses, plus and minus zoom, 0 fits the view."
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      sx={{ position: "relative", flexGrow: 1, minHeight: 0, overflow: "hidden", bgcolor: tokens.background, outline: "none", touchAction: "none", cursor: drag.current?.moved ? "grabbing" : "grab", "&:focus-visible": { boxShadow: `inset 0 0 0 2px ${tokens.selection}` } }}
    >
      <svg width={size.width} height={size.height} style={{ display: "block" }}>
        <defs>
          <pattern id="oi-grid" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill={tokens.grid} />
          </pattern>
          <marker id="oi-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={tokens.edge} />
          </marker>
          <marker id="oi-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={tokens.edgeActive} />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#oi-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const active = selectedEdgeKeys.has(edge.key);
            const p1 = borderPoint(a, b);
            const p2 = borderPoint(b, a);
            const curved = layout === "lanes" && Math.abs(b.x - a.x) > NODE_W / 2;
            const d = curved
              ? `M${p1.x} ${p1.y} C${(p1.x + p2.x) / 2} ${p1.y} ${(p1.x + p2.x) / 2} ${p2.y} ${p2.x} ${p2.y}`
              : `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
            const label = `${humanizeKind(edge.kind)}${edge.viaField ? ` via ${edge.viaField}` : ""}${edge.count > 1 ? ` ×${edge.count}` : ""}`;
            return (
              <g key={edge.key} opacity={active ? 1 : edgeOpacity(edge.confidence)}>
                <path
                  d={d}
                  fill="none"
                  stroke={active ? tokens.edgeActive : tokens.edge}
                  strokeWidth={active ? 2 : 1.25}
                  strokeDasharray={DASH[edge.style]}
                  markerEnd={`url(#${active ? "oi-arrow-active" : "oi-arrow"})`}
                >
                  <title>{`${label} (${edge.confidence})`}</title>
                </path>
                {active && (
                  <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 6} textAnchor="middle" fontSize={11} fill={tokens.edgeActive} stroke={tokens.background} strokeWidth={3} paintOrder="stroke">
                    {truncate(label, 36)}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map((n) => {
            const p = positions.get(n.key);
            if (!p) return null;
            const isCluster = n.kind === "cluster";
            const style = isCluster ? clusterStyle() : kindStyle(n.node?.kind ?? "");
            const selected = n.key === selectedKey;
            const cursorHere = n.key === cursor;
            const expanded = expandedKeys.has(n.key);
            const busy = loadingKeys.has(n.key);
            const inCycle = cycleKeys?.has(n.key) ?? false;
            const outline = inCycle ? tokens.warning : selected ? tokens.selection : cursorHere ? tokens.edgeActive : tokens.cardBorder;
            const sub = isCluster ? (n.hint ? `of ${n.hint}` : n.kindLabel) : n.kindLabel;
            return (
              <g
                key={n.key}
                data-card
                transform={`translate(${p.x - NODE_W / 2} ${p.y - NODE_H / 2})`}
                style={{ cursor: "pointer" }}
                onPointerEnter={() => setHover(n.key)}
                onPointerLeave={() => setHover(null)}
                onClick={() => activate(n.key)}
                onDoubleClick={() => n.kind === "node" && props.onFocus(n.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCursor(n.key);
                  setMenu({ key: n.key, x: e.clientX, y: e.clientY });
                }}
              >
                {isCluster && <rect x={6} y={6} width={NODE_W} height={NODE_H} rx={10} fill={tokens.card} stroke={tokens.cardBorder} />}
                {isCluster && <rect x={3} y={3} width={NODE_W} height={NODE_H} rx={10} fill={tokens.card} stroke={tokens.cardBorder} />}
                <rect width={NODE_W} height={NODE_H} rx={10} fill={tokens.card} stroke={outline} strokeWidth={selected || cursorHere || inCycle ? 2 : 1} strokeDasharray={isCluster ? "4 3" : undefined} />
                <rect x={0} y={0} width={5} height={NODE_H} rx={2} fill={style.color} />
                <circle cx={26} cy={NODE_H / 2} r={13} fill={style.color} opacity={0.14} />
                <text x={26} y={NODE_H / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={style.color}>
                  {style.abbr}
                </text>
                <text x={48} y={19} fontSize={13} fontWeight={500} fill={tokens.text}>
                  {truncate(n.label, allowExpand && !isCluster ? 19 : 23)}
                  <title>{n.node?.fqn ?? n.label}</title>
                </text>
                <text x={48} y={35} fontSize={11} fill={tokens.subtext}>
                  {truncate(sub, 26)}
                </text>
                {allowExpand && !isCluster && (
                  <g
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggle(n.key);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    role="button"
                    aria-label={expanded ? `Collapse ${n.label}` : `Expand ${n.label}`}
                  >
                    <circle cx={NODE_W - 18} cy={NODE_H / 2} r={10} fill={expanded ? style.color : tokens.card} stroke={style.color} />
                    {busy ? (
                      <circle cx={NODE_W - 18} cy={NODE_H / 2} r={5} fill="none" stroke={expanded ? tokens.card : style.color} strokeWidth={2} strokeDasharray="8 6">
                        <animateTransform attributeName="transform" type="rotate" from={`0 ${NODE_W - 18} ${NODE_H / 2}`} to={`360 ${NODE_W - 18} ${NODE_H / 2}`} dur="0.9s" repeatCount="indefinite" />
                      </circle>
                    ) : (
                      <path d={expanded ? `M${NODE_W - 22} ${NODE_H / 2} h8` : `M${NODE_W - 22} ${NODE_H / 2} h8 M${NODE_W - 18} ${NODE_H / 2 - 4} v8`} stroke={expanded ? tokens.card : style.color} strokeWidth={1.75} strokeLinecap="round" />
                    )}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <Box sx={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 0.5, bgcolor: tokens.overlay, border: `1px solid ${tokens.overlayBorder}`, borderRadius: 2, p: 0.25 }}>
        <Tooltip title="Zoom in (+)" placement="left">
          <IconButton size="small" onClick={() => zoomAt(1.25, size.width / 2, size.height / 2)} sx={{ color: tokens.text }} aria-label="Zoom in">
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out (−)" placement="left">
          <IconButton size="small" onClick={() => zoomAt(0.8, size.width / 2, size.height / 2)} sx={{ color: tokens.text }} aria-label="Zoom out">
            <RemoveRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit to screen (0)" placement="left">
          <IconButton size="small" onClick={fit} sx={{ color: tokens.text }} aria-label="Fit to screen">
            <CenterFocusStrongRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Typography variant="caption" sx={{ position: "absolute", left: 12, bottom: 10, color: tokens.subtext, pointerEvents: "none" }}>
        {nodes.length} nodes · {edges.length} links · {Math.round(view.k * 100)}%
      </Typography>

      <Box sx={{ position: "absolute", right: 12, bottom: 12, bgcolor: tokens.overlay, border: `1px solid ${tokens.overlayBorder}`, borderRadius: 2, overflow: "hidden", display: { xs: "none", sm: "block" } }}>
        <svg width={MINI_W} height={MINI_H} onClick={onMiniClick} style={{ display: "block", cursor: "pointer" }} aria-label="Mini-map">
          {nodes.map((n) => {
            const p = positions.get(n.key);
            if (!p) return null;
            const color = n.kind === "cluster" ? clusterStyle().color : kindStyle(n.node?.kind ?? "").color;
            return <rect key={n.key} x={(p.x - NODE_W / 2 - mini.ox) * mini.scale} y={(p.y - NODE_H / 2 - mini.oy) * mini.scale} width={Math.max(2, NODE_W * mini.scale)} height={Math.max(2, NODE_H * mini.scale)} fill={color} opacity={n.key === selectedKey ? 1 : 0.55} />;
          })}
          <rect x={viewport.x} y={viewport.y} width={viewport.w} height={viewport.h} fill={tokens.selection} fillOpacity={0.08} stroke={tokens.selection} strokeWidth={1.5} />
        </svg>
      </Box>

      <Menu open={Boolean(menu)} onClose={closeMenu} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined} MenuListProps={{ dense: true }}>
        {menuNode?.kind === "cluster" && (
          <MenuItem onClick={run(() => props.onOpenCluster(menu!.key))}>
            <ListItemText>Show all {menuNode.members?.length} nodes</ListItemText>
          </MenuItem>
        )}
        {menuNode?.kind === "node" && allowExpand && (
          <MenuItem onClick={run(() => props.onToggle(menu!.key))}>
            <ListItemText>{expandedKeys.has(menu!.key) ? "Collapse" : "Expand"}</ListItemText>
          </MenuItem>
        )}
        {menuNode?.kind === "node" && (
          <MenuItem onClick={run(() => props.onFocus(menu!.key))}>
            <ListItemText>Focus here</ListItemText>
          </MenuItem>
        )}
        {menuNode?.kind === "node" && (
          <MenuItem onClick={run(() => props.onImpact(menu!.key, "downstream"))}>
            <ListItemText>Impact: what depends on this</ListItemText>
          </MenuItem>
        )}
        {menuNode?.kind === "node" && (
          <MenuItem onClick={run(() => props.onImpact(menu!.key, "upstream"))}>
            <ListItemText>Impact: what this depends on</ListItemText>
          </MenuItem>
        )}
        {menuNode?.kind === "node" && (
          <MenuItem onClick={run(() => props.onCopy(menuNode.node!.fqn))}>
            <ListItemText>Copy API name</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
