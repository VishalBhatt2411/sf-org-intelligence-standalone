import { PrismaGraphReadRepository } from "../graph/graphReadRepository";
import { JsforceGraphSource } from "../graph/graphSource";
import { prisma } from "../prisma";
import { getConnection } from "../services/salesforce";
import { createGraphRouter } from "./graph";

// Production wiring for the graph routes; tests build their own router with fakes.
export const graphRouter = createGraphRouter({
  reader: new PrismaGraphReadRepository(prisma),
  sourceFor: async (connectionId) => new JsforceGraphSource(await getConnection(connectionId)),
});
