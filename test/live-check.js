// Runs real reports against Solana mainnet so you can eyeball the output.
// Usage: node test/live-check.js [mint ...]
// Uses RPC_URL if set, otherwise Solana's public endpoint (heavily rate-limited).

import { makeRpc } from "../src/rpc.js";
import { buildReport } from "../src/report.js";

const DEFAULTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
};

const rpc = makeRpc(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", { timeoutMs: 15000, retries: 4 });
const args = process.argv.slice(2);
const targets = args.length ? Object.fromEntries(args.map((m) => [m.slice(0, 6), m])) : DEFAULTS;
const summaryOnly = process.env.SUMMARY === "1";

for (const [label, mint] of Object.entries(targets)) {
  const t0 = Date.now();
  try {
    const r = await buildReport(rpc, mint);
    const ms = Date.now() - t0;
    if (summaryOnly) {
      console.log(`\n== ${label} (${ms} ms) ${r.token.name ?? "?"} [${r.token.symbol ?? "?"}] -> ${r.risk.level} ${r.risk.safetyScore}`);
      console.log("   verdict:", r.verdict);
      console.log("   findings:", r.findings.map((f) => `${f.severity}:${f.id}`).join(", "));
      console.log("   holders:", r.holders ? JSON.stringify({ top1: r.holders.largestWalletPct, top10: r.holders.top10WalletsPct, prog: r.holders.programControlledPct, burn: r.holders.burnedPct }) : null, "launch:", JSON.stringify(r.launch), "age:", JSON.stringify(r.age));
    } else {
      console.log(`\n== ${label} (${ms} ms)`);
      console.log(JSON.stringify(r, null, 2));
    }
  } catch (e) {
    console.log(`\n== ${label} FAILED (${Date.now() - t0} ms):`, e.status ?? "", e.code ?? "", e.message);
  }
  await new Promise((r) => setTimeout(r, 2500));
}
