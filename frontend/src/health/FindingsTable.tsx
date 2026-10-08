import { Box, Chip, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel, Typography } from "@mui/material";
import type { FindingRow } from "./healthApi";
import { SECTION_LABEL, STATUS_LABEL, formatDate, scoreText } from "./healthFormat";
import { SeverityBadge } from "./healthParts";

type Props = {
  rows: FindingRow[];
  onOpen: (id: string) => void;
  sort?: { key: string; direction: "asc" | "desc"; onChange: (key: string) => void };
  showSection?: boolean;
  empty?: string;
};

const COLUMNS: Array<{ key: string; label: string; sortable: boolean; align?: "right" }> = [
  { key: "severity", label: "Severity", sortable: true },
  { key: "title", label: "Finding", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "owner", label: "Owner", sortable: false },
  { key: "dueDate", label: "Due", sortable: true },
  { key: "score", label: "Score", sortable: true, align: "right" },
];

export function FindingsTable({ rows, onOpen, sort, showSection = true, empty = "No findings." }: Props) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        {empty}
      </Typography>
    );
  }
  return (
    <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableCell key={c.key} align={c.align} sortDirection={sort?.key === c.key ? sort.direction : false}>
                {sort && c.sortable ? (
                  <TableSortLabel active={sort.key === c.key} direction={sort.key === c.key ? sort.direction : "asc"} onClick={() => sort.onChange(c.key)}>
                    {c.label}
                  </TableSortLabel>
                ) : (
                  c.label
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover onClick={() => onOpen(row.id)} sx={{ cursor: "pointer" }}>
              <TableCell>
                <SeverityBadge severity={row.severity} />
              </TableCell>
              <TableCell sx={{ maxWidth: 420 }}>
                <Typography variant="body2" fontWeight={600}>
                  {row.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {showSection ? `${SECTION_LABEL[row.section]} · ` : ""}
                  {row.componentLabel} · {row.measured}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip size="small" label={STATUS_LABEL[row.status]} />
                {row.overdue && <Chip size="small" color="error" variant="outlined" label="Overdue" sx={{ ml: 0.5 }} />}
                {row.riskExpired && <Chip size="small" color="warning" variant="outlined" label="Risk expired" sx={{ ml: 0.5 }} />}
              </TableCell>
              <TableCell>{row.owner ?? "Unassigned"}</TableCell>
              <TableCell>{formatDate(row.dueDate)}</TableCell>
              <TableCell align="right">{scoreText(row.score)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
