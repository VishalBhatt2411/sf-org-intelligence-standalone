import { Router, type ErrorRequestHandler, type Request } from "express";
import { GraphInputError, GraphNotFoundError } from "../graph/errors";
import { HealthInputError, HealthNotFoundError } from "../health/errors";
import type { HealthService } from "../health/healthService";

export type HealthRouteDeps = { service: HealthService };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const cid = (req: Request): string => req.params.connectionId;

function findingId(req: Request): string {
  const id = req.params.id;
  if (!ID_PATTERN.test(id)) throw new HealthInputError("id is not valid");
  return id;
}

function query(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

function single(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HealthInputError(`${name} must be a single value`);
  return value;
}

// Mounted at /connections/:connectionId/health behind requireAuth. A session belongs to one
// connection, so any other connection id is answered as if it did not exist. Controllers stay thin:
// every rule lives in HealthService.
export function createHealthRouter({ service }: HealthRouteDeps): Router {
  const router = Router({ mergeParams: true });

  router.use((req, res, next) => {
    if (!req.auth || req.auth.connectionId !== cid(req)) return res.status(404).json({ error: "Not found" });
    next();
  });

  router.get("/summary", async (req, res) => {
    res.json(await service.summary(cid(req)));
  });

  router.get("/severity-registry", (_req, res) => {
    res.json(service.severityRegistry());
  });

  router.get("/trend", async (req, res) => {
    res.json({ points: await service.trend(cid(req), single(req, "section")) });
  });

  // ---- findings and remediation ----

  router.get("/findings", async (req, res) => {
    res.json(await service.listFindings(cid(req), query(req)));
  });

  router.get("/findings/:id/related", async (req, res) => {
    res.json({ findings: await service.related(cid(req), findingId(req)) });
  });

  router.get("/findings/:id/history", async (req, res) => {
    res.json({ events: await service.history(cid(req), findingId(req)) });
  });

  router.get("/findings/:id/navigate", async (req, res) => {
    res.json(await service.navigate(cid(req), findingId(req)));
  });

  router.get("/findings/:id", async (req, res) => {
    res.json(await service.finding(cid(req), findingId(req)));
  });

  router.patch("/findings/:id", async (req, res) => {
    res.json(await service.triage(cid(req), findingId(req), req.body, req.auth!.organizationId));
  });

  router.get("/remediation/summary", async (req, res) => {
    res.json(await service.remediationSummary(cid(req)));
  });

  router.get("/remediation/export", async (req, res) => {
    const { csv, total, truncated } = await service.remediationCsv(cid(req), query(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="org-health-remediation.csv"');
    res.setHeader("X-Total-Rows", String(total));
    res.setHeader("X-Truncated", String(truncated));
    res.send(csv);
  });

  router.get("/remediation", async (req, res) => {
    res.json(await service.listFindings(cid(req), query(req)));
  });

  // ---- runs ----

  router.post("/sync/:section", async (req, res) => {
    res.json(await service.sync(cid(req), service.assertSection(req.params.section)));
  });

  router.get("/data/run", async (req, res) => {
    res.json({ run: await service.dataRun(cid(req)) });
  });

  router.post("/data/run", async (req, res) => {
    const { run, started } = await service.startDataRun(cid(req));
    res.status(started ? 202 : 200).json({ run, started });
  });

  // ---- sections (last: the path segment is a parameter) ----

  router.get("/:section/drilldown", async (req, res) => {
    res.json(await service.drilldown(cid(req), service.assertSection(req.params.section), single(req, "metricKey")));
  });

  router.get("/:section", async (req, res) => {
    res.json(await service.section(cid(req), service.assertSection(req.params.section)));
  });

  const errors: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof HealthInputError || err instanceof GraphInputError) return res.status(400).json({ error: err.message });
    if (err instanceof HealthNotFoundError || err instanceof GraphNotFoundError) return res.status(404).json({ error: err.message });
    next(err);
  };
  router.use(errors);

  return router;
}
