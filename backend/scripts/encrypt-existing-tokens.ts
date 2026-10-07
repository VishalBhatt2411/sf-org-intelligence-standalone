// One-time backfill for orgs upgrading from before token encryption existed: encrypts
// any Salesforce connection tokens still stored in plaintext. Safe to re-run — already
//-encrypted rows (iv:authTag:ciphertext, all base64) are left alone. Run with:
//   npm run encrypt-existing-tokens
import "dotenv/config";
import { prisma } from "../src/prisma";
import { encrypt } from "../src/services/crypto";

function looksEncrypted(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9+/]*=*$/.test(p));
}

async function main() {
  const connections = await prisma.salesforceConnection.findMany();
  let updated = 0;

  for (const conn of connections) {
    if (looksEncrypted(conn.accessToken) && looksEncrypted(conn.refreshToken)) continue;
    await prisma.salesforceConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: looksEncrypted(conn.accessToken) ? conn.accessToken : encrypt(conn.accessToken),
        refreshToken: looksEncrypted(conn.refreshToken) ? conn.refreshToken : encrypt(conn.refreshToken),
      },
    });
    updated++;
  }

  console.log(`Encrypted tokens for ${updated} of ${connections.length} connection(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
