-- DropForeignKey
ALTER TABLE "ai_recommendations" DROP CONSTRAINT "ai_recommendations_finding_id_fkey";

-- DropForeignKey
ALTER TABLE "apex_classes" DROP CONSTRAINT "apex_classes_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "fields" DROP CONSTRAINT "fields_object_id_fkey";

-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "flows" DROP CONSTRAINT "flows_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "lwc_components" DROP CONSTRAINT "lwc_components_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "objects" DROP CONSTRAINT "objects_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "permission_sets" DROP CONSTRAINT "permission_sets_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "scan_results" DROP CONSTRAINT "scan_results_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "scans" DROP CONSTRAINT "scans_connection_id_fkey";

-- DropForeignKey
ALTER TABLE "triggers" DROP CONSTRAINT "triggers_scan_id_fkey";

-- AlterTable
ALTER TABLE "salesforce_connections" ADD COLUMN     "username" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "salesforce_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apex_classes" ADD CONSTRAINT "apex_classes_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_sets" ADD CONSTRAINT "permission_sets_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lwc_components" ADD CONSTRAINT "lwc_components_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
