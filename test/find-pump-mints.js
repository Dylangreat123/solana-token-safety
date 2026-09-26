// Finds recently traded pump.fun mints (on the curve and graduated) for testing.
import { makeRpc } from "../src/rpc.js";
import { address } from "@solana/kit";

const rpc = makeRpc(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", { timeoutMs: 15000, retries: 3 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const programs = {
  curve: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpswap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
};
for (const [label, prog] of Object.entries(programs)) {
  const sigs = await rpc.call((r) => r.getSignaturesForAddress(address(prog), { limit: 12 }));
  const found = new Set();
  for (const s of sigs) {
    if (s.err) continue;
    await sleep(300);
    try {
      const tx = await rpc.call((r) => r.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }));
      for (const b of tx?.meta?.postTokenBalances ?? []) if (b.mint.endsWith("pump")) found.add(b.mint);
    } catch {}
    if (found.size >= 3) break;
  }
  console.log(label, [...found].join(" "));
}
