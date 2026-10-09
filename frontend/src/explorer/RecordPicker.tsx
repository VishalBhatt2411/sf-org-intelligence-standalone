import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, CircularProgress, InputBase, Paper, Typography } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import type { GraphApi, RecordSummary } from "./graphApi";
import { errorMessage } from "./nodeStyle";
import { initials } from "./relationshipTokens";
import { canSearch, searchKeyDown, type SearchNavState } from "./searchNav";

const DEBOUNCE_MS = 300;

type Props = {
  api: GraphApi;
  connectionId: string;
  objectApiName: string;
  placeholder: string;
  onPick: (record: RecordSummary) => void;
};

// Record picker (port of native oiRecordPicker), scoped to one already-chosen object. Focusing the box lists a
// bounded alphabetical set of that object's records, typing filters it instantly, and a debounced live search
// supersedes the filter with the authoritative match. Records are read live and never stored.
export function RecordPicker({ api, connectionId, objectApiName, placeholder, onPick }: Props) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [nav, setNav] = useState<SearchNavState>({ open: false, active: -1 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const browse = useQuery({ queryKey: ["graph", "records", connectionId, objectApiName, ""], queryFn: () => api.records(objectApiName), enabled: nav.open, staleTime: 60_000, retry: false });
  const serverSearch = useQuery({
    queryKey: ["graph", "records", connectionId, objectApiName, debounced],
    queryFn: () => api.records(objectApiName, debounced),
    enabled: nav.open && canSearch(debounced),
    staleTime: 30_000,
    retry: false,
  });

  const needle = text.trim().toLowerCase();
  const searched = canSearch(debounced) && debounced.toLowerCase() === needle;
  const suggestions = useMemo(() => {
    // The authoritative server result wins once it matches what is typed; until then the browse list is filtered locally.
    if (searched && serverSearch.data) return serverSearch.data;
    const all = browse.data ?? [];
    return needle ? all.filter((r) => r.label.toLowerCase().includes(needle)) : all;
  }, [browse.data, serverSearch.data, needle, searched]);

  const pick = (record: RecordSummary) => {
    setNav({ open: false, active: -1 });
    setText("");
    setDebounced("");
    inputRef.current?.blur();
    onPick(record);
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
  const error = serverSearch.isError && searched ? serverSearch.error : browse.isError ? browse.error : null;
  return (
    <Box sx={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 520 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1.5, pr: 0.5, py: 0.5, borderRadius: 2, bgcolor: "background.paper", border: "1px solid", borderColor: nav.open ? "primary.main" : "divider" }}>
        <SearchRoundedIcon sx={{ fontSize: 18, color: "text.disabled" }} />
        <InputBase
          inputRef={inputRef}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNav({ open: true, active: -1 });
          }}
          onFocus={() => setNav((s) => ({ ...s, open: true }))}
          onBlur={() => setTimeout(() => setNav({ open: false, active: -1 }), 150)}
          onKeyDown={onKeyDown}
          inputProps={{ "aria-label": "Search records", role: "combobox", "aria-expanded": nav.open, "aria-controls": "oi-record-list", "aria-autocomplete": "list" }}
          sx={{ flexGrow: 1, fontSize: 13 }}
        />
        {loading && <CircularProgress size={14} />}
        <Button size="small" variant="contained" disableElevation disabled={suggestions.length === 0} onClick={commitTop} sx={{ textTransform: "none", minWidth: 0, px: 1.5 }}>
          Search
        </Button>
      </Box>
      {nav.open && (
        <Paper id="oi-record-list" role="listbox" sx={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, maxHeight: 360, overflowY: "auto", py: 0.5 }}>
          {error ? (
            <Typography variant="body2" color="error" role="alert" sx={{ p: 2 }}>
              {errorMessage(error)}
            </Typography>
          ) : suggestions.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {loading ? "Loading…" : needle ? `No ${objectApiName} records match “${text.trim()}”.` : `No ${objectApiName} records found.`}
            </Typography>
          ) : (
            suggestions.map((r, i) => (
              <Box
                key={r.recordId}
                role="option"
                aria-selected={nav.active === i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                onMouseEnter={() => setNav({ open: true, active: i })}
                sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1.5, py: 0.75, cursor: "pointer", bgcolor: nav.active === i ? "action.hover" : "transparent" }}
              >
                <Box sx={{ width: 28, height: 28, borderRadius: 1, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "primary.main", bgcolor: "action.selected" }}>{initials(r.label || objectApiName)}</Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {r.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 11 }}>
                    {r.recordId}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {objectApiName}
                </Typography>
              </Box>
            ))
          )}
        </Paper>
      )}
    </Box>
  );
}
