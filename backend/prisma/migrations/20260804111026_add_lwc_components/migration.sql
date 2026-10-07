-- CreateTable
CREATE TABLE "lwc_components" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "api_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "lwc_components_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lwc_components" ADD CONSTRAINT "lwc_components_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
