import { prisma } from "../prisma";
import { runScan } from "./scanEngine";
import { runAnalysis } from "../analysis";

// ponytail: setInterval polling, not a real job queue — fine at this app's single-tenant
// scale; move to a proper scheduler (e.g. node-cron, external worker) if connections grow.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

const FREQUENCY_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function nextScanAtFor(frequency: string, from: Date = new Date()): Date | null {
  const ms = FREQUENCY_MS[frequency];
  return ms ? new Date(from.getTime() + ms) : null;
}

async function runDueScans() {
  const due = await prisma.salesforceConnection.findMany({
    where: { scheduleFrequency: { not: "off" }, nextScanAt: { lte: new Date() } },
  });

  for (const connection of due) {
    try {
      const scanId = await runScan(connection.id);
      await runAnalysis(scanId);
    } catch (err) {
      console.warn(`Scheduled scan failed for connection ${connection.id}:`, (err as Error).message);
    }
    await prisma.salesforceConnection.update({
      where: { id: connection.id },
      data: { nextScanAt: nextScanAtFor(connection.scheduleFrequency) },
    });
  }
}

export function startScheduler() {
  setInterval(() => {
    runDueScans().catch((err) => console.error("Scheduler check failed:", err));
  }, CHECK_INTERVAL_MS);
}
