import { clamp, GraphInputError } from "./errors";
import { toNodeDto, type NodeDto } from "./graphDto";
import type { GraphReadRepository } from "./graphReadRepository";

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;
export const SEARCH_DEFAULT_LIMIT = 25;
export const SEARCH_MAX_LIMIT = 50;
export const BROWSE_DEFAULT_LIMIT = 100;
export const BROWSE_MAX_LIMIT = 500;

export type NodeListResult = { nodes: NodeDto[]; truncated: boolean };

// Text search and per-type browsing over the live graph. Search matches anywhere in a label or full
// name and ranks names that start with the text first, as the native Explorer's search bar does.
export class SearchService {
  constructor(private readonly repo: GraphReadRepository) {}

  async search(connectionId: string, query: string, limit?: number, typeKey?: string): Promise<NodeListResult & { query: string }> {
    const q = query.trim();
    if (q.length < SEARCH_MIN_LENGTH) throw new GraphInputError(`Search needs at least ${SEARCH_MIN_LENGTH} characters`);
    if (q.length > SEARCH_MAX_QUERY_LENGTH) throw new GraphInputError(`Search is limited to ${SEARCH_MAX_QUERY_LENGTH} characters`);
    const size = clamp(limit ?? SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT);
    // One extra row tells us whether there was more without a count query.
    const rows = await this.repo.searchNodes(connectionId, q, size + 1, typeKey || undefined);
    return { query: q, nodes: rows.slice(0, size).map(toNodeDto), truncated: rows.length > size };
  }

  async browse(connectionId: string, typeKey: string, limit?: number): Promise<NodeListResult> {
    if (!typeKey) throw new GraphInputError("typeKey is required");
    const size = clamp(limit ?? BROWSE_DEFAULT_LIMIT, 1, BROWSE_MAX_LIMIT);
    const rows = await this.repo.browseNodes(connectionId, typeKey, size + 1);
    return { nodes: rows.slice(0, size).map(toNodeDto), truncated: rows.length > size };
  }
}
