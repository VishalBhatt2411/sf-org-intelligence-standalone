-- AlterTable
ALTER TABLE "salesforce_connections" ADD COLUMN     "graph_settings" JSONB;

-- AlterTable
ALTER TABLE "scan_results" ADD COLUMN     "coverage" TEXT,
ADD COLUMN     "coverage_detail" TEXT;

-- CreateTable
CREATE TABLE "graph_nodes" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fqn" TEXT NOT NULL,
    "namespace" TEXT,
    "parent_key" TEXT,
    "attributes" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "first_seen_scan_id" TEXT NOT NULL,
    "last_seen_scan_id" TEXT NOT NULL,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_edges" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "edge_key" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "source_node_key" TEXT NOT NULL,
    "target_node_key" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "first_seen_scan_id" TEXT NOT NULL,
    "last_seen_scan_id" TEXT NOT NULL,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "graph_nodes_connection_id_type_key_idx" ON "graph_nodes"("connection_id", "type_key");

-- CreateIndex
CREATE INDEX "graph_nodes_connection_id_parent_key_idx" ON "graph_nodes"("connection_id", "parent_key");

-- CreateIndex
CREATE UNIQUE INDEX "graph_nodes_connection_id_node_key_key" ON "graph_nodes"("connection_id", "node_key");

-- CreateIndex
CREATE INDEX "graph_edges_connection_id_source_node_key_idx" ON "graph_edges"("connection_id", "source_node_key");

-- CreateIndex
CREATE INDEX "graph_edges_connection_id_target_node_key_idx" ON "graph_edges"("connection_id", "target_node_key");

-- CreateIndex
CREATE UNIQUE INDEX "graph_edges_connection_id_edge_key_key" ON "graph_edges"("connection_id", "edge_key");

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "salesforce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "salesforce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prefix search (ILIKE 'term%') on active nodes, served by text_pattern_ops indexes.
CREATE INDEX "graph_nodes_search_label_idx" ON "graph_nodes" (connection_id, lower(label) text_pattern_ops) WHERE state = 'active';
CREATE INDEX "graph_nodes_search_fqn_idx" ON "graph_nodes" (connection_id, lower(fqn) text_pattern_ops) WHERE state = 'active';

-- Closed vocabularies enforced at the database as well as in code.
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_state_check" CHECK (state IN ('active', 'stale'));
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_state_check" CHECK (state IN ('active', 'stale'));
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_confidence_check" CHECK (confidence IN ('exact', 'parsed', 'heuristic'));
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_coverage_check" CHECK (coverage IS NULL OR coverage IN ('complete', 'partial', 'degraded'));
