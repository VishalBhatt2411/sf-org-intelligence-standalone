import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  CircularProgress,
  Menu,
  MenuItem,
  Paper,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Stack,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Avatar,
  Divider,
  InputBase,
  Chip,
} from "@mui/material";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import { api, ComponentUsage, Finding, OrgInfo, Scan, ScheduleFrequency, Session } from "./api/client";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FindingsPage, FindingsFilter } from "./pages/FindingsPage";
import { ComponentsPage } from "./pages/ComponentsPage";
import { ScanHistoryPage } from "./pages/ScanHistoryPage";
import { SEVERITY_COLOR } from "./severity";
import { useToast } from "./toast";

const DRAWER_WIDTH = 240;

function BrandMark() {
  return (
    <Box
      sx={{
        width: 34,
        height: 34,
        flexShrink: 0,
        borderRadius: "10px",
        background: "linear-gradient(150deg, #5C7BF7, #7A4FE0)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        fontWeight: 500,
      }}
    >
      td
    </Box>
  );
}

const SCAN_STAGES = [
  "Connecting to Salesforce…",
  "Reading objects & fields…",
  "Scanning Apex classes…",
  "Scanning triggers…",
  "Scanning flows…",
  "Scanning Lightning components…",
  "Checking profiles & permission sets…",
  "Analyzing technical debt…",
];

function ScanningScreen() {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, SCAN_STAGES.length - 1));
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", p: 4 }}>
      <Paper sx={{ p: 5, maxWidth: 420, width: "100%", textAlign: "center" }}>
        <CircularProgress size={48} sx={{ mb: 3 }} />
        <Typography variant="h6" gutterBottom>
          Scanning your Salesforce org
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3, minHeight: 24 }}>
          {SCAN_STAGES[stageIndex]}
        </Typography>
        <LinearProgress sx={{ borderRadius: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
          This can take a minute or two for larger orgs.
        </Typography>
      </Paper>
    </Box>
  );
}

