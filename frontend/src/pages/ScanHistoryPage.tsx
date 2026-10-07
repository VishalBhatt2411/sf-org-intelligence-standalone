import { useQuery } from "@tanstack/react-query";
import { Box, Paper, Typography, Chip } from "@mui/material";
import { api, HealthHistoryPoint, Scan } from "../api/client";

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  completed: "success",
  running: "warning",
  failed: "error",
};

function scoreColor(score: number) {
  if (score >= 75) return "#14854F";
  if (score >= 50) return "#EE9A12";
  return "#D93A3F";
}

export function ScanHistoryPage({
  connectionId,
  activeScanId,
  onViewScan,
}: {
  connectionId: string;
  activeScanId: string | null;
  onViewScan: (scanId: string) => void;
}) {
  const scans = useQuery({
    queryKey: ["scans", connectionId],
    queryFn: () => api.get<Scan[]>("/scans", { params: { connectionId } }).then((r) => r.data),
  });

  const healthHistory = useQuery({
    queryKey: ["healthHistory", connectionId],
    queryFn: () => api.get<HealthHistoryPoint[]>(`/connections/${connectionId}/health-history`).then((r) => r.data),
  });

  if (scans.isLoading) return <Typography sx={{ p: 4 }}>Loading...</Typography>;

  const scoreByScanId = new Map((healthHistory.data ?? []).map((h) => [h.scanId, h.overall]));
  const rows = scans.data ?? [];

  return (
    <Box sx={{ p: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          Scan History
        </Typography>
        {rows.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No scans yet.
          </Typography>
        ) : (
          rows.map((scan, i) => {
            const score = scoreByScanId.get(scan.id);
            const isActive = scan.id === activeScanId;
            return (
              <Box
                key={scan.id}
                onClick={() => onViewScan(scan.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  py: 1.5,
                  px: 1,
                  cursor: "pointer",
                  borderRadius: 1,
                  borderBottom: i === rows.length - 1 ? "none" : "1px solid",
                  borderColor: "divider",
                  bgcolor: isActive ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {new Date(scan.startedAt).toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {scan.finishedAt ? `Finished ${new Date(scan.finishedAt).toLocaleTimeString()}` : "In progress"}
                  </Typography>
                </Box>
                {score != null && (
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, color: scoreColor(score), minWidth: 32, textAlign: "right" }}
                  >
                    {score}
                  </Typography>
                )}
                <Chip
                  size="small"
                  label={scan.status}
                  color={STATUS_COLOR[scan.status] ?? "default"}
                  sx={{ textTransform: "capitalize", minWidth: 90 }}
                />
              </Box>
            );
          })
        )}
      </Paper>
    </Box>
  );
}
