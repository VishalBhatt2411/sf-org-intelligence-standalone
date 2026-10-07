import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Paper,
  Chip,
  List,
  ListItemButton,
  Collapse,
  ButtonBase,
  Divider,
  TextField,
  Stack,
  Grid,
} from "@mui/material";
import { api, AccessGrant, ComponentUsage, UsageRef } from "../api/client";
import { OpenInSalesforceButton } from "../components/OpenInSalesforceButton";

const LIST_HEIGHT = 420;
const USED_COLOR = "#14854F";
const UNUSED_COLOR = "#D8DEE7";

const LIST_HEIGHT_PX = `${LIST_HEIGHT}px`;

function UsageChip({ usedIn }: { usedIn: UsageRef[] }) {
  return usedIn.length > 0 ? (
    <Chip size="small" label={`Used (${usedIn.length})`} sx={{ bgcolor: "#E8F7EF", color: USED_COLOR, fontWeight: 700 }} />
  ) : (
    <Chip size="small" variant="outlined" label="Unused" sx={{ color: "text.secondary", borderColor: "divider" }} />
  );
}

// Impact Analysis (FRD Phase 6): given who references a component, how risky is deleting it.
// Simple count-based thresholds, matching the FRD's own example (3 flows + 2 triggers -> HIGH).
const TYPE_LABELS: Record<string, [string, string]> = {
  ApexClass: ["Apex Class", "Apex Classes"],
  ApexTrigger: ["Trigger", "Triggers"],
  Flow: ["Flow", "Flows"],
  LightningWebComponent: ["LWC", "LWCs"],
  SfObject: ["Object", "Objects"],
  SfField: ["Field", "Fields"],
  Profile: ["Profile", "Profiles"],
  PermissionSet: ["Permission Set", "Permission Sets"],
  ApexPage: ["Visualforce Page", "Visualforce Pages"],
  ApexComponent: ["Visualforce Component", "Visualforce Components"],
  WorkflowRule: ["Workflow Rule", "Workflow Rules"],
};

function typeLabel(type: string, count: number) {
  const [singular, plural] = TYPE_LABELS[type] || [type, `${type}s`];
  return count === 1 ? singular : plural;
}

