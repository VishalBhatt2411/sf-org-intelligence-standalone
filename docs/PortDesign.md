# Port Design: Org Intelligence (Graph Explorer + Org Health) to the standalone app

Status: DRAFT for review. Derived from four source investigations (Explorer UI, graph core and scanners,
Org Health, integration map of this repo).
Source: the Salesforce-native Org Intelligence project (Apex/LWC). Target: this repo
(Express + TypeScript, Prisma/PostgreSQL, jsforce, React 18 + MUI + React Query).

## 1. Scope

In: Graph Explorer (Object / Field / Record-free first cut), search, impact analysis, Org Health.
Out for now: Hierarchy Manager (deferred), Tech Debt (the app already has its own), Record analysis mode
(needs live record queries; revisit after Object and Field modes ship).

## 2. What carries over and what is dropped

Carried over: node/edge model, node keys, checksum-diff upserts, retire detection, scan scope rules,
BFS expansion, directional impact traversal, cycle detection, prefix search, hub clustering (UI side).

Dropped because they only exist to work around the Apex runtime: queueable chains, batchables, governor caps,
Big Object archival, Platform Cache, USER_MODE/permission checks (replaced by the app's own auth),
Named Credential self-callout (use jsforce Tooling directly), platform events (use polling or SSE).

## 3. Decisions that change the source design

1. **One live graph per connection, not versioned rows.** The Apex graph keeps a version row per change
   (`versionKey = nodeKey::vN`, `isCurrent`). Nothing in the UI reads history, and it exists mainly for
   Salesforce storage reasons. Here: one row per node and edge per connection, with `checksum`, `state`
   (Active | Stale), `firstSeenScanId`, `lastSeenScanId`. Smaller, simpler queries, no `isCurrent` filter.
   Trade-off: no per-node history. Org Health trends come from a separate snapshot table instead.
2. **Edge checksums include attributes.** The Apex builder passes a null edge checksum, so changed edge
   attributes (`grantedPermissions`, `triggerEvents`) never update. Fixed here by hashing attributes.
3. **Confidence is a real column on edges** (Exact | Parsed | Heuristic). The Apex code has none; the
   specs require it. Mapping:
   - Exact: HAS_FIELD, LOOKUP_TO, MASTER_DETAIL_TO, VALIDATES, APPLIES_TO, GRANTS_ACCESS_TO,
     flow EXECUTES_ON, and anything from Tooling `MetadataComponentDependency`.
   - Parsed: trigger EXECUTES_ON resolved from the trigger body.
   - Heuristic: Apex class/trigger REFERENCES found by token matching.
4. **Field-impact edges are new work, not a port.** The Apex app never built Apex/Flow/Validation/Formula/
   Permission/Report -> Field edges. This repo already stores `ComponentDependency` rows from
   `MetadataComponentDependency`, so the graph builder derives them from that table and marks them Exact.
   FieldPermissions and Report column usage stay out of the first cut and are listed in the coverage caveat.
5. **Fields become nodes on demand.** Only fields that are relationship fields, or are referenced by a
   dependency edge, are materialised as nodes. Object nodes carry `fieldCount`. The full field list for a
   selected object comes from a live describe, as in the source app.
6. **Scan data is too thin today.** `SfField` has no relationship name and no master-detail flag, and
   `SfObject` has no flags. A new `graph` scan stage re-describes in-scope objects and writes the graph
   directly, rather than widening every existing table.

## 4. Data model (Prisma, additive migration)

```prisma
model GraphNode {
  id              String   @id @default(uuid())
  connectionId    String   @map("connection_id")
  nodeKey         String   @map("node_key")      // sha256(typeKey::namespace::fqn)
  typeKey         String   @map("type_key")      // e.g. SalesforceMetadata.CustomObject
  label           String
  fqn             String
  namespace       String?
  parentKey       String?  @map("parent_key")
  attributes      Json
  checksum        String
  state           String   @default("active")    // active | stale
  firstSeenScanId String   @map("first_seen_scan_id")
  lastSeenScanId  String   @map("last_seen_scan_id")

  @@unique([connectionId, nodeKey])
  @@index([connectionId, typeKey])
  @@map("graph_nodes")
}

model GraphEdge {
  id              String   @id @default(uuid())
  connectionId    String   @map("connection_id")
  edgeKey         String   @map("edge_key")      // sha256(source::edgeType::target)
  typeKey         String   @map("type_key")
  sourceNodeKey   String   @map("source_node_key")
  targetNodeKey   String   @map("target_node_key")
  confidence      String                          // exact | parsed | heuristic
  attributes      Json
  checksum        String
  state           String   @default("active")
  firstSeenScanId String   @map("first_seen_scan_id")
  lastSeenScanId  String   @map("last_seen_scan_id")

  @@unique([connectionId, edgeKey])
  @@index([connectionId, sourceNodeKey])
  @@index([connectionId, targetNodeKey])
  @@map("graph_edges")
}
```

Raw SQL in the migration: `text_pattern_ops` indexes on lower(label) and lower(fqn) with a partial
`WHERE state = 'active'` for prefix search. Scan coverage is recorded per stage on the existing `ScanResult`
(add `coverage` and `coverageDetail` columns: complete | partial | degraded).

## 5. Backend layout (layered, as in CLAUDE.md)

| Layer | Module | Responsibility |
|---|---|---|
| Domain | `graph/keys.ts`, `graph/checksum.ts`, `graph/nodeTypes.ts` | keys, hashing, static node/edge presentation registry |
| Scan | `graph/scanners/*` | one scanner per kind, each returns `{ nodes, edges, coverage, isFullSnapshot }` |
| Scope | `graph/scope.ts` | object/namespace scope rules and settings |
| Build | `graph/graphBuilder.ts` | checksum-diff upsert of nodes then edges, then retire (full snapshots only), in one transaction |
| Read | `graph/graphRepository.ts` | all Prisma access to the graph tables |
| Services | `graph/traversalService.ts`, `impactService.ts`, `searchService.ts` | BFS expansion, directional impact, cycle detection, search |
| API | `routes/graph.ts` | thin handlers, auth, validation |

The graph builder is the only code that creates nodes and edges; the frontend never builds relationships.

### Scan stage order

objects -> relationship fields -> Apex classes -> triggers -> flows -> permission sets -> validation rules ->
workflow rules -> email alerts -> approval processes -> sharing rules -> dependency edges.
Objects and fields come first so edge targets exist. A stage failure sets coverage to `degraded` and the scan
status to `completed_with_errors`; it is never swallowed as `itemCount: 0`. Retire detection for a type runs
only after a successful full snapshot of that type.

### Scope rules (from ADR-0031, defaults kept)

Skip non-queryable objects and suffixes `__mdt __e __b __x History Share Feed ChangeEvent`. Include custom
objects in the org namespace, foreign-namespace objects only if `scanManagedPackageObjects`, and standard
objects only if they have at least one custom field (or are on a configurable allow-list seeded with the 20
shipped standard objects). Settings live in a per-connection `GraphSettings` JSON column, not custom metadata.

## 6. API

All routes sit under `/api/connections/:connectionId/graph`, behind `requireAuth`.

| Route | Purpose |
|---|---|
| `GET /search?q=&limit=` | prefix match on label or fqn, min length 2 |
| `GET /browse?typeKey=&limit=` | active nodes by type, ordered by label |
| `GET /nodes/:nodeKey/expand?hops=&cursor=&known=` | undirected BFS ring by ring, keyset-paginated; `known` is client checksum delta |
| `GET /nodes/:nodeKey/impact?direction=&depth=` | directional impact with hop distance, cycle flag, coverage caveat |
| `GET /nodes/:nodeKey` | node detail and edge summary (includes `viaField`, `confidence`) |
| `GET /objects/:apiName/fields` | live describe field list |
| `GET /summary` | counts by type and edge type, scan coverage |

Limits: hop depth clamped to 3 (default 1), expansion cap 500 nodes, impact depth clamped to 3, impact cap
150 nodes. Impact follows REFERENCES, EXECUTES_ON, GRANTS_ACCESS_TO and the new field-dependency edge type
(`DEPENDS_ON`); structural edges (HAS_FIELD, LOOKUP_TO, MASTER_DETAIL_TO, APPLIES_TO, VALIDATES) are not
followed. The impact cache from Apex is dropped; compute on demand first and add an in-process LRU keyed on
`nodeKey:direction:depth:rootChecksum` only if profiling asks for it.

## 7. Frontend

New "Explorer" tab in `App.tsx` (Tab type, `NAV_ITEMS`, `PAGE_TITLE`, render switch). Ports:

- view-state reducer with reference-counted visibility (collapse must not remove nodes supported by another
  branch; includes a diamond-graph test)
- lane layout (object mode) and the radial layout (field mode), written as pure functions with unit tests
- hub clustering: more than 8 same-type, same-parent nodes at ring 1+ collapse into one synthetic card
- detail/intelligence panel, search box with keyboard navigation, breadcrumbs, mini-map, dark mode via the
  existing `theme.ts`
- design tokens ported to MUI theme extensions; node/edge styles from the presentation registry

No layout library is added. Some Explorer sources (canvas layout, lane routing, panel markup) have not been
read in detail yet and are read at implementation time.

## 8. Org Health

### 8.1 Model

Seven sections, each scored independently (there is no composite org score). Every metric is labelled
**Scan-derived** (graph/scan tables), **Live Salesforce** (jsforce query) or **Calculated heuristic**.

| Section | Source | Scored | Notes |
|---|---|---|---|
| Overview | scan-derived | no | counts of objects, fields, classes, triggers, flows, permission sets, dependency edges, all edges; last scan time |
| Metadata | scan-derived + live classification | yes | per-object signals: high custom-field count, high relationship degree, no incoming references |
| Automation | scan-derived | no (facts only) | per trigger/flow: fan-in/out via REFERENCES, dependency cycles, most automated object |
| Code | scan + live | yes | per Apex class: high dependency, old API version, cycles |
| Security | live | no (facts only) | permission sets/profiles: elevated permissions, broad object grants, sensitive-object grants |
| Data | live, sampled, async | yes | per object (Account, Case, Contact, Lead, Opportunity by default): stale, incomplete, duplicate rates |
| Storage | live | no | data and file storage from the REST `/limits` resource (used = Max - Remaining) |

Sections are rows in a static TS config (key, label, order, scored, async, row ceiling), not custom metadata.
An unknown section returns `isImplemented: false`.

### 8.2 Scoring engine (pure TS, `health/scoring.ts`)

contribution = weight x min(magnitude, 1.5) / 1.5 x clamp(confidence, 0..1) x impactMultiplier x
exposureMultiplier x (0.5 if a compensating control is recorded). Signals sharing a correlation group combine
by MAX; badness = clamp(sum of group winners, 0..100), one decimal, half-up; health = 100 - badness.
Severity: Good >= 70, Warning >= 40, Critical below 40. **Half-open intervals** (the source has a gap between
39.9 and 40 that resolves to no severity). An empty signal list is health 100, Good. Every score carries
`formulaSummary`, `formulaComponents` and the top contributors.

Thresholds and weights (Metadata 60/25 fields/degree, 35/35/30 weights; Code 20 dependencies / API 55,
weights 55/45; Automation 10; Security 1; Data stale 15%, incomplete 10%, duplicate 5%, weights 35/35/30) live
in one `health/config.ts` and can later be overridden per connection.

Section score formulas are ported as written: for example Metadata =
100 - [(high-fields/total) x 35 + (high-degree/total) x 35 + (orphans/total) x 30], rounded, clamped.

### 8.3 Deliberate deviations from the source

1. The Metadata high-field-count **exposure boost compares relationship degree against the field threshold
   (60)**, which is almost never reached. Fixed to use the degree threshold (25); covered by a test and noted
   in the code. (Open question 3 below.)
2. Severity bands are half-open (section 8.2).
3. Orphan objects that are Managed-package objects are **excluded** from the orphan KPI and score, so the KPI
   agrees with the finding severity (the source counts them while rating their finding Good).
4. Cycle detection runs over the same graph tables using a strongly-connected-components pass, not a
   per-request DFS over Apex collections.
5. No Salesforce custom permissions. See 8.5.

### 8.4 Findings and remediation workflow

New tables (named `OrgHealthFinding*` so they cannot be confused with the existing Tech Debt `Finding`):

- `OrgHealthFinding`: `fingerprint` unique per connection (sha256 of section::rule::componentKey), section,
  rule id and version, title, severity, rank, score, explanation, contributors JSON, confidence, component
  key/type/label, namespace, isManaged, evidence, measured/expected, explanation, risk, impact, remediation,
  validation steps, first/last detected, compute run id, and the lifecycle fields: status (open,
  acknowledged, in_progress, risk_accepted, resolved, false_positive), owner, due date, notes, compensating
  control, resolution evidence, resolved date, risk-acceptance expiry, false-positive justification.
- `OrgHealthFindingEvent`: append-only audit rows (field, old, new, actor, time) for status, owner, due date.
- `OrgHealthSnapshot`: append-only per section per run (score, result JSON, coverage, rows examined,
  truncated, run id, triggered by). Adds the trend that the source never built, drawn with Recharts.
- `OrgHealthRun`: async job state for Data Health (queued, processing, completed, failed) replacing
  AsyncApexJob lookup. The run executes in-process after the request returns; the UI polls every 5 s.

Sync rules (as in the source): upsert by fingerprint, refreshing detection fields only; a `resolved` finding
that is detected again reopens with an evidence note; `risk_accepted` and `false_positive` never reopen;
findings absent from a run auto-resolve (except false positives) and are never deleted. Duplicate fingerprints
inside one batch collapse to the last. Sync for scan-derived sections (Metadata, Automation, Code) runs
automatically at the end of a successful scan; Security and Data sync on demand and at the end of a Data run.

Finding rules ported: MetadataHealth.HighFieldCount / HighDegree / NoIncomingReferences,
AutomationHealth.HighDependency / DependencyCycle, CodeHealth.HighDependency / OldApiVersion / DependencyCycle,
SecurityHealth.ElevatedPermissions / BroadObjectGrant / SensitiveObjectGrant, DataHealth.StaleRecords /
Completeness / Duplicates.

### 8.5 Access control

The standalone app only has `requireAuth` (authenticated user of the connection's organization) and no roles.
v1: any authenticated user of that organization can view, sync and triage; every query is scoped by
`connectionId` with an ownership check against the caller's organization. A role model (viewer / operator /
triager) is a later enhancement.

### 8.6 Live-query safety

Security and Data Health queries use bounded ceilings (500 rows by default, 1000 for objects) and report
`truncated` plus a coverage note. Salesforce REST/Tooling queries paginate. Missing fields or objects mark
the section degraded and are listed under "skipped", never zero-filled. Storage values missing from the limits
response go to `unavailableMetrics`.

### 8.7 API (under `/api/connections/:connectionId/health`)

`GET /summary`, `GET /overview`, `GET /storage`, `GET /{metadata|automation|code|security|data}` (detail),
`GET /metadata/drilldown?metricKey=`, `GET /severity-registry`,
`GET /findings?section=`, `GET /findings/:id`, `GET /findings/:id/related`, `GET /findings/:id/history`,
`GET /findings/:id/navigate` (maps to an Explorer node), `PATCH /findings/:id` (triage),
`GET /remediation` (filters: sections, severities, statuses, owner, search text, expiring risk acceptance,
overdue; sort: severity default, status, dates, score, title; page size 25, max 100, max offset 2000),
`GET /remediation/summary`, `GET /remediation/export` (capped at 2000 rows),
`POST /sync/:section`, `POST /data/run`, `GET /data/run` (status), `GET /trend?section=`.

### 8.8 UI

New "Org Health" tab. Component port: dashboard shell with section tab strip and severity dots; overview KPI
strip and category cards (score ring or "Facts only" badge); score ring; severity badge (always text plus
colour); KPI tile (clickable only with a metricKey); formula disclosure; breakdown list; heatmap grid;
glossary; shared state banner (zero, incomplete, not run, not obtainable, failed with section-scoped retry);
finding drawer (evidence, contributors, triage form, related, history); live-insight panel; remediation table
with filters, sort, paging and CSV export (formula-injection guard: prefix `= + - @` with a quote).
Severity colours are fixed tokens, not MUI success/warning/error: good #2e844a/#45c65a, warning
#b95000/#f0a020, critical #ba0517/#fe8aa7 (light/dark), with washes. Breakpoints 1280/1024/768. Charts use
Recharts only for the trend view.

### 8.9 Not in v1

Test-coverage in Code Health (the source never built it), field-level security and Health Check score in
Security, native duplicate-rule integration in Data Health, Hierarchy Manager.

## 9. Tests

Vitest. Backend: key/checksum determinism, builder (new, unchanged, changed attribute, retire, no retire on
partial snapshot), scope rules, BFS bounds and pagination, directional impact, cycle detection, search,
bulk (thousands of nodes), and connection isolation (one connection can never read another's graph).
Frontend: reducer, both layouts, clustering, search keyboard handling.

## 10. Build order and commits

1. Prisma migration + domain modules + tests
2. Scanners + builder + `graph` scan stage + tests
3. Traversal, impact, search services + routes + tests
4. Explorer UI: reducer, layouts, canvas, panel, search
5. Org Health backend, then UI
6. README and docs update

One commit per step.

## 11. Risks

- Dependency data may be incomplete (edges to standard objects are missing from `ComponentDependency`);
  the coverage caveat must say so, and the graph stage should resolve those from the describe.
- Queries must paginate past 2000 rows (jsforce `queryMore`/`autoFetch`) or large orgs are silently truncated.
- Apex token matching is heuristic (simple names only); it is labelled as such in the UI.
- A graph per connection grows with org size; the node cap, lazy expansion and scope rules bound reads, and a
  prune job for stale nodes (older than N scans) bounds writes.

## 12. Open questions

- Per-connection live graph (recommended) versus per-scan snapshots. Per-scan matches the existing tables but
  multiplies storage and complicates search and Org Health trends.
- Record analysis mode: include later, or not at all in the standalone app?
- Org Health: confirm the exposure-boost fix and the managed-orphan exclusion (section 8.3), or keep the
  source behaviour exactly.
- Org Health access control: open to any authenticated user of the organization in v1 (section 8.5)?
