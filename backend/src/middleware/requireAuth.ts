import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { SESSION_COOKIE, verifySessionToken } from "../services/userAuth";

declare global {
  namespace Express {
    interface Request {
      auth?: { organizationId: string; connectionId: string };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Not connected to Salesforce" });

  try {
    const payload = verifySessionToken(token);
    // Disconnecting deletes the connection row — treat that as ending the session
    // too, even if an old signed cookie is still sitting in the browser.
    const connection = await prisma.salesforceConnection.findUnique({ where: { id: payload.connectionId } });
    if (!connection) return res.status(401).json({ error: "Salesforce connection no longer exists" });

    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please reconnect to Salesforce" });
  }
}
