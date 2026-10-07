-- CreateTable
CREATE TABLE "workflow_rules" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "object_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trigger_type" TEXT,
    "sf_id" TEXT,

    CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
