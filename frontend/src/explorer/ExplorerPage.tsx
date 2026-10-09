import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, CircularProgress, IconButton, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { api as http } from "../api/client";
import { useToast } from "../toast";
import { CoverageBanner, NoGraphState } from "./StartScreen";
import { FieldModeView } from "./FieldModeView";
import { graphApi, type GraphNode } from "./graphApi";
import { errorMessage } from "./nodeStyle";
import { ObjectModeView } from "./ObjectModeView";

const DARK_KEY = "orgIntel.explorer.dark";
const readDark = (): boolean => {
  try {
    return localStorage.getItem(DARK_KEY) === "1";
  } catch {
    return false;
  }
};

type Lens = "object" | "field";

type ExplorerPageProps = {
  connectionId: string;
  // A node to focus on arrival (e.g. from an Org Health finding); reported back once handled.
  initialNodeKey?: string | null;
  onInitialNodeHandled?: () => void;
};

// Graph Explorer shell (port of native oiGraphExplorer): a header that chooses the analysis lens, and the
// lens' own workspace below. Each lens keeps its own state, so switching tabs never loses where you were.
export function ExplorerPage({ connectionId, initialNodeKey = null, onInitialNodeHandled }: ExplorerPageProps) {
  const notify = useToast();
  const [lens, setLens] = useState<Lens>("object");
  const [dark, setDark] = useState(readDark);
  const [pending, setPending] = useState<{ lens: Lens; node: GraphNode } | null>(null);

  const summary = useQuery({ queryKey: ["graph", "summary", connectionId], queryFn: () => graphApi(connectionId).summary(), staleTime: 30_000 });
  const connection = useQuery({
    queryKey: ["graph", "instanceUrl", connectionId],
    queryFn: () => http.get<{ instanceUrl: string | null }>(`/connections/${connectionId}`).then((r) => r.data.instanceUrl ?? null),
    staleTime: 5 * 60_000,
  });

  // A finding from Org Health arrives as a node key: objects open the Object lens, everything else the Field
  // lens, which can show any node.
  useEffect(() => {
    if (!initialNodeKey) return;
    let cancelled = false;
    graphApi(connectionId)
      .detail(initialNodeKey)
      .then((detail) => {
        if (cancelled) return;
        const target: Lens = detail.node.kind === "CustomObject" ? "object" : "field";
        setLens(target);
        setPending({ lens: target, node: detail.node });
      })
      .catch((e) => {
        if (!cancelled) notify(errorMessage(e), "error");
      })
      .finally(() => {
        if (!cancelled) onInitialNodeHandled?.();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodeKey]);

  const toggleDark = () =>
    setDark((d) => {
      try {
        localStorage.setItem(DARK_KEY, d ? "0" : "1");
      } catch {
        /* a private window may refuse storage; the choice just will not persist */
      }
      return !d;
    });

  if (summary.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (summary.isError || !summary.data) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{summary.isError ? errorMessage(summary.error) : "Couldn't load the graph summary."}</Alert>
      </Box>
    );
  }
  if (summary.data.coverage === "none" || summary.data.totalNodes === 0) {
    return <NoGraphState message="Run a scan to build the graph. Once it finishes, every object, field, Apex class, flow and rule shows up here." />;
  }

  const data = summary.data;
  const instanceUrl = connection.data ?? null;
  const pendingFor = (l: Lens) => (pending?.lens === l ? pending.node : null);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: { xs: "calc(100vh - 120px)", md: "calc(100vh - 74px)" }, minHeight: 520 }}>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: 1.5, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              Analysis workspace
            </Typography>
            <Typography variant="h6" component="h1" sx={{ lineHeight: 1.25 }}>
              Choose a lens, then anchor the graph
            </Typography>
          </Box>
          <Tooltip title={dark ? "Light canvas" : "Dark canvas"}>
            <IconButton size="small" onClick={toggleDark} aria-label="Toggle dark canvas">
              {dark ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
        <CoverageBanner summary={data} />
        <Tabs value={lens} onChange={(_, v: Lens) => setLens(v)} aria-label="Analyze" sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none", fontWeight: 600 } }}>
          <Tab value="object" label="Object" />
          <Tab value="field" label="Field" />
          <Tab value="record" label="Record" disabled title="Record analysis is not available in this build yet" />
        </Tabs>
      </Box>

      {/* Both lenses stay mounted so each keeps its own state when the tab changes. */}
      <Box sx={{ display: lens === "object" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <ObjectModeView connectionId={connectionId} summary={data} dark={dark} instanceUrl={instanceUrl} pendingNode={pendingFor("object")} onPendingHandled={() => setPending(null)} />
      </Box>
      <Box sx={{ display: lens === "field" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <FieldModeView connectionId={connectionId} summary={data} dark={dark} pendingNode={pendingFor("field")} onPendingHandled={() => setPending(null)} />
      </Box>
    </Box>
  );
}
