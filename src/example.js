// An illustrative report for the API docs. It runs through the real rules
// engine, so its level, score and verdict always match what the API returns
// for these facts. The wallet addresses are placeholders, not real holders.

import { evaluate } from "./rules.js";

const holders = {
  source: "largest 20 token accounts",
  coveredPct: 91.4,
  largestWalletPct: 22.03,
  top10WalletsPct: 38.5,
  programControlledPct: 52.9,
  burnedPct: 0,
  top: [
    { owner: "CszswHG5j1NKoWrAiBEFvFk2yzt8gpnbm2Xc8c28mzZM", pct: 52.9, kind: "program", label: "pump.fun bonding curve" },
    { owner: "7Jpx4VjHYVAXcRxav9SJrb5JJXRefisQtA4k6wbP6rma", pct: 22.03, kind: "wallet", label: null },
    { owner: "544y531yEfSJ25nd6gV3Jzhd7fKN3hd8JZhf7462TRK5", pct: 9.12, kind: "wallet", label: null },
    { owner: "ERcLbGz4mwkqgwNt3JvvUdLaFwAKqatFSSRFE2q6ikkP", pct: 7.35, kind: "wallet", label: null },
  ],
};

const facts = {
  program: "spl-token",
  supply: 1_000_000_000_000_000n,
  mintAuthority: null,
  freezeAuthority: null,
  extensions: [],
  metadata: { isMutable: false },
  launch: { platform: "pump.fun", stage: "bonding-curve" },
  holders,
  age: { exact: true, createdAt: "2026-09-26T01:29:06.000Z", days: 0.03 },
  knownAsset: null,
};

const result = evaluate(facts);

export const EXAMPLE_REPORT = {
  reportVersion: "1.0",
  mint: "8woKVbhwy3FvcGSMWdc5govMJE8rAoQnWt1g6USTpump",
  network: "solana-mainnet",
  checkedAt: "2026-09-26T02:10:00.000Z",
  token: { name: "kediii", symbol: "KED", decimals: 6, supply: "1000000000", program: "spl-token", knownAsset: null },
  risk: { level: result.level, safetyScore: result.safetyScore },
  verdict: result.verdict,
  findings: result.findings,
  flags: {
    canMintMore: false,
    canFreeze: false,
    permanentDelegate: false,
    nonTransferable: false,
    pausable: false,
    transferHook: false,
    transferFeeBps: 0,
    defaultFrozen: false,
    metadataMutable: false,
  },
  authorities: { mint: null, freeze: null, metadataUpdate: "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM" },
  extensions: [],
  holders,
  launch: facts.launch,
  age: facts.age,
  limitations: ["Holder figures cover only the largest 20 token accounts."],
  disclaimer:
    "Automated on-chain checks, not financial advice. They can't detect off-chain promises, hidden team wallets, coordinated selling or every scam pattern.",
};
