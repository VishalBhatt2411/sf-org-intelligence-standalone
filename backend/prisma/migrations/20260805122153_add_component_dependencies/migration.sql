/*
  Warnings:

  - You are about to drop the column `referenced_in` on the `fields` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "fields" DROP COLUMN "referenced_in",
ADD COLUMN     "sf_id" TEXT;

-- AlterTable
ALTER TABLE "objects" ADD COLUMN     "sf_id" TEXT;

-- CreateTable
CREATE TABLE "component_dependencies" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "component_name" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "ref_component_id" TEXT NOT NULL,
    "ref_component_name" TEXT NOT NULL,
    "ref_component_type" TEXT NOT NULL,

    CONSTRAINT "component_dependencies_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "component_dependencies" ADD CONSTRAINT "component_dependencies_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
