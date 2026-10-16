import { useState } from "react";
import { Badge, Box, Button, Checkbox, Collapse, FormControlLabel, IconButton, Tooltip, Typography } from "@mui/material";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { DASH, canvasTokens } from "./nodeStyle";
import { DEFAULT_FILTER, isFilterActive, toggleDirection, toggleType, type LegendEntry, type RelationshipFilter } from "./relationshipFilter";

type Props = {
  entries: readonly LegendEntry[];
  filter: RelationshipFilter;
  onChange: (filter: RelationshipFilter) => void;
  dark: boolean;
};

const sectionTitle = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", mt: 1, mb: 0.25 } as const;

// Relationship legend and filters over the Field canvas (port of native oiFilterPanel): one checkbox per edge
// type with its line style, Parent/Child direction, and "Direct relationships only".
export function FieldFilterPanel({ entries, filter, onChange, dark }: Props) {
  const t = canvasTokens(dark);
  const [open, setOpen] = useState(false);
  const active = isFilterActive(filter);
  const check = { color: t.subtext, p: 0.5, "&.Mui-checked": { color: t.selection } } as const;
  const label = { m: 0, "& .MuiFormControlLabel-label": { fontSize: 12.5, color: t.text } } as const;

  return (
    <Box sx={{ position: "absolute", top: 12, left: 12, zIndex: 2, maxWidth: 320 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-id="field-filter-panel">
      {!open ? (
        <Tooltip title="Relationship legend and filters">
          <Badge color="primary" variant="dot" invisible={!active} overlap="circular">
            <Button size="small" startIcon={<TuneRoundedIcon fontSize="small" />} onClick={() => setOpen(true)} sx={{ textTransform: "none", color: t.text, bgcolor: t.overlay, border: `1px solid ${t.overlayBorder}`, borderRadius: 2, px: 1.25 }}>
              Legend &amp; filters
            </Button>
          </Badge>
        </Tooltip>
      ) : null}
      <Collapse in={open} unmountOnExit>
        <Box sx={{ bgcolor: t.overlay, border: `1px solid ${t.overlayBorder}`, borderRadius: 2, px: 1.5, py: 1, maxHeight: 420, overflowY: "auto", color: t.text }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <TuneRoundedIcon fontSize="small" sx={{ color: t.subtext }} />
            <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Legend &amp; filters</Typography>
            {active && (
              <Button size="small" onClick={() => onChange(DEFAULT_FILTER)} sx={{ textTransform: "none", minWidth: 0, fontSize: 12 }}>
                Reset
              </Button>
            )}
            <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close filters" sx={{ color: t.subtext }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <Typography sx={{ ...sectionTitle, color: t.subtext }}>Relationship Legend</Typography>
          {entries.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: t.subtext }}>No relationships on the canvas yet.</Typography>
          ) : (
            entries.map((e) => (
              <Box key={e.typeKey} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                <Checkbox size="small" checked={!filter.hiddenTypes.has(e.typeKey)} onChange={() => onChange({ ...filter, hiddenTypes: toggleType(filter.hiddenTypes, e.typeKey) })} sx={check} inputProps={{ "aria-label": `Show ${e.label} relationships` }} />
                <Box component="svg" width={28} height={12} sx={{ flexShrink: 0, mt: 1 }} aria-hidden>
                  <line x1={1} y1={6} x2={27} y2={6} stroke={t.edgeActive} strokeWidth={2} strokeDasharray={DASH[e.style]} />
                </Box>
                <Box sx={{ minWidth: 0, pt: 0.5 }}>
                  <Typography sx={{ fontSize: 12.5, lineHeight: 1.3 }}>
                    {e.label} <Box component="span" sx={{ color: t.subtext }}>({e.count})</Box>
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: t.subtext, lineHeight: 1.3 }}>{e.description}</Typography>
                </Box>
              </Box>
            ))
          )}

          <Typography sx={{ ...sectionTitle, color: t.subtext }}>Direction</Typography>
          <FormControlLabel sx={label} control={<Checkbox size="small" sx={check} checked={filter.direction.parents} onChange={() => onChange({ ...filter, direction: toggleDirection(filter.direction, "parents") })} />} label="Parent Objects (outgoing)" />
          <FormControlLabel sx={label} control={<Checkbox size="small" sx={check} checked={filter.direction.children} onChange={() => onChange({ ...filter, direction: toggleDirection(filter.direction, "children") })} />} label="Child Objects (incoming)" />

          <Typography sx={{ ...sectionTitle, color: t.subtext }}>Depth</Typography>
          <FormControlLabel sx={label} control={<Checkbox size="small" sx={check} checked={filter.directOnly} onChange={() => onChange({ ...filter, directOnly: !filter.directOnly })} />} label="Direct relationships only (hide grandparent/grandchild)" />
        </Box>
      </Collapse>
    </Box>
  );
}