function OrgInfoDialog({ connectionId, open, onClose }: { connectionId: string; open: boolean; onClose: () => void }) {
  const orgInfo = useQuery({
    queryKey: ["orgInfo", connectionId],
    queryFn: () => api.get<OrgInfo>(`/connections/${connectionId}/org-info`).then((r) => r.data),
    enabled: open,
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Org Info
        <IconButton size="small" onClick={onClose}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {orgInfo.isLoading ? (
          <CircularProgress size={24} />
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Organization Name
              </Typography>
              <Typography variant="body1">{orgInfo.data?.name || "—"}</Typography>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Organization Edition
              </Typography>
              <Typography variant="body1">{orgInfo.data?.edition || "—"}</Typography>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          disabled={!orgInfo.data?.advancedDetailsUrl}
          onClick={() => window.open(orgInfo.data!.advancedDetailsUrl, "_blank")}
        >
          Advanced Details
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const FREQUENCY_LABEL: Record<ScheduleFrequency, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function ScheduleDialog({ connectionId, open, onClose }: { connectionId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const notify = useToast();

  const connection = useQuery({
    queryKey: ["connection", connectionId],
    queryFn: () =>
      api
        .get<{ scheduleFrequency: ScheduleFrequency; nextScanAt: string | null }>(`/connections/${connectionId}`)
        .then((r) => r.data),
    enabled: open,
  });

  const updateSchedule = useMutation({
    mutationFn: (frequency: ScheduleFrequency) => api.patch(`/connections/${connectionId}/schedule`, { frequency }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connection", connectionId] });
      notify("Schedule updated");
    },
    onError: () => notify("Couldn't update schedule", "error"),
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Scan Schedule
        <IconButton size="small" onClick={onClose}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Automatically re-scan this org on a recurring interval.
        </Typography>
        {connection.isLoading ? (
          <CircularProgress size={24} />
        ) : (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(Object.keys(FREQUENCY_LABEL) as ScheduleFrequency[]).map((freq) => (
                <Button
                  key={freq}
                  variant={connection.data?.scheduleFrequency === freq ? "contained" : "outlined"}
                  size="small"
                  disabled={updateSchedule.isPending}
                  onClick={() => updateSchedule.mutate(freq)}
                >
                  {FREQUENCY_LABEL[freq]}
                </Button>
              ))}
            </Stack>
            {connection.data?.nextScanAt && connection.data.scheduleFrequency !== "off" && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
                Next scan: {new Date(connection.data.nextScanAt).toLocaleString()}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Bottom-of-sidebar account row: avatar + username + an options menu (Org Info /
// Scan Schedule / Logout), mirroring the reference template's SideMenu account row.
function OrgMenu({ connectionId, onLoggedOut }: { connectionId: string; onLoggedOut: () => void }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [orgInfoOpen, setOrgInfoOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const queryClient = useQueryClient();

  const connection = useQuery({
    queryKey: ["connection", connectionId],
    queryFn: () => api.get<{ username: string }>(`/connections/${connectionId}`).then((r) => r.data),
  });

  const logout = useMutation({
    mutationFn: () => api.post(`/connections/${connectionId}/logout`),
    onSuccess: () => {
      queryClient.clear();
      onLoggedOut();
    },
  });

  const username = connection.data?.username || "Connected";

  return (
    <>
      <Stack
        direction="row"
        spacing={1.25}
        alignItems="center"
        sx={{ p: 2, borderTop: "1px solid", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <Avatar sx={{ width: 34, height: 34, bgcolor: "primary.dark", fontSize: 14, fontWeight: 500 }}>
          {username.slice(0, 1).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" noWrap sx={{ color: "#fff" }}>
            {username}
          </Typography>
          <Typography variant="caption" noWrap sx={{ display: "block", color: "#57C389" }}>
            Connected org
          </Typography>
        </Box>
        <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ color: "#8C97A8" }}>
          <MoreVertRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setOrgInfoOpen(true);
          }}
        >
          Org Info
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setScheduleOpen(true);
          }}
        >
          Scan Schedule
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            logout.mutate();
          }}
        >
          Logout
        </MenuItem>
      </Menu>
      <OrgInfoDialog connectionId={connectionId} open={orgInfoOpen} onClose={() => setOrgInfoOpen(false)} />
      <ScheduleDialog connectionId={connectionId} open={scheduleOpen} onClose={() => setScheduleOpen(false)} />
    </>
  );
}

// Searches whatever's already cached under the ["findings", scanId] / ["components",
// scanId] query keys (the same data Findings/Components pages fetch), so this never
// issues its own network request beyond what those pages already trigger.
function GlobalSearch({
  scanId,
  onOpenFinding,
  onOpenObject,
}: {
  scanId?: string;
  onOpenFinding: (finding: Finding) => void;
  onOpenObject: (apiName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const findings = useQuery({
    queryKey: ["findings", scanId],
    queryFn: () => api.get<Finding[]>(`/findings?scanId=${scanId}`).then((r) => r.data),
    enabled: !!scanId,
  });
  const components = useQuery({
    queryKey: ["components", scanId],
    queryFn: () => api.get<ComponentUsage>(`/scans/${scanId}/components`).then((r) => r.data),
    enabled: !!scanId,
  });

  const q = query.trim().toLowerCase();
  const findingMatches = q
    ? (findings.data || []).filter(
        (f) => f.title.toLowerCase().includes(q) || f.componentName.toLowerCase().includes(q)
      ).slice(0, 5)
    : [];
  const objectMatches = q
    ? (components.data?.objects || []).filter(
        (o) => o.apiName.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
      ).slice(0, 5)
    : [];
  const hasResults = findingMatches.length > 0 || objectMatches.length > 0;

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <Box sx={{ position: "relative", display: { xs: "none", lg: "block" }, width: 240 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: 240,
          px: 1.5,
          py: 0.9,
          borderRadius: 2,
          bgcolor: "background.default",
          border: "1px solid",
          borderColor: "divider",
          color: "text.disabled",
          fontSize: 13,
        }}
      >
        <InputBase
          inputRef={inputRef}
          placeholder="Search findings, objects…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === "Escape" && close()}
          sx={{ flexGrow: 1, fontSize: 13 }}
        />
        <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "'JetBrains Mono', monospace" }}>
          ⌘K
        </Typography>
      </Box>
      {open && q && (
        <Paper
          sx={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            maxHeight: 360,
            overflowY: "auto",
            py: 0.5,
          }}
        >
          {!hasResults ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No results for "{query}"
            </Typography>
          ) : (
            <>
              {findingMatches.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ px: 2, pt: 1, pb: 0.5, display: "block", color: "text.secondary" }}>
                    FINDINGS
                  </Typography>
                  {findingMatches.map((f) => (
                    <MenuItem
                      key={f.id}
                      onMouseDown={() => {
                        onOpenFinding(f);
                        close();
                      }}
                      sx={{ gap: 1 }}
                    >
                      <Chip size="small" label={f.severity} color={SEVERITY_COLOR[f.severity]} sx={{ flexShrink: 0 }} />
                      <Typography variant="body2" noWrap>
                        {f.title}
                      </Typography>
                    </MenuItem>
                  ))}
                </>
              )}
              {objectMatches.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ px: 2, pt: 1, pb: 0.5, display: "block", color: "text.secondary" }}>
                    OBJECTS
                  </Typography>
                  {objectMatches.map((o) => (
                    <MenuItem
                      key={o.apiName}
                      onMouseDown={() => {
                        onOpenObject(o.apiName);
                        close();
                      }}
                      sx={{ gap: 1 }}
                    >
                      <Typography variant="body2" noWrap>
                        {o.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {o.apiName}
                      </Typography>
                    </MenuItem>
                  ))}
                </>
              )}
            </>
          )}
        </Paper>
      )}
    </Box>
  );
}

