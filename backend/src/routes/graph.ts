import { Router, type ErrorRequestHandler, type Request } from "express";
import { DetailService } from "../graph/detailService";
import { GraphInputError, GraphNotFoundError, NODE_KEY_PATTERN } from "../graph/errors";
import type { GraphReadRepository } from "../graph/graphReadRepository";
import type { GraphSource } from "../graph/graphSource";
import { ImpactService, type ImpactDirection } from "../graph/impactService";
import { SearchService } from "../graph/searchService";
import { TraversalService } from "../graph/traversalService";

export type GraphRouteDeps = {
  reader: GraphReadRepository;
  // Live Salesforce access for the one route that describes an object. Created per request.
  sourceFor: (connectionId: string) => Promise<GraphSource>;
};

const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const CHECKSUM = /^[0-9a-f]{64}$/;

function text(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new GraphInputError(`${name} must be a single value`);
  return value;
}

function integer(req: Request, name: string): number | undefined {
  const value = text(req, name);
  if (value === undefined || value === "") return undefined;
  if (!/^\d{1,6}$/.test(value)) throw new GraphInputError(`${name} must be a whole number`);
  return Number(value);
}

const cid = (req: Request): string => req.params.connectionId;

function nodeKey(req: Request): string {
  const key = req.params.nodeKey;
  if (!NODE_KEY_PATTERN.test(key)) throw new GraphInputError("nodeKey is not valid");
  return key;
}

// Mounted at /connections/:connectionId/graph behind requireAuth. A session belongs to one
// connection, so any other connection id is answered as if it did not exist.
export function createGraphRouter({ reader, sourceFor }: GraphRouteDeps): Router {
  const router = Router({ mergeParams: true });
  const search = new SearchService(reader);
  const traversal = new TraversalService(reader);
  const impact = new ImpactService(reader);
  const detail = new DetailService(reader);

  router.use((req, res, next) => {
    if (!req.auth || req.auth.connectionId !== cid(req)) return res.status(404).json({ error: "Not found" });
    next();
  });

  router.get("/search", async (req, res) => {
    res.json(await search.search(cid(req), text(req, "q") ?? "", integer(req, "limit")));
  });

  router.get("/browse", async (req, res) => {
    res.json(await search.browse(cid(req), text(req, "typeKey") ?? "", integer(req, "limit")));
  });

  router.get("/summary", async (req, res) => {
    res.json(await detail.summary(cid(req)));
  });

  router.get("/objects/:apiName/fields", async (req, res) => {
    const { apiName } = req.params;
    if (!API_NAME.test(apiName)) throw new GraphInputError("apiName is not valid");
    const { described } = await (await sourceFor(cid(req))).describe([apiName]);
    const object = described[0];
    if (!object) throw new GraphNotFoundError("Object not found or not accessible");
    res.json({
      apiName: object.name,
      fields: object.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, referenceTo: f.referenceTo, masterDetail: f.masterDetail })),
    });
  });

  router.get("/nodes/:nodeKey/expand", async (req, res) => {
    const known = (text(req, "known") ?? "").split(",").filter(Boolean);
    if (known.some((c) => !CHECKSUM.test(c))) throw new GraphInputError("known must be a comma-separated list of checksums");
    const result = await traversal.expand(cid(req), nodeKey(req), { hops: integer(req, "hops"), cursor: text(req, "cursor"), limit: integer(req, "limit"), known });
    if (!result) throw new GraphNotFoundError("Node not found");
    res.json(result);
  });

  router.get("/nodes/:nodeKey/impact", async (req, res) => {
    const direction = text(req, "direction") ?? "downstream";
    if (direction !== "downstream" && direction !== "upstream") throw new GraphInputError("direction must be downstream or upstream");
    const result = await impact.analyze(cid(req), nodeKey(req), { direction: direction as ImpactDirection, depth: integer(req, "depth") });
    if (!result) throw new GraphNotFoundError("Node not found");
    res.json(result);
  });

  router.get("/nodes/:nodeKey", async (req, res) => {
    res.json(await detail.nodeDetail(cid(req), nodeKey(req)));
  });

  const errors: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof GraphInputError) return res.status(400).json({ error: err.message });
    if (err instanceof GraphNotFoundError) return res.status(404).json({ error: err.message });
    next(err);
  };
  router.use(errors);

  return router;
}
