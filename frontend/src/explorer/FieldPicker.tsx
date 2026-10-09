import { useMemo, useRef, useState } from "react";
import { Box, InputBase, Paper, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { countLabel, matchFields, type FieldOption } from "./fieldOptions";
import { searchKeyDown, type SearchNavState } from "./searchNav";

type Props = {
  options: readonly FieldOption[];
  onPick: (option: FieldOption) => void;
};

// Field picker for Field mode (port of native oiFieldPicker): the object's own fields are already loaded, so
// the search box filters them locally by label or API name. The list opens on focus, shows at most a dozen
// rows with the full count above, and closes on select, Escape or blur.
export function FieldPicker({ options, onPick }: Props) {
  const [text, setText] = useState("");
  const [nav, setNav] = useState<SearchNavState>({ open: false, active: -1 });
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => matchFields(options, text), [options, text]);

  const pick = (option: FieldOption) => {
    setNav({ open: false, active: -1 });
    setText("");
    inputRef.current?.blur();
    onPick(option);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && nav.active < 0) {
      e.preventDefault();
      if (matches.rows[0]) pick(matches.rows[0]);
      return;
    }
    const out = searchKeyDown(nav, e.key, matches.rows.length);
    if (out.action || out.state !== nav) e.preventDefault();
    setNav(out.state);
    if (out.action === "select" && out.index !== undefined) pick(matches.rows[out.index]);
    if (out.action === "close") inputRef.current?.blur();
  };

  return (
    <Box sx={{ position: "relative", flex: 1, minWidth: 260, maxWidth: 520 }} data-id="field-mode-field-picker">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1.5, pr: 1.5, py: 0.5, borderRadius: 2, bgcolor: "background.paper", border: "1px solid", borderColor: nav.open ? "primary.main" : "divider" }}>
        <Typography component="span" aria-hidden sx={{ fontStyle: "italic", fontWeight: 700, color: "text.disabled", fontSize: 15 }}>
          ƒ
        </Typography>
        <InputBase
          inputRef={inputRef}
          placeholder="Search fields by label or API name..."
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNav({ open: true, active: -1 });
          }}
          onFocus={() => setNav((s) => ({ ...s, open: true }))}
          onBlur={() => setTimeout(() => setNav({ open: false, active: -1 }), 150)}
          onKeyDown={onKeyDown}
          inputProps={{ "aria-label": "Search fields", role: "combobox", "aria-expanded": nav.open, "aria-controls": "oi-field-list", "aria-autocomplete": "list" }}
          sx={{ flexGrow: 1, fontSize: 13 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          {countLabel(matches)}
        </Typography>
      </Box>
      {nav.open && (
        <Paper id="oi-field-list" role="listbox" sx={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, maxHeight: 360, overflowY: "auto", py: 0.5 }}>
          {matches.rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No fields match this search. Try the field label or API name.
            </Typography>
          ) : (
            matches.rows.map((o, i) => (
              <Box
                key={o.nodeKey}
                role="option"
                aria-selected={nav.active === i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setNav({ open: true, active: i })}
                sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1.5, py: 0.75, cursor: "pointer", bgcolor: nav.active === i ? "action.hover" : "transparent" }}
              >
                <Box sx={{ width: 28, height: 28, borderRadius: 1, flexShrink: 0, display: "grid", placeItems: "center", fontStyle: "italic", fontWeight: 700, color: "primary.main", bgcolor: "action.selected" }}>ƒ</Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {o.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 11 }}>
                    {o.apiName}
                  </Typography>
                </Box>
                <ArrowForwardRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
              </Box>
            ))
          )}
        </Paper>
      )}
    </Box>
  );
}
