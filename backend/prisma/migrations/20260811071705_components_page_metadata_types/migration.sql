-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "developer_name" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sf_id" TEXT,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visualforce_pages" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "markup" TEXT NOT NULL,
    "sf_id" TEXT,

    CONSTRAINT "visualforce_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visualforce_components" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "markup" TEXT NOT NULL,
    "sf_id" TEXT,

    CONSTRAINT "visualforce_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installed_packages" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namespace_prefix" TEXT NOT NULL,
    "version_name" TEXT,
    "version_number" TEXT,

    CONSTRAINT "installed_packages_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visualforce_pages" ADD CONSTRAINT "visualforce_pages_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visualforce_components" ADD CONSTRAINT "visualforce_components_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installed_packages" ADD CONSTRAINT "installed_packages_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
