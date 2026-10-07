import { Router } from "express";
import { prisma } from "../prisma";
import { getConnection, logout } from "../services/salesforce";
import { computeHealthScore } from "../analysis";
import { nextScanAtFor } from "../services/scheduler";
import { SESSION_COOKIE } from "../services/userAuth";

const SCHEDULE_FREQUENCIES = ["off", "daily", "weekly", "monthly"] as const;

export const connectionsRouter = Router();

connectionsRouter.get("/:id", async (req, res) => {
  const connection = await prisma.salesforceConnection.findUnique({
    where: { id: req.params.id },
    select: { id: true, username: true, instanceUrl: true, loginUrl: true, scheduleFrequency: true, nextScanAt: true },
  });
  if (!connection) return res.status(404).json({ error: "Not found" });
  res.json(connection);
});

connectionsRouter.get("/:id/org-info", async (req, res) => {
  const conn = await getConnection(req.params.id);
  const result = await conn.query<{ Name: string; OrganizationType: string }>(
    "SELECT Name, OrganizationType FROM Organization"
  );
  const org = result.records[0];
  res.json({
    name: org?.Name ?? null,
    edition: org?.OrganizationType ?? null,
    advancedDetailsUrl: `${conn.instanceUrl}/lightning/setup/CompanyProfileInfo/home`,
  });
});

connectionsRouter.get("/:id/health-history", async (req, res) => {
  const scans = await prisma.scan.findMany({
    where: { connectionId: req.params.id, status: { in: ["completed", "completed_with_errors"] } },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true },
  });
  const history = await Promise.all(
    scans.map(async (scan) => ({
      scanId: scan.id,
      startedAt: scan.startedAt,
      overall: (await computeHealthScore(scan.id)).overall,
    }))
  );
  res.json(history);
});

connectionsRouter.post("/:id/logout", async (req, res) => {
  await logout(req.params.id);
  // Disconnecting the org ends the session too — there's no separate app login to keep alive.
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
});

connectionsRouter.patch("/:id/schedule", async (req, res) => {
  const { frequency } = req.body as { frequency?: string };
  if (!frequency || !SCHEDULE_FREQUENCIES.includes(frequency as (typeof SCHEDULE_FREQUENCIES)[number])) {
    return res.status(400).json({ error: `frequency must be one of: ${SCHEDULE_FREQUENCIES.join(", ")}` });
  }
  const connection = await prisma.salesforceConnection.update({
    where: { id: req.params.id },
    data: { scheduleFrequency: frequency, nextScanAt: nextScanAtFor(frequency) },
  });
  res.json({ scheduleFrequency: connection.scheduleFrequency, nextScanAt: connection.nextScanAt });
});
