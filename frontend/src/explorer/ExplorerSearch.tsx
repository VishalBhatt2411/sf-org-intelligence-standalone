import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, CircularProgress, InputBase, Paper, Typography } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import type { GraphApi, GraphNode } from "./graphApi";
import { kindStyle } from "./nodeStyle";
import { canSearch, searchKeyDown, type SearchNavState } from "./searchNav";

const DEBOUNCE_MS = 250;

// Prefix search over the graph's nodes. The server only matches names that start with the query, so the
// hint below says so rather than leaving users wondering why "ice" does not find "Invoice__c".
export function ExplorerSearch({ api, connectionId, disabled, onPick }: { api: GraphApi; connectionId: string; disabled?: boolean; onPick: (node: GraphNode) => void }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [nav, setNav] = useState<SearchNavState>({ open: false, active: -1 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  // "/" jumps to the search box, as long as the user is not already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const enabled = canSearch(debounced) && !disabled;
  const results = useQuery({
    queryKey: ["graph", "search", connectionId, debounced],
    queryFn: () => api.search(debounced),
    enabled,
    staleTime: 30_000,
  });
  const nodes = enabled ? (results.data?.nodes ?? []) : [];

  const pick = (node: GraphNode) => {
    setNav({ open: false, active: -1 });
    setText("");
    setDebounced("");
    onPick(node);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const out = searchKeyDown(nav, e.key, nodes.length);
    if (out.action || out.state !== nav) e.preventDefault();
    setNav(out.state);
    if (out.action === "select" && out.index !== undefined) pick(nodes[out.index]);
    if (out.action === "close") inputRef.current?.blur();
  };

  const showList = nav.open && canSearch(text);
  return (
    <Box sx={{ position: "relative", width: { xs: "100%", sm: 300 } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderRadius: 2, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", opacity: disabled ? 0.6 : 1 }}>
        <SearchRoundedIcon sx={{ fontSize: 18, color: "text.disabled" }} />
        <InputBase
          inputRef={inputRef}
          disabled={disabled}
          placeholder="Search objects, fields, Apex, flows…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNav({ open: true, active: -1 });
          }}
          onFocus={() => setNav((s) => ({ ...s, open: true }))}
          onBlur={() => setTimeout(() => setNav({ open: false, active: -1 }), 150)}
          onKeyDown={onKeyDown}
          inputProps={{ "aria-label": "Search the metadata graph", role: "combobox", "aria-expanded": showList, "aria-controls": "oi-search-list" }}
          sx={{ flexGrow: 1, fontSize: 13 }}
        />
        {results.isFetching && <CircularProgress size={14} />}
        {!text && (
          <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "'JetBrains Mono', monospace" }}>
            /
          </Typography>
        )}
      </Box>
      {showList && (
        <Paper id="oi-search-list" role="listbox" sx={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, maxHeight: 380, overflowY: "auto", py: 0.5 }}>
          {!canSearch(debounced) || results.isFetching ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {canSearch(text) ? "Searching…" : "Type at least 2 characters"}
            </Typography>
          ) : results.isError ? (
            <Typography variant="body2" color="error" sx={{ p: 2 }}>
              Search failed. Try again.
            </Typography>
          ) : nodes.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Nothing starts with “{debounced}”. Search matches the beginning of a name.
            </Typography>
          ) : (
            nodes.map((n, i) => {
              const style = kindStyle(n.kind);
              return (
                <Box
                  key={n.nodeKey}
                  role="option"
                  aria-selected={nav.active === i}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(n);
                  }}
                  onMouseEnter={() => setNav({ open: true, active: i })}
                  sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1.5, py: 0.75, cursor: "pointer", bgcolor: nav.active === i ? "action.hover" : "transparent" }}
                >
                  <Box sx={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, color: style.color, bgcolor: `${style.color}22` }}>{style.abbr}</Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {n.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {n.kindLabel}
                      {n.fqn !== n.label ? ` · ${n.fqn}` : ""}
                    </Typography>
                  </Box>
                </Box>
              );
            })
          )}
          {results.data?.truncated && nodes.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.75, display: "block" }}>
              More matches exist. Keep typing to narrow them.
            </Typography>
          )}
        </Paper>
      )}
    </Box>
  );
}
