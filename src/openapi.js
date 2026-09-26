// OpenAPI 3.1 description of the service. Served at /openapi.json and also
// committed next to the Pay.sh catalog entry.

import { EXAMPLE_REPORT } from "./example.js";

export const EXAMPLE_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const nullableString = { type: ["string", "null"] };

export const REPORT_SCHEMA = {
  type: "object",
  required: ["mint", "risk", "verdict", "findings", "flags"],
  properties: {
    reportVersion: { type: "string" },
    mint: { type: "string", description: "The token mint address that was checked." },
    network: { type: "string", enum: ["solana-mainnet"] },
    checkedAt: { type: "string", format: "date-time" },
    token: {
      type: "object",
      properties: {
        name: nullableString,
        symbol: nullableString,
        decimals: { type: "integer" },
        supply: { type: "string", description: "Total supply in whole tokens." },
        program: { type: "string", enum: ["spl-token", "token-2022"] },
        knownAsset: {
          type: ["object", "null"],
          description: "Set for well-known assets (e.g. USDC) whose issuer powers are expected.",
          properties: { name: { type: "string" }, issuer: { type: "string" }, kind: { type: "string" } },
        },
      },
    },
    risk: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["low", "medium", "high", "critical"] },
        safetyScore: { type: "integer", minimum: 0, maximum: 100, description: "Higher is safer. low 80-100, medium 50-79, high 20-49, critical 0-19." },
      },
    },
    verdict: { type: "string", description: "Plain-English summary of the most important findings." },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    flags: {
      type: "object",
      description: "Machine-readable yes/no answers for the main risk checks.",
      properties: {
        canMintMore: { type: "boolean" },
        canFreeze: { type: "boolean" },
        permanentDelegate: { type: "boolean" },
        nonTransferable: { type: "boolean" },
        pausable: { type: "boolean" },
        transferHook: { type: "boolean" },
        transferFeeBps: { type: "integer" },
        defaultFrozen: { type: "boolean" },
        metadataMutable: { type: ["boolean", "null"] },
      },
    },
    authorities: {
      type: "object",
      properties: { mint: nullableString, freeze: nullableString, metadataUpdate: nullableString },
    },
    extensions: { type: "array", items: { type: "string" }, description: "Token-2022 extensions on the mint." },
    holders: {
      type: ["object", "null"],
      description: "Concentration among the largest token accounts, grouped by owner. Pools, curves and locks count as program-controlled, not wallets.",
      properties: {
        source: { type: "string" },
        coveredPct: { type: "number" },
        largestWalletPct: { type: "number" },
        top10WalletsPct: { type: "number" },
        programControlledPct: { type: "number" },
        burnedPct: { type: "number" },
        top: {
          type: "array",
          items: {
            type: "object",
            properties: {
              owner: nullableString,
              pct: { type: "number" },
              kind: { type: "string", enum: ["wallet", "program", "burn", "unknown"] },
              label: nullableString,
            },
          },
        },
      },
    },
    launch: {
      type: ["object", "null"],
      properties: { platform: { type: "string" }, stage: { type: "string", enum: ["bonding-curve", "graduated"] } },
    },
    age: {
      type: ["object", "null"],
      properties: {
        exact: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
        days: { type: "number" },
        atLeastDays: { type: "number" },
        note: { type: "string" },
      },
    },
    limitations: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
};

const errorBody = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" } },
};

export function buildOpenApi({ publicUrl, priceUsd, networkId }) {
  const amount = Number(priceUsd).toFixed(6);
  return {
    openapi: "3.1.0",
    info: {
      title: "Solana Token Safety Report",
      version: "1.0.0",
      description:
        "Pay-per-request safety report for any Solana token mint: mint and freeze authority, risky Token-2022 extensions, holder concentration, pump.fun launch stage, token age and a plain-English verdict. Paid in USDC on Solana via x402; no account or API key.",
    },
    ...(publicUrl ? { servers: [{ url: publicUrl }] } : {}),
    paths: {
      "/v1/token-report": {
        get: {
          operationId: "getTokenReport",
          summary: "Generate a safety report for a Solana token mint",
          description: `x402 v2 paid endpoint: ${priceUsd} USDC per report on Solana (${networkId}). The first request returns 402 with a PAYMENT-REQUIRED header; pay and retry with PAYMENT-SIGNATURE. Requests that fail (bad or unknown mint, chain data unavailable) are not charged.`,
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount },
            protocols: [{ x402: {} }],
          },
          parameters: [
            {
              name: "mint",
              in: "query",
              required: true,
              description: "Base58 address of the token mint to check.",
              schema: { type: "string", minLength: 32, maxLength: 44 },
              example: EXAMPLE_MINT,
            },
          ],
          responses: {
            200: {
              description: "The safety report.",
              content: { "application/json": { schema: REPORT_SCHEMA, example: EXAMPLE_REPORT } },
            },
            400: { description: "Missing or malformed mint address (not charged).", content: { "application/json": { schema: errorBody } } },
            402: {
              description: "Payment required. The PAYMENT-REQUIRED header carries the base64 x402 v2 challenge.",
              headers: { "PAYMENT-REQUIRED": { schema: { type: "string" }, description: "Base64-encoded x402 v2 payment requirements." } },
            },
            404: { description: "No account at that address (not charged).", content: { "application/json": { schema: errorBody } } },
            422: { description: "The address is not a token mint (not charged).", content: { "application/json": { schema: errorBody } } },
            429: { description: "Rate limited.", content: { "application/json": { schema: errorBody } } },
            502: { description: "Chain data unavailable right now (not charged).", content: { "application/json": { schema: errorBody } } },
          },
        },
      },
      "/v1/sample-report": {
        get: {
          operationId: "getSampleReport",
          summary: "Fetch a sample safety report for the BONK token mint",
          description: "Returns a cached report for BONK so you can preview the output format. No payment needed.",
          responses: {
            200: { description: "A sample report.", content: { "application/json": { schema: REPORT_SCHEMA } } },
            503: { description: "Sample temporarily unavailable.", content: { "application/json": { schema: errorBody } } },
          },
        },
      },
    },
  };
}
