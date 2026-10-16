import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, AlertTitle, Box, Button, Chip, Dialog, IconButton, InputAdornment, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Typography } from "@mui/material";
import Close from "@mui/icons-material/Close";
import Search from "@mui/icons-material/Search";
import type { ConnectionDirection, ConnectionPage, ConnectionRow, GraphApi } from "./graphApi";
import {
  countText,
  DRILLDOWN_PAGE_SIZE,
  drilldownSubtitle,
  emptyStateCopy,
  ERROR_FALLBACK,
  ERROR_TITLE,
  nextSort,
  optionalColumns,
  SEARCH_DEBOUNCE_MS,
  SORT_NOTE,
  sortRows,
  type SortKey,
  type SortState,
} from "./drilldownModel";
import type { OpenResult } from "./openInSalesforce";

// The paged drill-down behind an Intelligence count (port of native oiIntelligenceDrilldown): a modal with
// server-side search and paging, client-side sorting of what is loaded, and per-row actions.

export type DrilldownSelection = {
  nodeKey: string;
  // Label of the node the counts belong to; the dialog title falls back to "Connections".
  anchorLabel: string | null;
  direction: ConnectionDirection;
  edgeTypeKey: string;
  relationshipLabel: string;
};

type Props = {
  api: GraphApi;
  connectionId: string;
  selection: DrilldownSelection;
  onClose: () => void;
  // Puts the row's component on the graph; absent when the host cannot.
  onShowOnGraph?: (row: ConnectionRow) => void;
  // Opens the row in Salesforce Setup; the result is shown inline (caveat or error).
  onOpenSetup?: (row: ConnectionRow) => Promise<OpenResult>;
};

const STATUS_COLOR: Record<string, "success" | "default" | "warning"> = { active: "success", inactive: "default", draft: "warning", obsolete: "default" };
const errorMessage = (e: unknown): string => (e instanceof Error && e.message ? e.message : ERROR_FALLBACK);

