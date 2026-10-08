import { useState } from "react";
import { Alert, Box, Button, Chip, Collapse, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, useTheme } from "@mui/material";
import type { BreakdownRow, Kpi, SectionResult, Severity } from "./healthApi";
import { scoreText, severityColor, severityLabel, stateBanner } from "./healthFormat";

// Small presentational pieces shared by the Org Health views. All values arrive ready-made from the
// server; nothing here computes a score or a severity.

export function useSeverityColor(): (severity: Severity | null) => string {
  const theme = useTheme();
  return (severity) => (severity ? severityColor(severity, theme.palette.mode === "dark") : theme.palette.text.secondary);
}

// Text plus colour: the colour is never the only signal.
export function SeverityBadge({ severity, size = "small" }: { severity: Severity | null; size?: "small" | "medium" }) {
  const color = useSeverityColor()(severity);
  return <Chip size={size} label={severityLabel(severity)} variant="outlined" sx={{ color, borderColor: color, fontWeight: 600 }} />;
}

export function ScoreRing({ score, severity, size = 96 }: { score: number | null; severity: Severity | null; size?: number }) {
  const color = useSeverityColor()(severity);
  const theme = useTheme();
  const radius = size / 2 - 7;
  const circumference = 2 * Math.PI * radius;
  const fraction = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }} role="img" aria-label={score === null ? "Not scored" : `Score ${scoreText(score)} out of 100, ${severityLabel(severity)}`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={theme.palette.divider} strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size / 3.2, fontWeight: 700, color }}>{scoreText(score)}</Box>
    </Box>
  );
}

const BASIS_LABEL = { scan: "From the last scan", live: "Read live from Salesforce", calculated: "Calculated from other figures" } as const;

export function KpiTile({ kpi, onOpen }: { kpi: Kpi; onOpen?: (kpi: Kpi) => void }) {
  const clickable = Boolean(kpi.drilldownKey && onOpen);
  return (
    <Tooltip title={BASIS_LABEL[kpi.basis]} placement="top">
      <Box
        component={clickable ? "button" : "div"}
        onClick={clickable ? () => onOpen?.(kpi) : undefined}
        sx={{
          textAlign: "left",
          font: "inherit",
          color: "inherit",
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          p: 1.5,
          cursor: clickable ? "pointer" : "default",
          "&:hover": clickable ? { borderColor: "primary.main" } : undefined,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {kpi.label}
        </Typography>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
          {kpi.value}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export function KpiStrip({ kpis, onOpen }: { kpis: Kpi[]; onOpen?: (kpi: Kpi) => void }) {
  if (kpis.length === 0) return null;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1.5 }}>
      {kpis.map((kpi) => (
        <KpiTile key={kpi.key} kpi={kpi} onOpen={onOpen} />
      ))}
    </Box>
  );
}

export function StateBanner({ result }: { result: SectionResult }) {
  const banner = stateBanner(result);
  if (!banner) return null;
  return (
    <Alert severity={banner.kind}>
      {banner.message}
      {banner.details.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {banner.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </Box>
      )}
    </Alert>
  );
}

export function FormulaDisclosure({ formula }: { formula: SectionResult["formula"] }) {
  const [open, setOpen] = useState(false);
  if (!formula) return null;
  return (
    <Box>
      <Button size="small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} how this score is calculated
      </Button>
      <Collapse in={open}>
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5, mt: 0.5 }}>
          <Typography variant="body2">{formula.summary}</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
            {formula.components.map((c) => (
              <Chip key={c.label} size="small" variant="outlined" label={`${c.label} · ${c.weight}`} />
            ))}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}

export function BreakdownList({ title, caption, columns, rows }: { title: string; caption: string; columns: string[]; rows: BreakdownRow[] }) {
  const color = useSeverityColor();
  if (rows.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600}>
        {title}
      </Typography>
      {caption && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {caption}
        </Typography>
      )}
      <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Status</TableCell>
              {columns.map((c) => (
                <TableCell key={c} align="right">
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} hover>
                <TableCell>
                  <Tooltip title={row.explanation} placement="top-start">
                    <span>{row.label}</span>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {row.componentType}
                  </Typography>
                </TableCell>
                <TableCell sx={{ color: color(row.severity), fontWeight: 600 }}>{severityLabel(row.severity)}</TableCell>
                {columns.map((c) => (
                  <TableCell key={c} align="right">
                    {row.metrics.find((m) => m.column === c)?.value ?? "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

export function Heatmap({ heatmap }: { heatmap: SectionResult["heatmap"] }) {
  const color = useSeverityColor();
  if (heatmap.rows.length === 0) return null;
  return (
    <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell />
            {heatmap.columns.map((c) => (
              <TableCell key={c} align="center">
                {c}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {heatmap.rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              {heatmap.columns.map((c) => {
                const cell = row.cells.find((x) => x.column === c);
                return (
                  <TableCell key={c} align="center" sx={{ color: cell?.severity ? color(cell.severity) : "text.secondary", fontWeight: cell?.severity ? 600 : 400 }}>
                    {cell?.value ?? "—"}
                    {cell?.severity ? ` · ${severityLabel(cell.severity)}` : ""}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export function Facts({ facts }: { facts: SectionResult["facts"] }) {
  if (facts.length === 0) return null;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.5 }}>
      {facts.map((f) => (
        <Box key={f.label} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5, bgcolor: "background.paper" }}>
          <Typography variant="caption" color="text.secondary">
            {f.label}
          </Typography>
          <Typography variant="subtitle1" fontWeight={600}>
            {f.value}
          </Typography>
          {f.detail && (
            <Typography variant="caption" color="text.secondary">
              {f.detail}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
