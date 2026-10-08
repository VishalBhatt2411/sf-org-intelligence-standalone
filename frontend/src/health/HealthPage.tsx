import { useMemo, useState } from "react";
import { Box, Stack, Tab, Tabs } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { FindingDrawer } from "./FindingDrawer";
import { healthApi, type SectionKey } from "./healthApi";
import { useSeverityColor } from "./healthParts";
import { OverviewView } from "./OverviewView";
import { RemediationView } from "./RemediationView";
import { SectionView } from "./SectionView";

type TabKey = SectionKey | "remediation";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "metadata", label: "Metadata" },
  { key: "automation", label: "Automation" },
  { key: "code", label: "Code" },
  { key: "security", label: "Security" },
  { key: "data", label: "Data" },
  { key: "storage", label: "Storage" },
  { key: "remediation", label: "Remediation" },
];

type Props = { connectionId: string; onOpenInExplorer: (nodeKey: string) => void };

// Org Health: one tab per section plus the remediation queue. A finding opened from any of them shows
// in the same drawer; "Open in Graph Explorer" hands the node key back to the app shell.
export function HealthPage({ connectionId, onOpenInExplorer }: Props) {
  const api = useMemo(() => healthApi(connectionId), [connectionId]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [findingId, setFindingId] = useState<string | null>(null);
  const color = useSeverityColor();

  // Shared with the Overview, so the dots cost no extra request.
  const summary = useQuery({ queryKey: ["health-summary", api.key], queryFn: () => api.summary() });
  const dot = (key: TabKey) => summary.data?.cards.find((c) => c.section === key);

  return (
    <Stack gap={2}>
      <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} variant="scrollable" scrollButtons="auto">
        {TABS.map((t) => {
          const card = dot(t.key);
          const severity = card?.scored ? card.severity : null;
          return (
            <Tab
              key={t.key}
              value={t.key}
              label={
                <Stack direction="row" gap={0.75} alignItems="center">
                  {severity && <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color(severity) }} />}
                  {t.label}
                </Stack>
              }
            />
          );
        })}
      </Tabs>

      {tab === "overview" && <OverviewView api={api} onOpenSection={(s) => setTab(s)} />}
      {tab === "remediation" && <RemediationView api={api} onOpenFinding={setFindingId} />}
      {tab !== "overview" && tab !== "remediation" && <SectionView key={tab} api={api} section={tab} onOpenFinding={setFindingId} />}

      <FindingDrawer
        api={api}
        findingId={findingId}
        onClose={() => setFindingId(null)}
        onOpenFinding={setFindingId}
        onOpenInExplorer={(nodeKey) => {
          setFindingId(null);
          onOpenInExplorer(nodeKey);
        }}
      />
    </Stack>
  );
}