export function IntelligenceDrilldown({ api, connectionId, selection, onClose, onShowOnGraph, onOpenSetup }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [actionMessage, setActionMessage] = useState<{ severity: "info" | "error"; text: string } | null>(null);

  // A new search restarts paging from the first page; typing is debounced.
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const query = useInfiniteQuery<ConnectionPage, Error, { pages: ConnectionPage[] }, readonly unknown[], string | null>({
    queryKey: ["graph", "connections", connectionId, selection.nodeKey, selection.direction, selection.edgeTypeKey, term],
    initialPageParam: null,
    queryFn: ({ pageParam }) => api.connections(selection.nodeKey, { direction: selection.direction, edgeTypeKey: selection.edgeTypeKey, pageSize: DRILLDOWN_PAGE_SIZE, cursor: pageParam, q: term }),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    retry: false,
    gcTime: 0,
  });

  const pages = query.data?.pages ?? [];
  const loaded = useMemo(() => pages.flatMap((p) => p.rows), [pages]);
  const rows = useMemo(() => sortRows(loaded, sort), [loaded, sort]);
  const columns = useMemo(() => optionalColumns(loaded), [loaded]);
  const first = pages[0];
  const unavailable = first?.unavailableReason ?? null;
  const hasMore = pages.length > 0 && Boolean(pages[pages.length - 1].hasMore);
  const firstLoading = query.isPending;
  const loadingMore = query.isFetchingNextPage;

  const run = async (action: (() => Promise<OpenResult>) | undefined) => {
    if (!action) return;
    const result = await action();
    if (result.ok) setActionMessage(result.caveat ? { severity: "info", text: result.caveat } : null);
    else setActionMessage({ severity: "error", text: result.error });
  };

  const sortHeader = (key: SortKey, label: string) => (
    <TableCell sortDirection={sort?.key === key ? sort.dir : false}>
      <TableSortLabel active={sort?.key === key} direction={sort?.key === key ? sort.dir : "asc"} onClick={() => setSort((s) => nextSort(s, key))}>
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const empty = emptyStateCopy(Boolean(first?.isFiltered ?? term));
  const columnCount = 5 + (columns.status ? 1 : 0) + (columns.dataType ? 1 : 0) + (columns.references ? 1 : 0);

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth aria-labelledby="drilldown-title" slotProps={{ paper: { sx: { height: "min(80vh, 720px)" } } }}>
      <Box sx={{ bgcolor: "primary.main", color: "primary.contrastText", px: 3, py: 2, position: "relative", flexShrink: 0 }}>
        <IconButton aria-label="Close" onClick={onClose} size="small" sx={{ position: "absolute", top: 8, right: 8, color: "inherit" }}>
          <Close fontSize="small" />
        </IconButton>
        <Typography id="drilldown-title" variant="h6" component="h2" sx={{ pr: 4 }}>
          {selection.anchorLabel || "Connections"}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          {drilldownSubtitle(selection.direction, selection.relationshipLabel)}
        </Typography>
      </Box>

      <Box sx={{ px: 3, pt: 2, pb: 1, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", flexShrink: 0 }}>
        <TextField
          size="small"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or API name..."
          slotProps={{ htmlInput: { "aria-label": "Search by name or API name", maxLength: 200 }, input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
          sx={{ minWidth: 280, flexGrow: 1, maxWidth: 420 }}
        />
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {countText(firstLoading, first?.totalCount ?? 0, loaded.length, Boolean(first?.isFiltered))}
        </Typography>
        {hasMore && (
          <Typography variant="caption" color="text.secondary">
            {SORT_NOTE}
          </Typography>
        )}
      </Box>

      {actionMessage && (
        <Alert role="status" severity={actionMessage.severity} onClose={() => setActionMessage(null)} sx={{ mx: 3, mb: 1, flexShrink: 0 }}>
          {actionMessage.text}
        </Alert>
      )}

      <Box sx={{ px: 3, pb: 2, flexGrow: 1, minHeight: 0, overflow: "auto" }}>
        {firstLoading ? (
          <Box role="status" aria-label="Loading connections" sx={{ display: "grid", gap: 1 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} variant="rounded" height={32} />
            ))}
          </Box>
        ) : query.isError && pages.length === 0 ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void query.refetch()}>Retry</Button>}>
            <AlertTitle>{ERROR_TITLE}</AlertTitle>
            {errorMessage(query.error)}
          </Alert>
        ) : unavailable ? (
          <Alert severity="warning">
            <AlertTitle>Coverage incomplete</AlertTitle>
            {unavailable}
          </Alert>
        ) : rows.length === 0 ? (
          <Alert severity="info">
            <AlertTitle>{empty.title}</AlertTitle>
            {empty.message}
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {sortHeader("label", "Name")}
                  {sortHeader("apiName", "API Name")}
                  {sortHeader("typeLabel", "Type")}
                  <TableCell>Relationship</TableCell>
                  {columns.status && <TableCell>Status</TableCell>}
                  {columns.dataType && <TableCell>Data Type</TableCell>}
                  {columns.references && <TableCell>References</TableCell>}
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.nodeKey}`} hover>
                    <TableCell>{r.label}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>{r.apiName}</TableCell>
                    <TableCell>{r.typeLabel}</TableCell>
                    <TableCell>{r.roleLabel}</TableCell>
                    {columns.status && <TableCell>{r.status ? <Chip size="small" label={r.status} color={STATUS_COLOR[r.status] ?? "default"} variant="outlined" /> : null}</TableCell>}
                    {columns.dataType && <TableCell>{r.dataType}</TableCell>}
                    {columns.references && <TableCell>{r.referencedObject}</TableCell>}
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {onShowOnGraph && (
                        <Button size="small" onClick={() => onShowOnGraph(r)}>
                          Show on graph
                        </Button>
                      )}
                      {onOpenSetup && (
                        <Button size="small" onClick={() => void run(() => onOpenSetup(r))}>
                          Open in Setup
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {query.isError && (
                  <TableRow>
                    <TableCell colSpan={columnCount}>
                      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void query.fetchNextPage()}>Retry</Button>}>
                        <AlertTitle>{ERROR_TITLE}</AlertTitle>
                        {errorMessage(query.error)}
                      </Alert>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {hasMore && !query.isError && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <Button variant="outlined" onClick={() => void query.fetchNextPage()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
