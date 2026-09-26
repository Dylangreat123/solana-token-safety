// Entry point: read settings from environment variables and start the server.
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { checkPayoutAccount } from "./payout.js";

const config = loadConfig();
for (const w of config.warnings) console.warn(`WARNING: ${w}`);
if (!config.ok) {
  for (const e of config.errors) console.error(`CONFIG ERROR: ${e}`);
  console.error("Fix the settings above (see README.md) and restart.");
  process.exit(1);
}

const app = createApp(config);
app.listen(config.port, async () => {
  console.log(`Solana Token Safety Report listening on port ${config.port}`);
  console.log(`Price ${config.priceUsd} USDC on ${config.networkId}, paid to ${config.payTo}`);
  const payout = await checkPayoutAccount(config);
  (payout.ready === false ? console.warn : console.log)(`${payout.ready === false ? "WARNING: " : ""}${payout.message}`);
});
