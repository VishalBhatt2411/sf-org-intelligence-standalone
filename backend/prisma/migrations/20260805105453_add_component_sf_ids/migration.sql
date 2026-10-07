-- AlterTable
ALTER TABLE "apex_classes" ADD COLUMN     "sf_id" TEXT;

-- AlterTable
ALTER TABLE "flows" ADD COLUMN     "sf_id" TEXT;

-- AlterTable
ALTER TABLE "lwc_components" ADD COLUMN     "sf_id" TEXT;

-- AlterTable
ALTER TABLE "permission_sets" ADD COLUMN     "sf_id" TEXT;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "sf_id" TEXT;

-- AlterTable
ALTER TABLE "triggers" ADD COLUMN     "sf_id" TEXT;