type Tab = "dashboard" | "findings" | "components" | "history";

const NAV_ITEMS: { value: Tab; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "findings", label: "Findings" },
  { value: "components", label: "Components" },
];

function totalComponentCount(u: ComponentUsage) {
  return (
    u.objects.length +
    u.objects.reduce((n, o) => n + o.fields.length, 0) +
    u.classes.length +
    u.triggers.length +
    u.flows.length +
    u.lwc.length +
    u.visualforcePages.length +
    u.visualforceComponents.length +
    u.workflowRules.length +
    u.emailTemplates.length +
    u.installedPackages.length
  );
}

function abbreviateCount(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

function SideNavContent({
  tab,
  onSelect,
  connectionId,
  onLoggedOut,
  findingsCount,
  componentsCount,
}: {
  tab: Tab;
  onSelect: (t: Tab) => void;
  connectionId: string;
  onLoggedOut: () => void;
  findingsCount?: number;
  componentsCount?: number;
}) {
  const notify = useToast();
  const navCount: Partial<Record<Tab, string>> = {
    findings: findingsCount != null ? String(findingsCount) : undefined,
    components: componentsCount != null ? abbreviateCount(componentsCount) : undefined,
  };
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, p: 2 }}>
        <BrandMark />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="subtitle1"
            sx={{ lineHeight: 1.2, color: "#fff" }}
            noWrap
          >
            Tech Debt AI
          </Typography>
          <Typography variant="caption" noWrap sx={{ display: "block", color: "#8C97A8" }}>
            Salesforce org health
          </Typography>
        </Box>
      </Box>
      <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
      <Box sx={{ flexGrow: 1, overflowY: "auto", py: 1 }}>
        <Typography
          variant="caption"
          sx={{ display: "block", px: 2.25, pt: 1, pb: 1, letterSpacing: 1, fontSize: 10.5, color: "#5E6878" }}
        >
          MONITOR
        </Typography>
        <List sx={{ px: 1 }}>
          {NAV_ITEMS.map((item) => {
            const selected = tab === item.value;
            return (
              <ListItem key={item.value} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  selected={selected}
                  onClick={() => onSelect(item.value)}
                  sx={{
                    color: selected ? "#fff" : "#BCC5D1",
                    justifyContent: "space-between",
                    "&.Mui-selected": { bgcolor: "rgba(255,255,255,0.09)" },
                    "&.Mui-selected:hover": { bgcolor: "rgba(255,255,255,0.09)" },
                    "&:hover": { bgcolor: "rgba(255,255,255,0.05)" },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1.25}>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: selected ? "primary.light" : "#454E5C",
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText primary={item.label} />
                  </Stack>
                  {navCount[item.value] && (
                    <Typography variant="caption" sx={{ color: "#8C97A8", fontVariantNumeric: "tabular-nums" }}>
                      {navCount[item.value]}
                    </Typography>
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        <Typography
          variant="caption"
          sx={{ display: "block", px: 2.25, pt: 2, pb: 1, letterSpacing: 1, fontSize: 10.5, color: "#5E6878" }}
        >
          WORKSPACE
        </Typography>
        <List sx={{ px: 1 }}>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              selected={tab === "history"}
              onClick={() => onSelect("history")}
              sx={{
                color: tab === "history" ? "#fff" : "#BCC5D1",
                "&.Mui-selected": { bgcolor: "rgba(255,255,255,0.09)" },
                "&.Mui-selected:hover": { bgcolor: "rgba(255,255,255,0.09)" },
                "&:hover": { bgcolor: "rgba(255,255,255,0.05)" },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.25}>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    bgcolor: tab === "history" ? "primary.light" : "#454E5C",
                    flexShrink: 0,
                  }}
                />
                <ListItemText primary="Scan history" />
              </Stack>
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => notify("Settings isn't built yet")}
              sx={{ color: "#BCC5D1", "&:hover": { bgcolor: "rgba(255,255,255,0.05)" } }}
            >
              <Stack direction="row" alignItems="center" spacing={1.25}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "#454E5C", flexShrink: 0 }} />
                <ListItemText primary="Settings" />
              </Stack>
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
      <OrgMenu connectionId={connectionId} onLoggedOut={onLoggedOut} />
    </Box>
  );
}

function SideNav({
  tab,
  onSelect,
  connectionId,
  onLoggedOut,
  mobileOpen,
  onMobileClose,
  findingsCount,
  componentsCount,
}: {
  tab: Tab;
  onSelect: (t: Tab) => void;
  connectionId: string;
  onLoggedOut: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  findingsCount?: number;
  componentsCount?: number;
}) {
  const paperSx = {
    width: DRAWER_WIDTH,
    boxSizing: "border-box" as const,
    bgcolor: "#11151B",
    color: "#D8DEE7",
    borderRight: "none",
  };

  return (
    <>
      <Drawer
        variant="permanent"
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": paperSx }}
      >
        <SideNavContent
          tab={tab}
          onSelect={onSelect}
          connectionId={connectionId}
          onLoggedOut={onLoggedOut}
          findingsCount={findingsCount}
          componentsCount={componentsCount}
        />
      </Drawer>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": paperSx }}
      >
        <SideNavContent
          tab={tab}
          onSelect={(t) => {
            onSelect(t);
            onMobileClose();
          }}
          connectionId={connectionId}
          onLoggedOut={onLoggedOut}
          findingsCount={findingsCount}
          componentsCount={componentsCount}
        />
      </Drawer>
    </>
  );
}

function MobileTopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <AppBar position="fixed" sx={{ display: { xs: "flex", md: "none" } }}>
      <Toolbar sx={{ gap: 1.25 }}>
        <IconButton edge="start" color="inherit" onClick={onMenuClick}>
          <MenuRoundedIcon />
        </IconButton>
        <BrandMark />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Tech Debt AI
        </Typography>
      </Toolbar>
    </AppBar>
  );
}

