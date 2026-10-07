-- AlterTable
ALTER TABLE "fields" ADD COLUMN     "reference_to" JSONB;

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "assigned_to" TEXT;

-- AlterTable
ALTER TABLE "salesforce_connections" ADD COLUMN     "next_scan_at" TIMESTAMP(3),
ADD COLUMN     "schedule_frequency" TEXT NOT NULL DEFAULT 'off';

-- CreateTable
CREATE TABLE "org_wide_defaults" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "api_name" TEXT NOT NULL,
    "internal_sharing_model" TEXT NOT NULL,
    "external_sharing_model" TEXT,

    CONSTRAINT "org_wide_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sharing_rules" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "object_name" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "access_level" TEXT NOT NULL,

    CONSTRAINT "sharing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "developer_name" TEXT NOT NULL,
    "parent_role_id" TEXT,
    "sf_id" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "org_wide_defaults" ADD CONSTRAINT "org_wide_defaults_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_rules" ADD CONSTRAINT "sharing_rules_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
