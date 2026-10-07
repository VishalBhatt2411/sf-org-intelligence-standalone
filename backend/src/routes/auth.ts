import { Router } from "express";
import { getAuthorizeUrl, handleOAuthCallback, SfEnv } from "../services/salesforce";
import { ensureConnectedApp } from "../services/connectedAppSetup";
import { requireAuth } from "../middleware/requireAuth";
import { SESSION_COOKIE, signSessionToken } from "../services/userAuth";

export const authRouter = Router();

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Whether the browser already has a live session — the frontend polls this on
// load to decide between the "Connect to Salesforce" screen and the app itself.
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ connectionId: req.auth!.connectionId, organizationId: req.auth!.organizationId });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
  res.status(204).end();
});

function parseEnv(value: unknown): SfEnv {
  return value === "sandbox" ? "sandbox" : "production";
}

// Public: this is how a session gets created in the first place, so it can't
// require one. Salesforce login itself is the auth check here.
authRouter.get("/salesforce/login", async (req, res) => {
  const env = parseEnv(req.query.env);
  try {
    await ensureConnectedApp(env);
    res.redirect(getAuthorizeUrl(env));
  } catch (err) {
    console.error("Connected app setup failed:", err);
    res.status(500).send(
      `Could not set up Salesforce access automatically for ${env}: ${(err as Error).message}`
    );
  }
});

authRouter.get("/salesforce/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const env = parseEnv(req.query.state);
  if (!code) return res.status(400).json({ error: "Missing authorization code" });

  try {
    const connection = await handleOAuthCallback(code, env);
    const token = signSessionToken({ organizationId: connection.organizationId, connectionId: connection.id });
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.redirect(`${process.env.FRONTEND_URL}/?connectionId=${connection.id}`);
  } catch (err) {
    console.error("OAuth callback failed:", err);
    res.status(500).json({ error: "Salesforce authorization failed" });
  }
});
