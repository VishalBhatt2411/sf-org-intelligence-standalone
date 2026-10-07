const { execFileSync } = require("child_process");
const { Connection } = require("jsforce");

const displayRaw = execFileSync("sf", ["org", "display", "--json", "--target-org", "sf-tech-debt-production"], { shell: true }).toString();
const display = JSON.parse(displayRaw).result;
const tokenRaw = execFileSync("sf", ["org", "auth", "show-access-token", "--json", "--target-org", "sf-tech-debt-production"], { shell: true }).toString();
const accessToken = JSON.parse(tokenRaw).result.accessToken;

const conn = new Connection({ instanceUrl: display.instanceUrl, accessToken });

conn.metadata.read("ConnectedApp", ["SF_Tech_Debt_AI"]).then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
