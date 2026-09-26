// Writes the Pay.sh catalog entry (PAY.md + openapi.json) for your live URL.
// Usage: node scripts/make-listing.js https://your-app.up.railway.app your-github-username
// Output: pay-listing/providers/<username>/solana-token-safety/{PAY.md,openapi.json}

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApi } from "../src/openapi.js";
import { NETWORKS } from "../src/config.js";

const [serviceUrl, operatorArg] = process.argv.slice(2);
if (!serviceUrl || !/^https?:\/\//.test(serviceUrl)) {
  console.error("Usage: node scripts/make-listing.js https://your-app.up.railway.app your-github-username");
  process.exit(1);
}
const operator = (operatorArg || "your-github-username").toLowerCase().replace(/[^a-z0-9-]/g, "-");
const name = "solana-token-safety";
const price = process.env.PRICE_USD || "0.02";
const url = serviceUrl.replace(/\/+$/, "");

const dir = join("pay-listing", "providers", operator, name);
mkdirSync(dir, { recursive: true });

const spec = buildOpenApi({ publicUrl: url, priceUsd: price, networkId: NETWORKS.mainnet });
writeFileSync(join(dir, "openapi.json"), JSON.stringify(spec, null, 2) + "\n");

const payMd = `---
name: ${name}
title: "Solana Token Safety Report"
description: "Solana token risk reports: mint and freeze authority, Token-2022 risks (permanent delegate, transfer fees, hooks, pausing), top-holder concentration, pump.fun launch stage, token age, a 0-100 safety score and a plain-English verdict."
use_case: "Use when an agent must check a Solana token before buying, swapping, listing or recommending it: rug-pull and honeypot screening, memecoin due diligence, mint or freeze authority checks, whale concentration and pump.fun token vetting."
category: security
service_url: ${url}
openapi:
  path: openapi.json
---

Pay-per-request safety reports for any Solana token mint, built for agents that
need a fast yes/no signal before touching a token. Paid in USDC on Solana
mainnet via x402. No account or API key.

- \`GET /v1/token-report?mint=<mint>\` (${price} USDC): full report with a risk
  level (\`low\` / \`medium\` / \`high\` / \`critical\`), a 0-100 safety score, a
  plain-English verdict, machine-readable \`flags\` and detailed \`findings\`.
- \`GET /v1/sample-report\` (free): a sample report to preview the format.

What it checks, all from on-chain data:

- Whether the creator can still mint more tokens or freeze holders.
- Risky Token-2022 extensions: permanent delegate, transfer fees, transfer
  hooks, pausing, default-frozen accounts, non-transferable tokens.
- Concentration among the 20 largest token accounts, grouped by owner, with
  liquidity pools, bonding curves and locks counted separately from wallets.
- pump.fun launch stage (still on the bonding curve or graduated) and token age.
- Well-known stablecoins (USDC, USDT, PYUSD, USDG, EURC) are recognized, so
  their issuer controls aren't reported as red flags.

## Spend-aware usage

- One flat price per report; results are cached for 60 seconds, so repeat
  checks of the same token within a minute return the same report.
- Requests that fail are not charged: a malformed mint returns \`400\` before
  any payment, and unknown addresses (\`404\`), non-mint addresses (\`422\`) and
  chain-data errors (\`502\`) cancel settlement.
- Read \`flags\` for quick gating decisions and \`verdict\` for a human summary.
- Automated on-chain checks, not financial advice: they can't see off-chain
  promises, hidden team wallets or coordinated selling.
`;
writeFileSync(join(dir, "PAY.md"), payMd);
console.log(`Wrote ${join(dir, "PAY.md")} and openapi.json`);
