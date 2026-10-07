import { Connection, OAuth2 } from "jsforce";
import { prisma } from "../prisma";
import { decrypt, encrypt } from "./crypto";

export type SfEnv = "sandbox" | "production";

const LOGIN_URLS: Record<SfEnv, string> = {
  sandbox: "https://test.salesforce.com",
  production: "https://login.salesforce.com",
};

// Each Salesforce org has its own local Connected App record, so sandbox and
// production need separate Client ID/Secret pairs (see connectedAppSetup.ts).
function credentialsFor(env: SfEnv) {
  const prefix = env === "sandbox" ? "SF_SANDBOX" : "SF_PROD";
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${prefix}_CLIENT_ID/${prefix}_CLIENT_SECRET — click Connect again to set it up.`);
  }
  return { clientId, clientSecret };
}

function buildOAuth2(env: SfEnv, useVerifier = false): OAuth2 {
  const { clientId, clientSecret } = credentialsFor(env);
  return new OAuth2({
    clientId,
    clientSecret,
    redirectUri: process.env.SF_CALLBACK_URL!,
    loginUrl: LOGIN_URLS[env],
    useVerifier,
  });
}

// This org requires PKCE on the web server flow ("missing required code challenge").
// jsforce generates a fresh code_verifier per OAuth2 instance, but the authorize step and
// the callback's token exchange are two separate HTTP requests (two separate instances),
// so the verifier has to be carried across them by hand.
const pendingVerifiers = new Map<SfEnv, string>();

export function getAuthorizeUrl(env: SfEnv) {
  const oauth2 = buildOAuth2(env, true);
  pendingVerifiers.set(env, oauth2.codeVerifier!);
  // Without this, an active login.salesforce.com session silently re-authenticates
  // after logout instead of prompting for credentials again.
  return oauth2.getAuthorizationUrl({ scope: "api refresh_token", state: env, prompt: "login" });
}

// Single default org/user until real app-level auth is needed.
// skipped: multi-tenant login, add when this stops being a single-user tool.
async function getDefaultOrganizationId(): Promise<string> {
  const existing = await prisma.organization.findFirst();
  if (existing) return existing.id;
  const created = await prisma.organization.create({ data: { name: "Default Org" } });
  return created.id;
}

export async function handleOAuthCallback(code: string, env: SfEnv) {
  const oauth2 = buildOAuth2(env);
  const verifier = pendingVerifiers.get(env);
  if (verifier) {
    oauth2.codeVerifier = verifier;
    pendingVerifiers.delete(env);
  }
  const conn = new Connection({ oauth2 });
  await conn.authorize(code);

  const organizationId = await getDefaultOrganizationId();
  const identity = await conn.identity();

  // Single connection per org — otherwise old rows (with still-live tokens) linger
  // after logout, and the frontend's stale-scan fallback reconnects using them.
  await prisma.salesforceConnection.deleteMany({ where: { organizationId } });

  return prisma.salesforceConnection.create({
    data: {
      organizationId,
      instanceUrl: conn.instanceUrl,
      sfOrgId: identity.organization_id,
      username: identity.username,
      accessToken: encrypt(conn.accessToken!),
      refreshToken: encrypt((conn as any).refreshToken || ""),
      loginUrl: LOGIN_URLS[env],
    },
  });
}

export async function getConnection(connectionId: string): Promise<Connection> {
  const record = await prisma.salesforceConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const env: SfEnv = record.loginUrl === LOGIN_URLS.sandbox ? "sandbox" : "production";

  return new Connection({
    oauth2: buildOAuth2(env),
    instanceUrl: record.instanceUrl,
    accessToken: decrypt(record.accessToken),
    refreshToken: record.refreshToken ? decrypt(record.refreshToken) : undefined,
  });
}

export async function logout(connectionId: string): Promise<void> {
  const record = await prisma.salesforceConnection.findUnique({ where: { id: connectionId } });
  if (!record) return;

  const env: SfEnv = record.loginUrl === LOGIN_URLS.sandbox ? "sandbox" : "production";
  try {
    await buildOAuth2(env).revokeToken(decrypt(record.accessToken));
  } catch (err) {
    console.warn("Token revoke failed (continuing with local cleanup):", (err as Error).message);
  }

  // Cascades to that connection's scans/findings/etc — logging out means starting fresh.
  await prisma.salesforceConnection.delete({ where: { id: connectionId } });
}
