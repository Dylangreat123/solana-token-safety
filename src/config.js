import { isAddress } from "@solana/kit";

// x402 network IDs (CAIP-2). Payments settle on this network; the reports
// themselves always read Solana mainnet through RPC_URL.
export const NETWORKS = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

export function loadConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  const payTo = (env.PAY_TO || "").trim();
  if (!payTo) {
    errors.push("PAY_TO is missing. Set it to the public address of the wallet that should receive USDC.");
  } else if (!isAddress(payTo)) {
    errors.push(`PAY_TO (${payTo}) is not a valid Solana address.`);
  }

  const priceUsd = (env.PRICE_USD || "0.02").trim();
  const priceNum = Number(priceUsd);
  if (!/^\d+(\.\d{1,6})?$/.test(priceUsd) || !(priceNum >= 0.001) || priceNum > 100) {
    errors.push(`PRICE_USD (${priceUsd}) must be a dollar amount between 0.001 and 100, e.g. 0.02.`);
  }

  const networkName = (env.NETWORK || "mainnet").trim().toLowerCase();
  if (!NETWORKS[networkName]) errors.push(`NETWORK must be "mainnet" or "devnet", not "${networkName}".`);

  const rpcUrl = (env.RPC_URL || PUBLIC_RPC).trim();
  if (rpcUrl === PUBLIC_RPC) {
    warnings.push(
      "RPC_URL is not set, so the public Solana endpoint is used. It blocks the largest-holders check and rate-limits heavily; set RPC_URL to a Helius (or similar) mainnet URL.",
    );
  }

  const publicUrl = (env.PUBLIC_URL || "").trim().replace(/\/+$/, "") || null;
  if (publicUrl && !/^https?:\/\//.test(publicUrl)) errors.push("PUBLIC_URL must start with https://");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    payTo,
    priceUsd,
    networkName,
    networkId: NETWORKS[networkName],
    rpcUrl,
    facilitatorUrl: (env.FACILITATOR_URL || "https://facilitator.payai.network").trim().replace(/\/+$/, ""),
    publicUrl,
    port: Number(env.PORT || 3000),
  };
}