const PAGE_TITLE: Record<Tab, string> = {
  dashboard: "Dashboard",
  findings: "Findings",
  components: "Components",
  history: "Scan History",
};

const CONNECTION_ID_KEY = "sfTechDebt.connectionId";

function readInitialConnectionId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("connectionId");
  if (fromUrl) {
    localStorage.setItem(CONNECTION_ID_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(CONNECTION_ID_KEY);
}

function AuthedApp() {
  const [connectionId, setConnectionId] = useState(readInitialConnectionId);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [findingsFilter, setFindingsFilter] = useState<FindingsFilter | undefined>(undefined);
  const [componentsSearch, setComponentsSearch] = useState<string | undefined>(undefined);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewedScanId, setViewedScanId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const notify = useToast();

  const scans = useQuery({
    queryKey: ["scans", connectionId],
    queryFn: () => api.get<Scan[]>("/scans", { params: connectionId ? { connectionId } : undefined }).then((r) => r.data),
  });

  const latestScan = scans.data?.[0];
  // Scan history lets you drill into an older scan; it stays the active one across
  // Dashboard/Findings/Components until you go back to latest or a new scan finishes.
  const activeScan = (viewedScanId && scans.data?.find((s) => s.id === viewedScanId)) || latestScan;

  // Cache-only reads: reuse whatever DashboardPage/FindingsPage/ComponentsPage have
  // already fetched under the same query keys for the sidebar nav badges, without
  // triggering a fetch of our own.
  const findingsCache = useQuery({
    queryKey: ["findings", latestScan?.id],
    queryFn: () => Promise.resolve<Finding[]>([]),
    enabled: false,
  });
  const componentsCache = useQuery({
    queryKey: ["components", latestScan?.id],
    queryFn: () => Promise.resolve<ComponentUsage | undefined>(undefined),
    enabled: false,
  });
  // The URL param / localStorage can go stale (fresh tab, cleared storage) while a
  // connection still exists server-side — the scan we already fetched knows its
  // connectionId, so fall back to that instead of showing "not connected" incorrectly.
  const effectiveConnectionId = connectionId || latestScan?.connectionId || null;

  useEffect(() => {
    if (effectiveConnectionId) localStorage.setItem(CONNECTION_ID_KEY, effectiveConnectionId);
  }, [effectiveConnectionId]);

  const runScan = useMutation({
    mutationFn: () => api.post("/scans", { connectionId: effectiveConnectionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scans"] });
      setViewedScanId(null);
      notify("Scan complete");
    },
    onError: () => notify("Scan failed", "error"),
  });

  function goToFindings(filter: FindingsFilter) {
    setFindingsFilter(filter);
    setTab("findings");
  }

  function goToComponent(apiName: string) {
    setComponentsSearch(apiName);
    setTab("components");
  }

  function selectTab(next: Tab) {
    if (next === "findings" && tab !== "findings") setFindingsFilter(undefined);
    if (next === "components" && tab !== "components") setComponentsSearch(undefined);
    setTab(next);
  }

  if (!effectiveConnectionId && (!scans.data || scans.data.length === 0)) {
    return <ConnectPage />;
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      {effectiveConnectionId && (
        <>
          <MobileTopBar onMenuClick={() => setMobileNavOpen(true)} />
          <SideNav
            tab={tab}
            onSelect={selectTab}
            connectionId={effectiveConnectionId}
            onLoggedOut={() => {
              localStorage.removeItem(CONNECTION_ID_KEY);
              setConnectionId(null);
              setViewedScanId(null);
              window.history.replaceState({}, "", window.location.pathname);
            }}
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
            findingsCount={findingsCache.data?.length}
            componentsCount={componentsCache.data && totalComponentCount(componentsCache.data)}
          />
        </>
      )}

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, mt: { xs: 7, md: 0 } }}>
        {effectiveConnectionId && (
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              px: { xs: 3, md: 4 },
              py: 2.5,
              position: "sticky",
              top: 0,
              zIndex: 5,
              borderBottom: "1px solid",
              borderColor: "divider",
              bgcolor: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(12px)",
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Monitor
              </Typography>
              <Typography variant="body2" color="text.disabled">
                /
              </Typography>
              <Typography variant="body2" sx={{ color: "text.primary" }}>
                {PAGE_TITLE[tab]}
              </Typography>
              <Box
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.75,
                  ml: 1,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 999,
                  bgcolor: "background.default",
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "success.main" }} />
                <Typography variant="caption">Production org</Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <GlobalSearch
                scanId={activeScan?.id}
                onOpenFinding={(f) => goToFindings({ search: f.title })}
                onOpenObject={goToComponent}
              />
              <Button
                variant="outlined"
                sx={{ display: { xs: "none", sm: "inline-flex" } }}
                onClick={() => notify("Export isn't built yet")}
              >
                Export report
              </Button>
              <Button variant="contained" disabled={runScan.isPending} onClick={() => runScan.mutate()}>
                {runScan.isPending ? <CircularProgress size={18} color="inherit" /> : "Run Scan"}
              </Button>
            </Stack>
          </Stack>
        )}

        {runScan.isPending ? (
          <ScanningScreen />
        ) : tab === "history" ? (
          effectiveConnectionId && (
            <ScanHistoryPage
              connectionId={effectiveConnectionId}
              activeScanId={activeScan?.id ?? null}
              onViewScan={(scanId) => {
                setViewedScanId(scanId);
                setTab("dashboard");
              }}
            />
          )
        ) : !activeScan ? (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
            <Paper sx={{ p: 5, maxWidth: 420, textAlign: "center" }}>
              <Typography variant="h6" gutterBottom>
                No scans yet
              </Typography>
              <Typography color="text.secondary">
                Click <strong>Run Scan</strong> above to analyze the connected org and generate your first health
                report.
              </Typography>
            </Paper>
          </Box>
        ) : (
          <>
            {latestScan && activeScan.id !== latestScan.id && (
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: { xs: 3, md: 4 }, py: 1.5, bgcolor: "#FFF7E6", borderBottom: "1px solid", borderColor: "divider" }}
              >
                <Typography variant="body2" sx={{ color: "#9E5E0A" }}>
                  Viewing scan from {new Date(activeScan.startedAt).toLocaleString()} — not the latest.
                </Typography>
                <Button size="small" onClick={() => setViewedScanId(null)}>
                  Back to latest
                </Button>
              </Stack>
            )}
            {tab === "dashboard" ? (
              <DashboardPage scanId={activeScan.id} connectionId={activeScan.connectionId} onNavigateToFindings={goToFindings} />
            ) : tab === "findings" ? (
              <FindingsPage scanId={activeScan.id} initialFilter={findingsFilter} />
            ) : (
              <ComponentsPage scanId={activeScan.id} initialSearch={componentsSearch} />
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

// Being connected to Salesforce *is* being logged in — there's no separate app
// password. This just checks whether the session cookie from the OAuth callback
// (see backend/src/routes/auth.ts) is still valid before rendering anything else.
export default function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Session>("/auth/me").then((r) => r.data),
    retry: false,
  });

  if (me.isLoading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!me.data) {
    return <ConnectPage />;
  }

  return <AuthedApp />;
}
