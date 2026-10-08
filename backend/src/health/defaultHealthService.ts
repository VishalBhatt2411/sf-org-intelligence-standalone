import { prisma } from "../prisma";
import { getConnection } from "../services/salesforce";
import { PrismaFindingRepository } from "./findings/prismaFindingRepository";
import { PrismaHealthGraphRepository } from "./healthGraphRepository";
import { HealthService } from "./healthService";
import { JsforceHealthSource } from "./healthSource";
import { PrismaRunRepository, PrismaSnapshotRepository } from "./healthStore";

// Production wiring for Org Health. One shared instance, so the Data run guard (one run per
// connection) holds across the routes and the post-scan hook. Tests build their own service.
export const healthService = new HealthService({
  graph: new PrismaHealthGraphRepository(prisma),
  findings: new PrismaFindingRepository(prisma),
  snapshots: new PrismaSnapshotRepository(prisma),
  runs: new PrismaRunRepository(prisma),
  sourceFor: async (connectionId) => new JsforceHealthSource(await getConnection(connectionId)),
});
