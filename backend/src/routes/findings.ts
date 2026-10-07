import { Router } from "express";
import { prisma } from "../prisma";
import { explainFinding } from "../services/ai";

export const findingsRouter = Router();

const STATUSES = ["open", "acknowledged", "resolved", "wont_fix"] as const;

findingsRouter.get("/", async (req, res) => {
  const { scanId } = req.query as { scanId?: string };
  const findings = await prisma.finding.findMany({
    where: scanId ? { scanId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(findings);
});

findingsRouter.patch("/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
  }
  const finding = await prisma.finding.update({ where: { id: req.params.id }, data: { status } });
  res.json(finding);
});

findingsRouter.patch("/:id/assign", async (req, res) => {
  const { assignedTo } = req.body as { assignedTo?: string | null };
  const finding = await prisma.finding.update({
    where: { id: req.params.id },
    data: { assignedTo: assignedTo?.trim() || null },
  });
  res.json(finding);
});

findingsRouter.get("/:id", async (req, res) => {
  const finding = await prisma.finding.findUnique({
    where: { id: req.params.id },
    include: { recommendations: true },
  });
  if (!finding) return res.status(404).json({ error: "Not found" });
  res.json(finding);
});

findingsRouter.post("/:id/explain", async (req, res) => {
  try {
    const recommendation = await explainFinding(req.params.id);
    res.status(201).json(recommendation);
  } catch (err) {
    console.error("AI explanation failed:", err);
    res.status(500).json({ error: "AI explanation failed" });
  }
});
