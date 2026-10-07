import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { Connection } from "jsforce";
import type { SfEnv } from "./salesforce";

const execFile = promisify(execFileCb);
const sfShell = process.platform === "win32"; // sf is a .cmd shim on Windows

const envPath = path.join(__dirname, "..", "..", ".env");
const envExamplePath = path.join(__dirname, "..", "..", ".env.example");

const LOGIN_URLS: Record<SfEnv, string> = {
  sandbox: "https://test.salesforce.com",
  production: "https://login.salesforce.com",
};

function credentialsPrefix(env: SfEnv) {
  return env === "sandbox" ? "SF_SANDBOX" : "SF_PROD";
}

export function hasCredentials(env: SfEnv): boolean {
  const prefix = credentialsPrefix(env);
  return Boolean(process.env[`${prefix}_CLIENT_ID`] && process.env[`${prefix}_CLIENT_SECRET`]);
}

async function sfLoginWeb(env: SfEnv, alias: string) {
  const args = ["org", "login", "web", "--alias", alias, "--json"];
  if (env === "sandbox") args.push("--instance-url", LOGIN_URLS.sandbox);
  try {
    await execFile("sf", args, { shell: sfShell, timeout: 5 * 60 * 1000 });
  } catch (err: any) {
    const detail = err.stderr || err.stdout || err.message;
    throw new Error(`sf org login web failed: ${detail}`);
  }
}

async function getOrgAuth(alias: string) {
  const { stdout: displayRaw } = await execFile("sf", ["org", "display", "--json", "--target-org", alias], {
    shell: sfShell,
  });
  const display = JSON.parse(displayRaw).result;

  const { stdout: tokenRaw } = await execFile(
    "sf",
    ["org", "auth", "show-access-token", "--json", "--target-org", alias],
    { shell: sfShell }
  );
  const accessToken = JSON.parse(tokenRaw).result?.accessToken;
  if (!accessToken) throw new Error(`Could not read an access token for org "${alias}".`);

  return { ...display, accessToken };
}

function readEnvFile(): Record<string, string> {
  const source = existsSync(envPath) ? envPath : envExamplePath;
  const text = readFileSync(source, "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function writeEnvUpdates(updates: Record<string, string>) {
  const base = existsSync(envPath) ? envPath : envExamplePath;
  let text = readFileSync(base, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}="${value}"`;
    text = new RegExp(`^${key}=.*$`, "m").test(text)
      ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${text}\n${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(envPath, text);
}

// A second click while one setup is still mid-flight (e.g. the user hasn't finished
// logging in in the popped browser window yet) must NOT spawn a second `sf org login web` —
// they'd fight over the same local OAuth callback port. Reuse the in-flight promise instead.
const inFlight = new Map<SfEnv, Promise<void>>();

// Single click -> the CLI opens a real browser window for the user's normal Salesforce
// login -> we reuse that local session, once, to create this app's own Connected App via
// the Metadata API, self-assigning both Client ID and Secret (never revealed/typed by anyone).
// Only works because the backend and the browser are on the same machine — a local dev
// tool, not a hosted multi-tenant service. A deployed version would need each org's admin
// to install the Connected App the normal way instead.
export function ensureConnectedApp(env: SfEnv): Promise<void> {
  if (hasCredentials(env)) return Promise.resolve();

  // The CLI trick needs `sf` installed and a browser on the same machine as the
  // backend — true for local dev, never true for a deployed server. There, the
  // Connected App has to be created once (Setup UI or the same CLI script run by
  // hand) and its Client ID/Secret set as real env vars before anyone can connect.
  if (process.env.NODE_ENV === "production") {
    const prefix = credentialsPrefix(env);
    return Promise.reject(
      new Error(
        `${prefix}_CLIENT_ID/${prefix}_CLIENT_SECRET are not set. In production, create the Connected App once ` +
          `(Salesforce Setup UI or connectedAppSetup.ts's flow run locally by an admin) and set those env vars.`
      )
    );
  }

  const existing = inFlight.get(env);
  if (existing) return existing;

  const promise = doEnsureConnectedApp(env).finally(() => inFlight.delete(env));
  inFlight.set(env, promise);
  return promise;
}

async function doEnsureConnectedApp(env: SfEnv): Promise<void> {
  const alias = `sf-tech-debt-${env}`;
  await sfLoginWeb(env, alias);
  const org = await getOrgAuth(alias);

  const conn = new Connection({ instanceUrl: org.instanceUrl, accessToken: org.accessToken });
  const consumerSecret = randomBytes(24).toString("hex");
  const existingEnv = readEnvFile();
  const callbackUrl = existingEnv.SF_CALLBACK_URL || "http://localhost:4000/auth/salesforce/callback";

  // consumerKey is intentionally omitted: Salesforce's OAuth authorize endpoint only
  // recognizes Consumer Keys it generates itself through its internal keystore — a
  // self-assigned string is accepted and stored by the Metadata API without error, but
  // never becomes valid for the actual OAuth flow (permanent "invalid_client_id", not a
  // propagation delay). Let Salesforce generate it, then read it back below.
  const result = await conn.metadata.create("ConnectedApp", {
    fullName: "SF_Tech_Debt_AI",
    label: "SF Tech Debt AI",
    contactEmail: org.username,
    oauthConfig: {
      callbackUrl,
      scopes: ["Api", "RefreshToken"],
      consumerSecret,
    },
  } as any);

  const outcome = Array.isArray(result) ? result[0] : result;
  if (!outcome.success) {
    const messages = (outcome.errors || []).map((e: any) => e.message || e).join("; ");
    throw new Error(`Salesforce rejected the Connected App creation: ${messages || "unknown error"}`);
  }

  const [readBack] = await conn.metadata.read("ConnectedApp", ["SF_Tech_Debt_AI"]);
  const consumerKey = (readBack as any)?.oauthConfig?.consumerKey;
  if (!consumerKey) {
    throw new Error("Connected App was created but Salesforce did not return a Consumer Key on read-back.");
  }

  writeEnvUpdates({
    [`${credentialsPrefix(env)}_CLIENT_ID`]: consumerKey,
    [`${credentialsPrefix(env)}_CLIENT_SECRET`]: consumerSecret,
  });
}
