import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not set — required to store Salesforce tokens.");
  return scryptSync(secret, "sf-tech-debt-token-encryption", 32);
}

// Stored as iv:authTag:ciphertext, all base64 — fits in the existing String columns.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decrypt(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted value");
  const [ivB64, authTagB64, ciphertextB64] = parts;
  if (!ivB64 || !authTagB64) throw new Error("Malformed encrypted value");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]).toString("utf8");
}
