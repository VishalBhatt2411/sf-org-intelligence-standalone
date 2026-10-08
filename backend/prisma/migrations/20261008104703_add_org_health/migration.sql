-- AlterTable
ALTER TABLE "apex_classes" ADD COLUMN     "api_version" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "org_health_findings" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL DEFAULT 1,
    "component_key" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "component_label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "evidence" TEXT NOT NULL,
    "measured" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "validation" TEXT NOT NULL,
    "contributors" JSONB NOT NULL,
    "owner" TEXT,
    "due_date" TIMESTAMP(3),
    "notes" TEXT,
    "compensating_control" TEXT,
    "risk_acceptance_expiry" TIMESTAMP(3),
    "false_positive_reason" TEXT,
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "last_run_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_health_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_health_finding_events" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_health_finding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_health_snapshots" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "severity" TEXT,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_health_runs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "org_health_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_health_findings_connection_id_section_status_idx" ON "org_health_findings"("connection_id", "section", "status");

-- CreateIndex
CREATE INDEX "org_health_findings_connection_id_component_key_idx" ON "org_health_findings"("connection_id", "component_key");

-- CreateIndex
CREATE UNIQUE INDEX "org_health_findings_connection_id_fingerprint_key" ON "org_health_findings"("connection_id", "fingerprint");

-- CreateIndex
CREATE INDEX "org_health_finding_events_finding_id_changed_at_idx" ON "org_health_finding_events"("finding_id", "changed_at");

-- CreateIndex
CREATE INDEX "org_health_snapshots_connection_id_section_created_at_idx" ON "org_health_snapshots"("connection_id", "section", "created_at");

-- CreateIndex
CREATE INDEX "org_health_runs_connection_id_section_started_at_idx" ON "org_health_runs"("connection_id", "section", "started_at");

-- AddForeignKey
ALTER TABLE "org_health_findings" ADD CONSTRAINT "org_health_findings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "salesforce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_health_finding_events" ADD CONSTRAINT "org_health_finding_events_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "org_health_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_health_snapshots" ADD CONSTRAINT "org_health_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "salesforce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_health_runs" ADD CONSTRAINT "org_health_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "salesforce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
