# Salesforce Technical Debt AI — V1

Connect a Salesforce org, scan its metadata, run rule-based technical debt checks, and get an AI (Claude) explanation + fix recommendation per finding. It also carries a ported subset of the Org Intelligence Platform: a **Graph Explorer** and **Org Health** (see below).

## Stack

- **Backend**: Node + Express + TypeScript, Prisma + PostgreSQL, jsforce (Salesforce REST/Tooling/Metadata API), Anthropic SDK
- **Frontend**: React + Vite + TypeScript, MUI, React Query, Recharts

## Setup

1. **Postgres**: create a database and set `DATABASE_URL` in `backend/.env` (copy from `backend/.env.example`).
2. **Claude**: put an `ANTHROPIC_API_KEY` in `backend/.env`.
3. **Frontend env**: copy `frontend/.env.example` to `frontend/.env`.
4. **Secrets**: generate `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` for `backend/.env` — these sign login sessions and encrypt stored Salesforce tokens at rest:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
5. Install deps, generate the Prisma client, and run migrations:
   ```
   npm install
   npm run db:migrate
   ```
6. **Create a login user** (the app now requires signing in — see "Auth" below):
   ```
   npm run create-admin -w backend -- --email you@company.com --password "..." --name "You"
   ```
7. **Salesforce CLI**: install the free [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf --version` should work in a terminal). Nothing else to configure — no manual "New Connected App" form, no manual secret copy-paste.
8. Run both apps (two terminals):
   ```
   npm run dev:backend
   npm run dev:frontend
   ```
9. Open `http://localhost:5173`, sign in with the user from step 6, then click **Sandbox** or **Production**. The first time for a given environment:
   - The backend spawns `sf org login web` itself, which pops a browser window for you to log into that org normally (username/password, whatever your org requires).
   - Once that finishes, the backend creates this app's own Connected App via the Metadata API (self-generating a Client ID/Secret — nobody ever sees or types them) and saves it to `backend/.env`.
   - You're then sent to Salesforce's own "Allow access?" consent screen for the new app. Click Allow.
   - You land back on the dashboard, connected. Every later click for that same environment skips straight to that consent screen (no re-login needed).

   A Connected App lives inside one specific org, so sandbox and production each get their own — that's a Salesforce platform rule, not a limitation of this app. Note: **this automation only works because the backend and your browser are on the same machine** (a local dev tool). It won't work once this is deployed somewhere else — see "Deployment" below. Also, some orgs (seen on certain sandboxes) have Connected App creation disabled entirely by Salesforce; if you hit "You can't create a connected app... contact Salesforce Customer Support," that's an org-level restriction no tool can bypass — try a different org or ask your Salesforce admin/Support to enable it.
10. Click **Run Scan**.

## Auth

The app requires signing in (`backend/src/routes/auth.ts`, `POST /auth/login`) — a JWT in an httpOnly cookie, checked by `requireAuth` middleware on every route except `/health` and `/auth/login`. There's still a single shared Organization behind the scenes (see "Known simplifications"), but every user needs their own login now instead of the API being wide open. Create users with `npm run create-admin -w backend -- --email ... --password ...` (re-run with the same email to reset a password). Salesforce access/refresh tokens are encrypted at rest (`backend/src/services/crypto.ts`, AES-256-GCM, keyed by `TOKEN_ENCRYPTION_KEY`) rather than stored in plaintext.

## Deployment

- **Env vars**: see `backend/.env.example` / `frontend/.env.example`. Set `NODE_ENV=production` on the backend — this disables the local `sf`-CLI Connected App auto-setup (it needs a browser + CLI on the same machine as the backend, so it silently can't work on a real server) and requires `SF_SANDBOX_CLIENT_ID`/`SECRET` and/or `SF_PROD_CLIENT_ID`/`SECRET` to already be set, from a Connected App created once via Salesforce Setup (or by running the local auto-setup once and copying its output).
- **Migrations**: run `npm run prisma:migrate:deploy -w backend` (not `prisma:migrate`, which is dev-only and can prompt) before starting the server. The Docker image runs this automatically on boot.
- **Docker**: `docker compose up --build` builds and runs Postgres + backend + frontend (nginx) together. Set `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, and the Salesforce/AI env vars in your shell or an `.env` file before running (see `docker-compose.yml` for the full list).
- **CI**: `.github/workflows/ci.yml` type-checks and builds both workspaces and runs the backend test suite on every push/PR.
- **Upgrading an existing deployment** that predates token encryption: run `npm run encrypt-existing-tokens -w backend` once after setting `TOKEN_ENCRYPTION_KEY` — it encrypts any connections still storing plaintext tokens in place (safe to re-run).

## What's actually implemented in this pass

- Login-gated app (JWT session cookie) in front of a single shared Salesforce connection, with a sandbox/production picker for that connection
- Fully automated Connected App provisioning (`backend/src/services/connectedAppSetup.ts`), triggered by the Connect button itself — spawns `sf org login web`, then self-generates a Client ID/Secret via the Metadata API instead of the manual Setup UI flow
- Metadata scan: custom objects + a handful of standard objects (Account/Contact/Opportunity/Lead/Case), Apex classes, triggers, flows (via Metadata API), profiles, permission sets
- Debt checks: SOQL/DML-in-loop, hardcoded IDs, large classes, high branch complexity, inactive/duplicate flows, automation sprawl, multiple triggers per object, trigger/flow conflicts, large objects, over-permissioned profiles/permission sets, guest user write access, broad field-edit access, unused fields/objects, likely-duplicate fields
- Health score (100 minus severity-weighted deductions, per category + overall)
- AI "Explain" button per finding (Claude call, cached in `ai_recommendations`)
- Graph Explorer and Org Health tabs (see the section above)

## Graph Explorer and Org Health (ported from Org Intelligence)

Two tabs ported from the Salesforce-native Org Intelligence Platform. Design, scope and the reasons for each
change from the source are in `docs/PortDesign.md`. Hierarchy Manager is deferred, and the source's Tech Debt
module is not ported because this app has its own.

The Graph Explorer follows the native layout and behaviour (directional relationship canvas, Intelligence Panel,
connector detail dialog) in this app's own theme, and has three lenses: Object, Field and Record. Record mode
picks an object, then one of its records, and draws its parent and child records live from the org; nothing
about the records is stored.

**How it is fed.** Every scan now also builds a per-connection metadata graph (nodes and edges in Postgres, see
the `Graph*` models and the `add_org_health` migration), then refreshes the scan-based Org Health sections.
Neither stage can fail the scan outright: a graph failure marks the scan `completed_with_errors`, and a health
failure is only logged. Run `npm run db:migrate` after pulling to create the new tables.

**Graph Explorer** (`frontend/src/explorer`, `backend/src/graph`): search, expand/collapse with reference-counted
visibility, lane (object) and radial (field) layouts, hub clustering, mini-map, breadcrumbs, dark mode, a detail
panel and directional impact analysis. The graph is read lazily (expansion capped at 500 nodes, impact at 150).

**Org Health** (`frontend/src/health`, `backend/src/health`): Metadata, Code and Data are scored; Automation and
Security show facts; Storage reports limits. Scan-based sections update with each scan or on **Refresh**;
Security and Storage read Salesforce live; the **Data check** runs in the background and is polled. Findings
carry evidence, risk, remediation and a score breakdown, and can be triaged (status, owner, due date, notes,
compensating control, risk-acceptance expiry, false-positive reason) with a change history. The Remediation tab
filters, sorts, pages and exports the queue as CSV. "Open in Graph Explorer" jumps from a finding to its node.

API (all behind `requireAuth`, scoped to the session's connection; any other connection id answers 404):

| Prefix | Routes |
|---|---|
| `/connections/:connectionId/graph` | `search`, `browse`, `summary`, `objects/:apiName/fields`, `nodes/:key`, `nodes/:key/expand`, `nodes/:key/impact` |
| `/connections/:connectionId/health` | `summary`, `severity-registry`, `trend`, `:section`, `:section/drilldown`, `sync/:section`, `data/run`, `findings`, `findings/:id` (+ `related`, `history`, `navigate`, `PATCH`), `remediation`, `remediation/summary`, `remediation/export` |

Behaviour worth knowing:

- Scores are computed on the server; the UI only displays them. Severity bands are Good >= 70, Warning >= 40,
  Critical < 40, and every badge carries text as well as colour.
- A live section nobody has run shows "Not run yet"; a partial or unreadable result is flagged and its findings
  are never auto-resolved on an incomplete run.
- Thresholds (dependency counts, field counts, data objects, sensitive objects, and so on) are defaults in
  `HealthConfig` (`backend/src/health/config.ts`). There is no admin screen for them yet.
- The Data check runs inside the backend process, one per connection at a time. It is not safe across multiple
  backend instances.
- Org Health is open to any authenticated user of the organization. The change history records the organization
  id as the actor because the standalone app has no per-user id.

**Not verified against a live org.** Everything is covered by unit tests with fakes for Salesforce. The Tooling
and SOQL field names used by Security, Data and Storage (PermissionSet `Permissions*` fields, `ObjectPermissions`,
`PermissionSetAssignment` aggregates, the `/limits` resource) have not been run against a real org, and the
frontend has pure-function tests but no DOM tests. Expect to correct field names on first contact.

Not in v1: test coverage in Code Health, field-level security and the Health Check score in Security, native
duplicate-rule integration in Data Health, Hierarchy Manager.

## Known simplifications (by design, not oversights)

- **SOQL/DML-in-loop and complexity checks are regex/brace-depth heuristics**, not a real Apex AST parser — good enough to flag likely issues, will have false negatives on unusual formatting.
- **Unused field/object detection is still a substring search** across scanned Apex/trigger/flow text. The Graph Explorer now holds a dependency graph, but the debt checks do not use it yet.
- **Object scan is limited to custom objects + a small standard-object allowlist** to avoid hundreds of describe calls per scan; widen the allowlist in `backend/src/services/scanEngine.ts` if you need full org coverage.
- **Single-organization, not multi-tenant** — there's a real login now (see "Auth" above), but every user shares the one `Organization` row and its one Salesforce connection; there's no per-customer data isolation or signup flow.
- **Empty-field and validation-rule checks are skipped** — empty-field detection needs live record data (aggregate queries per field), not just metadata; validation rules aren't in the FRD's storage schema.
- **Connected App auto-setup requires "Customize Application" permission** on the target org (standard on System Administrator) and will fail on orgs where Salesforce has disabled Connected App creation entirely (a per-org platform restriction, not something any tool can work around).
- **The auto-setup only works locally** — it works by spawning a CLI login on the same machine as the backend. A real deployed/hosted version of this tool would need each org's admin to install a published Connected App the normal way instead; this shortcut is specific to running everything on your own machine.

## Roadmap (per FRD)

V2 adds Automation Dependency Maps and PDF reports (basic Impact Analysis now exists in the Graph Explorer). V3 adds AI Chat, Documentation Generator, and Root Cause Analysis, which can build on the graph.
