import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../prisma";
import { computeHealthScore } from "../analysis";

async function loadReportData(scanId: string) {
  const [scan, health, findings] = await Promise.all([
    prisma.scan.findUniqueOrThrow({ where: { id: scanId }, include: { connection: true } }),
    computeHealthScore(scanId),
    prisma.finding.findMany({ where: { scanId }, orderBy: [{ severity: "asc" }, { category: "asc" }] }),
  ]);
  return { scan, health, findings };
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function buildExcelReport(scanId: string): Promise<Buffer> {
  const { scan, health, findings } = await loadReportData(scanId);
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [{ width: 28 }, { width: 20 }];
  summarySheet.addRow(["Org", scan.connection.instanceUrl]);
  summarySheet.addRow(["Scan date", scan.startedAt.toLocaleString()]);
  summarySheet.addRow(["Overall health score", `${health.overall} / 100`]);
  summarySheet.addRow(["Total findings", health.totalFindings]);
  summarySheet.addRow([]);
  summarySheet.addRow(["Category", "Score"]).font = { bold: true };
  for (const [category, score] of Object.entries(health.categoryScores)) {
    summarySheet.addRow([category.replace(/_/g, " "), score]);
  }

  const findingsSheet = workbook.addWorksheet("Findings");
  findingsSheet.columns = [
    { header: "Severity", key: "severity", width: 12 },
    { header: "Category", key: "category", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Component Type", key: "componentType", width: 20 },
    { header: "Component Name", key: "componentName", width: 30 },
    { header: "Title", key: "title", width: 40 },
    { header: "Detail", key: "detail", width: 60 },
    { header: "Assigned To", key: "assignedTo", width: 20 },
  ];
  findingsSheet.getRow(1).font = { bold: true };
  for (const f of findings
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))) {
    findingsSheet.addRow({
      severity: f.severity,
      category: f.category.replace(/_/g, " "),
      status: f.status,
      componentType: f.componentType,
      componentName: f.componentName,
      title: f.title,
      detail: f.detail,
      assignedTo: f.assignedTo || "",
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildPdfReport(scanId: string): Promise<Buffer> {
  const { scan, health, findings } = await loadReportData(scanId);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Salesforce Tech Debt Report", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555").text(`Org: ${scan.connection.instanceUrl}`);
    doc.text(`Scan date: ${scan.startedAt.toLocaleString()}`);
    doc.moveDown();

    doc.fillColor("#000").fontSize(14).text(`Overall Health Score: ${health.overall} / 100`);
    doc.fontSize(10).text(`${health.totalFindings} total findings`);
    doc.moveDown(0.5);
    for (const [category, score] of Object.entries(health.categoryScores)) {
      doc.text(`${category.replace(/_/g, " ")}: ${score} / 100`);
    }
    doc.moveDown();

    doc.fontSize(14).text("Findings", { underline: true });
    doc.moveDown(0.5);

    const sorted = findings
      .slice()
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

    for (const f of sorted) {
      doc
        .fontSize(11)
        .fillColor("#000")
        .text(`[${f.severity.toUpperCase()}] ${f.title}`, { continued: false });
      doc
        .fontSize(9)
        .fillColor("#555")
        .text(`${f.category.replace(/_/g, " ")} · ${f.componentType} "${f.componentName}" · ${f.status}${f.assignedTo ? ` · assigned to ${f.assignedTo}` : ""}`);
      doc.fontSize(9).fillColor("#333").text(f.detail);
      doc.moveDown(0.75);
      if (doc.y > 730) doc.addPage();
    }

    doc.end();
  });
}
