import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { graphApi, type GraphNode } from "./graphApi";
import { errorMessage } from "./nodeStyle";
import { initialViewState, isExpanded, knownChecksums, viewReducer, visibleGraph } from "./viewState";

// Owns the Explorer's view state and talks to the graph read API. The server decides what is related to
// what; this hook only asks for one hop at a time and records the answers.
export function useExplorer(connectionId: string) {
  const api = useMemo(() => graphApi(connectionId), [connectionId]);
  const [state, dispatch] = useReducer(viewReducer, initialViewState);
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  // Handlers read the latest state through a ref so they stay stable and never act on a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Bumped whenever the focus changes, so a slow response for the previous focus is dropped.
  const epoch = useRef(0);
  const inFlight = useRef(new Set<string>());

  const setBusy = useCallback((key: string, busy: boolean) => {
    setLoading((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const expand = useCallback(
    async (key: string, more = false) => {
      const current = stateRef.current;
      if (inFlight.current.has(key) || !current.nodes[key]) return;
      if (isExpanded(current, key) && !more) return;
      const cursor = more ? current.expansions[key]?.nextCursor : null;
      if (more && !cursor) return;
      const mine = epoch.current;
      inFlight.current.add(key);
      setBusy(key, true);
      setErrors(({ [key]: _cleared, ...rest }) => rest);
      try {
        const res = await api.expand(key, { cursor, known: knownChecksums(current) });
        if (mine !== epoch.current) return;
        dispatch({ type: "expanded", owner: key, nodes: res.nodes, edges: res.edges, nextCursor: res.nextCursor, truncated: res.truncated, append: more });
      } catch (error) {
        if (mine === epoch.current) setErrors((prev) => ({ ...prev, [key]: errorMessage(error) }));
      } finally {
        inFlight.current.delete(key);
        setBusy(key, false);
      }
    },
    [api, setBusy],
  );

  const focus = useCallback(
    (node: GraphNode) => {
      epoch.current += 1;
      inFlight.current.clear();
      setLoading(new Set());
      setErrors({});
      dispatch({ type: "focus", node });
      stateRef.current = viewReducer(stateRef.current, { type: "focus", node });
      void expand(node.nodeKey);
    },
    [expand],
  );

  const trailTo = useCallback(
    (index: number) => {
      const next = viewReducer(stateRef.current, { type: "trailTo", index });
      if (next === stateRef.current || !next.rootKey) return;
      epoch.current += 1;
      inFlight.current.clear();
      setLoading(new Set());
      setErrors({});
      dispatch({ type: "trailTo", index });
      stateRef.current = next;
      void expand(next.rootKey);
    },
    [expand],
  );

  const collapse = useCallback((key: string) => dispatch({ type: "collapse", owner: key }), []);
  const toggle = useCallback(
    (key: string) => {
      if (isExpanded(stateRef.current, key)) collapse(key);
      else void expand(key);
    },
    [collapse, expand],
  );
  const select = useCallback((key: string | null) => dispatch({ type: "select", key }), []);
  const clear = useCallback(() => {
    epoch.current += 1;
    inFlight.current.clear();
    setLoading(new Set());
    setErrors({});
    dispatch({ type: "clear" });
  }, []);

  // A different org connection invalidates everything held.
  useEffect(() => {
    clear();
  }, [connectionId, clear]);

  const graph = useMemo(() => visibleGraph(state), [state]);
  const expandedKeys = useMemo(() => new Set(Object.keys(state.expansions)), [state.expansions]);

  return { state, graph, expandedKeys, loading, errors, focus, expand, collapse, toggle, select, trailTo, clear, api };
}

export type ExplorerController = ReturnType<typeof useExplorer>;
