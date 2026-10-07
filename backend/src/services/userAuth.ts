import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "session";

// A session exists only once someone has completed the real Salesforce OAuth
// login — that connection's id is the session's proof of identity, there's no
// separate app password. See auth.ts's /salesforce/callback.
export type SessionPayload = { organizationId: string; connectionId: string };

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set — required to sign login sessions.");
  return secret;
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifySessionToken(token: string): SessionPayload {
  return jwt.verify(token, getJwtSecret()) as SessionPayload;
}
