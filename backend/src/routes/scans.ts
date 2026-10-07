import { Router } from "express";
import { prisma } from "../prisma";
import { runScan } from "../services/scanEngine";
import { runAnalysis, computeHealthScore } from "../analysis";
import { getComponentUsage } from "../analysis/usageIndex";
import { buildSetupUrl } from "../services/setupLinks";
import { explainComponent } from "../services/ai";
import { buildExcelReport, buildPdfReport } from "../services/reportExport";

export const scansRouter = Router();

scansRouter.post("/", async (req, res) => {
  const { connectionId } = req.body as { connectionId?: string };
  if (!connectionId) return res.status(400).json({ error: "connectionId is required" });

  try {
    const scanId = await runScan(connectionId);
    await runAnalysis(scanId);
    res.status(201).json({ scanId });
  } catch (err) {
    console.error("Scan failed:", err);
    res.status(500).json({ error: "Scan failed" });
  }
});

scansRouter.get("/", async (req, res) => {
  const { connectionId } = req.query as { connectionId?: string };
  const scans = await prisma.scan.findMany({
    where: connectionId ? { connectionId } : undefined,
    orderBy: { startedAt: "desc" },
  });
  res.json(scans);
});

scansRouter.get("/:id/health", async (req, res) => {
  const health = await computeHealthScore(req.params.id);
  res.json(health);
});

scansRouter.get("/:id/components", async (req, res) => {
  const usage = await getComponentUsage(req.params.id);
  res.json(usage);
});

scansRouter.post("/:id/explain-component", async (req, res) => {
  const { type, name } = req.body as { type?: string; name?: string };
  if (!type || !name) return res.status(400).json({ error: "type and name are required" });

  try {
    const result = await explainComponent(req.params.id, type, name);
    res.json(result);
  } catch (err) {
    console.error("Component explanation failed:", err);
    res.status(500).json({ error: "AI explanation failed" });
  }
});

scansRouter.get("/:id/setup-link", async (req, res) => {
  const { type, name } = req.query as { type?: string; name?: string };
  if (!type || !name) return res.status(400).json({ error: "type and name are required" });

  const scan = await prisma.scan.findUnique({ where: { id: req.params.id }, include: { connection: true } });
  if (!scan) return res.status(404).json({ error: "Scan not found" });

  const url = await buildSetupUrl(scan.connection.instanceUrl, scan.id, type, name);
  res.json({ url });
});

scansRouter.get("/:id/export", async (req, res) => {
  const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
  try {
    if (format === "xlsx") {
      const buffer = await buildExcelReport(req.params.id);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="tech-debt-report.xlsx"');
      res.send(buffer);
    } else {
      const buffer = await buildPdfReport(req.params.id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="tech-debt-report.pdf"');
      res.send(buffer);
    }
  } catch (err) {
    console.error("Report export failed:", err);
    res.status(500).json({ error: "Report export failed" });
  }
});

const findingKey = (f: { category: string; ruleKey: string; componentType: string; componentName: string }) =>
  `${f.category}::${f.ruleKey}::${f.componentType}::${f.componentName}`;

scansRouter.get("/:id/diff", async (req, res) => {
  const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
  if (!scan) return res.status(404).json({ error: "Scan not found" });

  const previousScan = await prisma.scan.findFirst({
    where: { connectionId: scan.connectionId, status: "completed", startedAt: { lt: scan.startedAt } },
    orderBy: { startedAt: "desc" },
  });
  if (!previousScan) return res.json({ previousScanId: null, newFindings: [], resolvedFindings: [] });

  const [currentFindings, previousFindings] = await Promise.all([
    prisma.finding.findMany({ where: { scanId: scan.id } }),
    prisma.finding.findMany({ where: { scanId: previousScan.id } }),
  ]);

  const previousKeys = new Set(previousFindings.map(findingKey));
  const currentKeys = new Set(currentFindings.map(findingKey));

  res.json({
    previousScanId: previousScan.id,
    newFindings: currentFindings.filter((f) => !previousKeys.has(findingKey(f))),
    resolvedFindings: previousFindings.filter((f) => !currentKeys.has(findingKey(f))),
  });
});
