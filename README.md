# Salesforce Technical Debt AI — V1

Connect a Salesforce org, scan its metadata, run rule-based technical debt checks, and get an AI (Claude) explanation + fix recommendation per finding.

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

## Known simplifications (by design, not oversights)

- **SOQL/DML-in-loop and complexity checks are regex/brace-depth heuristics**, not a real Apex AST parser — good enough to flag likely issues, will have false negatives on unusual formatting.
- **Unused field/object detection is a substring search** across scanned Apex/trigger/flow text, not a full dependency graph — the Knowledge Graph / Impact Analysis module (Phase 2/6 in the FRD) isn't built yet.
- **Object scan is limited to custom objects + a small standard-object allowlist** to avoid hundreds of describe calls per scan; widen the allowlist in `backend/src/services/scanEngine.ts` if you need full org coverage.
- **Single-organization, not multi-tenant** — there's a real login now (see "Auth" above), but every user shares the one `Organization` row and its one Salesforce connection; there's no per-customer data isolation or signup flow.
- **Empty-field and validation-rule checks are skipped** — empty-field detection needs live record data (aggregate queries per field), not just metadata; validation rules aren't in the FRD's storage schema.
- **Connected App auto-setup requires "Customize Application" permission** on the target org (standard on System Administrator) and will fail on orgs where Salesforce has disabled Connected App creation entirely (a per-org platform restriction, not something any tool can work around).
- **The auto-setup only works locally** — it works by spawning a CLI login on the same machine as the backend. A real deployed/hosted version of this tool would need each org's admin to install a published Connected App the normal way instead; this shortcut is specific to running everything on your own machine.

## Roadmap (per FRD)

V2 adds Impact Analysis, Automation Dependency Maps, and PDF reports. V3 adds AI Chat, Documentation Generator, and Root Cause Analysis — these need the Knowledge Graph module, which this pass doesn't build.