function groupUsageByType(usedIn: UsageRef[]) {
  const counts = new Map<string, number>();
  for (const ref of usedIn) counts.set(ref.type, (counts.get(ref.type) || 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

const RISK_COLOR = { low: "#14854F", medium: "#EE9A12", high: "#D93A3F" } as const;

function deleteRiskFor(usedIn: UsageRef[]): { level: keyof typeof RISK_COLOR; label: string } {
  if (usedIn.length === 0) return { level: "low", label: "Low risk" };
  if (usedIn.length <= 2) return { level: "medium", label: "Medium risk" };
  return { level: "high", label: "High risk" };
}

function ExplainWithAi({ scanId, linkType, linkName }: { scanId: string; linkType: string; linkName: string }) {
  const explain = useMutation({
    mutationFn: () =>
      api
        .post<{ explanation: string }>(`/scans/${scanId}/explain-component`, { type: linkType, name: linkName })
        .then((r) => r.data),
  });

  if (explain.data) {
    return (
      <Typography variant="caption" sx={{ display: "block", mt: 1, fontStyle: "italic" }}>
        {explain.data.explanation}
      </Typography>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      <ButtonBase
        onClick={() => explain.mutate()}
        disabled={explain.isPending}
        sx={{ fontSize: 12, fontWeight: 700, color: "primary.main" }}
      >
        {explain.isPending ? "Asking AI…" : "Explain with AI"}
      </ButtonBase>
      {explain.isError && (
        <Typography variant="caption" color="error" sx={{ display: "block" }}>
          Couldn't get an explanation — try again.
        </Typography>
      )}
    </Box>
  );
}

function RefList({ label, refs }: { label: string; refs: UsageRef[] }) {
  if (refs.length === 0) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      {label}: {groupUsageByType(refs).map((g) => `${g.count} ${typeLabel(g.type, g.count)}`).join(", ")} —{" "}
      {refs.map((r) => `${r.name} (${r.type})`).join(", ")}
    </Typography>
  );
}

function AccessList({ access }: { access: AccessGrant[] }) {
  if (access.length === 0) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      Access: {access.map((a) => `${a.name} (${a.type} — ${a.level})`).join(", ")}
    </Typography>
  );
}

function UsageRow({
  name,
  usedIn,
  references = [],
  access = [],
  scanId,
  linkType,
  linkName,
  badge,
}: {
  name: string;
  usedIn: UsageRef[];
  references?: UsageRef[];
  access?: AccessGrant[];
  scanId: string;
  linkType: string;
  linkName: string;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const risk = deleteRiskFor(usedIn);
  return (
    <Box sx={{ borderBottom: "1px solid", borderColor: "divider", px: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <ButtonBase
          sx={{ flexGrow: 1, minWidth: 0, display: "flex", justifyContent: "flex-start", py: 1.25 }}
          onClick={() => setOpen((v) => !v)}
        >
          <Typography
            variant="body2"
            noWrap
            sx={{ minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}
          >
            {name}
          </Typography>
        </ButtonBase>
        {badge}
        <UsageChip usedIn={usedIn} />
        <OpenInSalesforceButton scanId={scanId} type={linkType} name={linkName} />
      </Box>
      <Collapse in={open}>
        <Box sx={{ pb: 1.5, borderLeft: "3px solid", borderLeftColor: RISK_COLOR[risk.level], pl: 1.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
            {risk.label}
          </Typography>
          {usedIn.length === 0 && references.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              No references found in scanned Apex, triggers, flows, or LWC — safe to delete.
            </Typography>
          )}
          <RefList label="Used in" refs={usedIn} />
          <RefList label="References" refs={references} />
          <AccessList access={access} />
          {open && <ExplainWithAi scanId={scanId} linkType={linkType} linkName={linkName} />}
        </Box>
      </Collapse>
    </Box>
  );
}

function ScrollableSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Paper sx={{ height: "100%" }}>
      <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle1">{title}</Typography>
        <Chip size="small" label={count} sx={{ bgcolor: "action.selected", fontWeight: 700 }} />
      </Box>
      <Divider />
      <Box sx={{ maxHeight: LIST_HEIGHT_PX, overflowY: "auto" }}>{children}</Box>
    </Paper>
  );
}

function countUsage<T extends { usedIn: UsageRef[] }>(items: T[]) {
  return { used: items.filter((i) => i.usedIn.length > 0).length, unused: items.filter((i) => i.usedIn.length === 0).length };
}

const FLOW_CATEGORY_ORDER = [
  "Screen Flow",
  "Record-Triggered Flow",
  "Scheduled-Triggered Flow",
  "Platform Event-Triggered Flow",
  "Autolaunched Flow",
];

const APEX_CATEGORY_ORDER = ["Batch Class", "Future Class", "Queueable Class", "Test Class", "Apex Class"];

function groupByCategory<T extends { category: string }>(items: T[], order: string[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) || []), item]);
  return order.map((category) => ({ category, items: groups.get(category) || [] })).filter((g) => g.items.length > 0);
}

function CategoryGroup<T extends { usedIn: UsageRef[]; references: UsageRef[] }>({
  category,
  items,
  scanId,
  linkType,
  rowKey,
  rowName,
  rowLinkName,
}: {
  category: string;
  items: T[];
  scanId: string;
  linkType: string;
  rowKey: (item: T) => string;
  rowName: (item: T) => string;
  rowLinkName: (item: T) => string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Box>
      <ButtonBase
        onClick={() => setOpen((v) => !v)}
        sx={{ width: "100%", justifyContent: "space-between", px: 2, py: 0.75, bgcolor: "action.hover" }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {category} ({items.length})
        </Typography>
        <Typography variant="caption">{open ? "▾" : "▸"}</Typography>
      </ButtonBase>
      <Collapse in={open}>
        {items.map((item) => (
          <UsageRow
            key={rowKey(item)}
            name={rowName(item)}
            usedIn={item.usedIn}
            references={item.references}
            scanId={scanId}
            linkType={linkType}
            linkName={rowLinkName(item)}
          />
        ))}
      </Collapse>
    </Box>
  );
}

export function ComponentsPage({ scanId, initialSearch }: { scanId: string; initialSearch?: string }) {
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [objectSearch, setObjectSearch] = useState(initialSearch || "");

  useEffect(() => {
    if (initialSearch) {
      setObjectSearch(initialSearch);
      setSelectedObject(null);
    }
  }, [initialSearch]);

  const usage = useQuery({
    queryKey: ["components", scanId],
    queryFn: () => api.get<ComponentUsage>(`/scans/${scanId}/components`).then((r) => r.data),
  });

  if (usage.isLoading) return <Typography sx={{ p: 4 }}>Loading...</Typography>;
  if (!usage.data) return <Typography sx={{ p: 4 }}>No component data yet.</Typography>;

  const allFields = usage.data.objects.flatMap((o) => o.fields);
  const chartData = [
    { name: "Objects", ...countUsage(usage.data.objects) },
    { name: "Fields", ...countUsage(allFields) },
    { name: "Classes", ...countUsage(usage.data.classes) },
    { name: "Triggers", ...countUsage(usage.data.triggers) },
    { name: "Flows", ...countUsage(usage.data.flows) },
    { name: "LWC", ...countUsage(usage.data.lwc) },
    { name: "VF Pages", ...countUsage(usage.data.visualforcePages) },
    { name: "VF Components", ...countUsage(usage.data.visualforceComponents) },
  ].map((d) => {
    const total = d.used + d.unused;
    return { ...d, total, usedPct: total ? (d.used / total) * 100 : 0, unusedPct: total ? (d.unused / total) * 100 : 0 };
  });

  const processBuilderFlows = usage.data.flows.filter((f) => f.category === "Process Builder");

  const objectSearchQuery = objectSearch.trim().toLowerCase();
  const filteredObjects = objectSearchQuery
    ? usage.data.objects.filter((o) => o.apiName.toLowerCase().includes(objectSearchQuery))
    : usage.data.objects;

  const activeObject =
    usage.data.objects.find((o) => o.apiName === selectedObject) || filteredObjects[0] || usage.data.objects[0];

  return (
    <Box sx={{ p: 4 }}>
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1">Used vs unused by type</Typography>
              <Stack direction="row" spacing={2.5}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: USED_COLOR }} />
                  <Typography variant="caption" color="text.secondary">Used</Typography>
                </Stack>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: UNUSED_COLOR }} />
                  <Typography variant="caption" color="text.secondary">Unused</Typography>
                </Stack>
              </Stack>
            </Stack>
            {chartData.map((d, i) => (
              <Box
                key={d.name}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(90px, 130px) minmax(0, 1fr) 130px",
                  alignItems: "center",
                  gap: 2.25,
                  py: 1.25,
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                }}
              >
                <Typography variant="body2">{d.name}</Typography>
                <Box sx={{ height: 8, borderRadius: 999, bgcolor: "#E9EDF2", overflow: "hidden" }}>
                  <Box
                    sx={{
                      height: "100%",
                      borderRadius: 999,
                      width: `${Math.max(d.usedPct, d.used > 0 ? 1.5 : 0)}%`,
                      bgcolor: USED_COLOR,
                    }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right" }}>
                  {d.used} of {d.total} used
                </Typography>
              </Box>
            ))}
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ mb: 3, display: "flex", height: LIST_HEIGHT + 98 }}>
        <Box sx={{ width: 320, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column" }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" gutterBottom>
              Objects ({usage.data.objects.length})
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder="Search objects…"
              value={objectSearch}
              onChange={(e) => setObjectSearch(e.target.value)}
            />
          </Box>
          <Divider />
          <List dense disablePadding sx={{ overflowY: "auto" }}>
            {filteredObjects.map((o) => (
              <ListItemButton
                key={o.apiName}
                selected={o.apiName === activeObject?.apiName}
                onClick={() => setSelectedObject(o.apiName)}
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
              >
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ minWidth: 0, flexGrow: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}
                >
                  {o.apiName}
                </Typography>
                <UsageChip usedIn={o.usedIn} />
                <OpenInSalesforceButton scanId={scanId} type="SfObject" name={o.apiName} />
              </ListItemButton>
            ))}
            {filteredObjects.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No objects match "{objectSearch}".
              </Typography>
            )}
          </List>
        </Box>

        <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" noWrap>
              {activeObject ? `${activeObject.apiName} — Fields (${activeObject.fields.length})` : "Fields"}
            </Typography>
          </Box>
          <Divider />
          <Box sx={{ overflowY: "auto", flexGrow: 1 }}>
            {activeObject?.fields.map((f) => (
              <UsageRow
                key={f.apiName}
                name={`${f.apiName} (${f.type})`}
                usedIn={f.usedIn}
                references={f.references}
                access={f.access}
                scanId={scanId}
                linkType="SfField"
                linkName={`${activeObject.apiName}.${f.apiName}`}
              />
            ))}
          </Box>
        </Box>
      </Paper>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <ScrollableSection title="Apex Classes" count={usage.data.classes.length}>
            {groupByCategory(usage.data.classes, APEX_CATEGORY_ORDER).map(({ category, items }) => (
              <CategoryGroup
                key={category}
                category={category}
                items={items}
                scanId={scanId}
                linkType="ApexClass"
                rowKey={(c) => c.name}
                rowName={(c) => c.name}
                rowLinkName={(c) => c.name}
              />
            ))}
          </ScrollableSection>
        </Grid>

        <Grid item xs={12} md={6}>
          <ScrollableSection title="Triggers" count={usage.data.triggers.length}>
            {usage.data.triggers.map((t) => (
              <UsageRow
                key={t.name}
                name={t.name}
                usedIn={t.usedIn}
                references={t.references}
                scanId={scanId}
                linkType="ApexTrigger"
                linkName={t.name}
              />
            ))}
          </ScrollableSection>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <ScrollableSection title="Flows" count={usage.data.flows.length}>
            {groupByCategory(usage.data.flows, FLOW_CATEGORY_ORDER).map(({ category, items }) => (
              <CategoryGroup
                key={category}
                category={category}
                items={items}
                scanId={scanId}
                linkType="Flow"
                rowKey={(f) => f.apiName}
                rowName={(f) => `${f.label} (${f.status})`}
                rowLinkName={(f) => f.apiName}
              />
            ))}
          </ScrollableSection>
        </Grid>

        <Grid item xs={12} md={6}>
          <ScrollableSection title="Lightning Web Components" count={usage.data.lwc.length}>
            {usage.data.lwc.map((l) => (
              <UsageRow
                key={l.apiName}
                name={l.apiName}
                usedIn={l.usedIn}
                references={l.references}
                scanId={scanId}
                linkType="LightningWebComponent"
                linkName={l.apiName}
              />
            ))}
          </ScrollableSection>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <ScrollableSection title="Workflow Rules" count={usage.data.workflowRules.length}>
            {usage.data.workflowRules.map((w) => (
              <UsageRow
                key={`${w.objectName}.${w.name}`}
                name={`${w.name} (${w.objectName})`}
                usedIn={w.usedIn}
                references={w.references}
                scanId={scanId}
                linkType="WorkflowRule"
                linkName={`${w.objectName}.${w.name}`}
                badge={
                  <Chip
                    size="small"
                    label={w.active ? "Active" : "Inactive"}
                    sx={w.active ? { bgcolor: "#E8F7EF", color: USED_COLOR, fontWeight: 700 } : { color: "text.secondary" }}
                    variant={w.active ? "filled" : "outlined"}
                  />
                }
              />
            ))}
          </ScrollableSection>
        </Grid>

        <Grid item xs={12} md={6}>
          <ScrollableSection title="Process Builder" count={processBuilderFlows.length}>
            {processBuilderFlows.map((f) => (
              <UsageRow
                key={f.apiName}
                name={`${f.label} (${f.status})`}
                usedIn={f.usedIn}
                references={f.references}
                scanId={scanId}
                linkType="Flow"
                linkName={f.apiName}
              />
            ))}
            {processBuilderFlows.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No Process Builder flows found.
              </Typography>
            )}
          </ScrollableSection>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <ScrollableSection title="Visualforce Pages" count={usage.data.visualforcePages.length}>
            {usage.data.visualforcePages.map((p) => (
              <UsageRow
                key={p.name}
                name={p.name}
                usedIn={p.usedIn}
                references={p.references}
                scanId={scanId}
                linkType="ApexPage"
                linkName={p.name}
              />
            ))}
          </ScrollableSection>
        </Grid>

        <Grid item xs={12} md={6}>
          <ScrollableSection title="Visualforce Components" count={usage.data.visualforceComponents.length}>
            {usage.data.visualforceComponents.map((c) => (
              <UsageRow
                key={c.name}
                name={c.name}
                usedIn={c.usedIn}
                references={c.references}
                scanId={scanId}
                linkType="ApexComponent"
                linkName={c.name}
              />
            ))}
          </ScrollableSection>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <ScrollableSection title="Email Templates" count={usage.data.emailTemplates.length}>
            {usage.data.emailTemplates.map((t) => (
              <Box
                key={t.developerName}
                sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {t.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t.templateType}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={t.isActive ? "Active" : "Inactive"}
                  sx={t.isActive ? { bgcolor: "#E8F7EF", color: USED_COLOR, fontWeight: 700 } : { color: "text.secondary" }}
                  variant={t.isActive ? "filled" : "outlined"}
                />
              </Box>
            ))}
            {usage.data.emailTemplates.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No email templates found.
              </Typography>
            )}
          </ScrollableSection>
        </Grid>

        <Grid item xs={12} md={6}>
          <ScrollableSection title="Installed Packages" count={usage.data.installedPackages.length}>
            {usage.data.installedPackages.map((p) => (
              <Box
                key={`${p.namespacePrefix}-${p.name}`}
                sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {p.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.namespacePrefix}
                  </Typography>
                </Box>
                {p.versionNumber && <Chip size="small" label={`v${p.versionNumber}`} sx={{ bgcolor: "action.selected" }} />}
              </Box>
            ))}
            {usage.data.installedPackages.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No managed/unlocked packages installed.
              </Typography>
            )}
          </ScrollableSection>
        </Grid>
      </Grid>
    </Box>
  );
}
