import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, CircularProgress, InputBase, Paper, Typography } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import type { GraphApi, GraphNode } from "./graphApi";
import { initials } from "./relationshipTokens";
import { canSearch, searchKeyDown, type SearchNavState } from "./searchNav";

const DEBOUNCE_MS = 300;
const MAX_ROWS = 50;

type Props = {
  api: GraphApi;
  connectionId: string;
  // Restricts both the browse list and the search to one node type (objects for Object mode, fields for Field mode).
  typeKey: string;
  label: string;
  placeholder: string;
  typeLabel: string;
  disabled?: boolean;
  onPick: (node: GraphNode) => void;
  // Once something is anchored the box collapses into a ribbon with this label and a change button.
  anchoredLabel?: string | null;
};

// Anchor picker (port of native oiSearchBar): focusing the box lists what is available, typing filters that
// list instantly, Enter takes the top suggestion, and the Search button does the same for mouse users. The
// browse list is capped by the server, so for larger orgs a debounced prefix search fills in what the cap hid.
export function AnchorSearch({ api, connectionId, typeKey, label, placeholder, typeLabel, disabled, onPick, anchoredLabel }: Props) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [nav, setNav] = useState<SearchNavState>({ open: false, active: -1 });
  const inputRef = useRef<HTMLInputElement>(null);
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    if (changing) inputRef.current?.focus();
  }, [changing]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const browse = useQuery({ queryKey: ["graph", "browse", connectionId, typeKey], queryFn: () => api.browse(typeKey), enabled: nav.open && !disabled, staleTime: 60_000 });
  const serverSearch = useQuery({
    queryKey: ["graph", "search", connectionId, typeKey, debounced],
    queryFn: () => api.search(debounced, { typeKey }),
    enabled: nav.open && !disabled && canSearch(debounced) && Boolean(browse.data?.truncated),
    staleTime: 30_000,
  });

  const needle = text.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const merged = new Map<string, GraphNode>();
    for (const n of browse.data?.nodes ?? []) merged.set(n.nodeKey, n);
    for (const n of serverSearch.data?.nodes ?? []) merged.set(n.nodeKey, n);
    const all = [...merged.values()];
    const hits = needle ? all.filter((n) => n.label.toLowerCase().includes(needle) || n.fqn.toLowerCase().includes(needle)) : all;
    return hits.sort((a, b) => a.label.localeCompare(b.label)).slice(0, MAX_ROWS);
  }, [browse.data, serverSearch.data, needle]);

  const pick = (node: GraphNode) => {
    setNav({ open: false, active: -1 });
    setText("");
    setDebounced("");
    inputRef.current?.blur();
    setChanging(false);
    onPick(node);
  };

  const commitTop = () => {
    if (suggestions[0]) pick(suggestions[0]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && nav.active < 0) {
      e.preventDefault();
      commitTop();
      return;
    }
    const out = searchKeyDown(nav, e.key, suggestions.length);
    if (out.action || out.state !== nav) e.preventDefault();
    setNav(out.state);
    if (out.action === "select" && out.index !== undefined) pick(suggestions[out.index]);
    if (out.action === "close") inputRef.current?.blur();
  };

  const loading = browse.isFetching || serverSearch.isFetching;
  if (anchoredLabel && !changing) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1.5, pr: 0.5, py: 0.25, borderRadius: 2, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", minWidth: 220, maxWidth: 520 }}>
        <Typography noWrap variant="body2" fontWeight={600} sx={{ flex: 1 }}>
          {anchoredLabel}
        </Typography>
        <Button size="small" disabled={disabled} onClick={() => setChanging(true)} sx={{ textTransform: "none", minWidth: 0, px: 1.5 }}>
          Change {typeLabel.toLowerCase()}
        </Button>
      </Box>
    );
  }
  return (
    <Box sx={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 520 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1.5, pr: 0.5, py: 0.5, borderRadius: 2, bgcolor: "background.paper", border: "1px solid", borderColor: nav.open ? "primary.main" : "divider", opacity: disabled ? 0.6 : 1 }}>
        <SearchRoundedIcon sx={{ fontSize: 18, color: "text.disabled" }} />
        <InputBase
          inputRef={inputRef}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNav({ open: true, active: -1 });
          }}
          onFocus={() => setNav((s) => ({ ...s, open: true }))}
          onBlur={() =>
            setTimeout(() => {
              setNav({ open: false, active: -1 });
              setChanging(false);
            }, 150)
          }
          onKeyDown={onKeyDown}
          inputProps={{ "aria-label": label, role: "combobox", "aria-expanded": nav.open, "aria-controls": "oi-anchor-list", "aria-autocomplete": "list" }}
          sx={{ flexGrow: 1, fontSize: 13 }}
        />
        {loading && <CircularProgress size={14} />}
        <Button size="small" variant="contained" disableElevation disabled={disabled || suggestions.length === 0} onClick={commitTop} sx={{ textTransform: "none", minWidth: 0, px: 1.5 }}>
          Search
        </Button>
      </Box>
      {nav.open && !disabled && (
        <Paper id="oi-anchor-list" role="listbox" sx={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, maxHeight: 360, overflowY: "auto", py: 0.5 }}>
          {browse.isError ? (
            <Typography variant="body2" color="error" sx={{ p: 2 }}>
              Couldn't load the list. Try again.
            </Typography>
          ) : suggestions.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {loading ? "Loading…" : needle ? `No ${typeLabel.toLowerCase()} matches “${text.trim()}”.` : `No ${typeLabel.toLowerCase()}s in the last scan.`}
            </Typography>
          ) : (
            suggestions.map((n, i) => (
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
                <Box sx={{ width: 28, height: 28, borderRadius: 1, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "primary.main", bgcolor: "action.selected" }}>{initials(n.label)}</Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {n.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 11 }}>
                    {n.fqn}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {typeLabel}
                </Typography>
              </Box>
            ))
          )}
        </Paper>
      )}
    </Box>
  );
}
