// OpenAPI 3.1 description of the service. Served at /openapi.json and also
// committed next to the Pay.sh catalog entry.

import { EXAMPLE_REPORT } from "./example.js";

export const EXAMPLE_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const SAMPLE_NOTE = "Free sample. Paid reports work for any token mint.";

const nullableString = { type: ["string", "null"] };

const FLAG_NAMES = [
  "canMintMore",
  "canFreeze",
  "permanentDelegate",
  "nonTransferable",
  "pausable",
  "transferHook",
  "transferFeeBps",
  "defaultFrozen",
  "metadataMutable",
];

// Every report always contains all of these keys. `holders`, `launch` and
// `age` are null when they don't apply or couldn't be fetched.
export const REPORT_SCHEMA = {
  type: "object",
  required: [
    "reportVersion",
    "mint",
    "network",
    "checkedAt",
    "token",
    "risk",
    "verdict",
    "findings",
    "flags",
    "authorities",
    "extensions",
    "holders",
    "launch",
    "age",
    "limitations",
    "disclaimer",
  ],
  properties: {
    reportVersion: { type: "string" },
    mint: { type: "string", description: "The token mint address that was checked." },
    network: { type: "string", enum: ["solana-mainnet"] },
    checkedAt: { type: "string", format: "date-time" },
    token: {
      type: "object",
      required: ["name", "symbol", "decimals", "supply", "program", "knownAsset"],
      properties: {
        name: nullableString,
        symbol: nullableString,
        decimals: { type: "integer" },
        supply: { type: "string", description: "Total supply in whole tokens." },
        program: { type: "string", enum: ["spl-token", "token-2022"] },
        knownAsset: {
          type: ["object", "null"],
          description: "Set for well-known assets (e.g. USDC) whose issuer powers are expected.",
          required: ["name", "issuer", "kind"],
          properties: { name: { type: "string" }, issuer: { type: "string" }, kind: { type: "string" } },
        },
      },
    },
    risk: {
      type: "object",
      required: ["level", "safetyScore"],
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
        required: ["id", "severity", "title", "detail"],
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
      description: "Machine-readable yes/no answers for the main risk checks. Every flag is always present.",
      required: FLAG_NAMES,
      properties: {
        canMintMore: { type: "boolean" },
        canFreeze: { type: "boolean" },
        permanentDelegate: { type: "boolean" },
        nonTransferable: { type: "boolean" },
        pausable: { type: "boolean" },
        transferHook: { type: "boolean" },
        transferFeeBps: { type: "integer" },
        defaultFrozen: { type: "boolean" },
        metadataMutable: { type: ["boolean", "null"], description: "Null when the token has no metadata." },
      },
    },
    authorities: {
      type: "object",
      required: ["mint", "freeze", "metadataUpdate"],
      properties: { mint: nullableString, freeze: nullableString, metadataUpdate: nullableString },
    },
    extensions: { type: "array", items: { type: "string" }, description: "Token-2022 extensions on the mint." },
    holders: {
      type: ["object", "null"],
      description: "Concentration among the largest token accounts, grouped by owner. Pools, curves and locks count as program-controlled, not wallets. Null when holder data couldn't be fetched or the supply is zero.",
      required: ["source", "coveredPct", "largestWalletPct", "top10WalletsPct", "programControlledPct", "burnedPct", "top"],
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
            required: ["owner", "pct", "kind", "label"],
            properties: {
              owner: nullableString,
              tokenAccount: { type: "string", description: "Set when the owner couldn't be read." },
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
      description: "Launchpad stage; null when the token didn't launch on a tracked launchpad.",
      required: ["platform", "stage"],
      properties: { platform: { type: "string" }, stage: { type: "string", enum: ["bonding-curve", "graduated"] } },
    },
    age: {
      type: ["object", "null"],
      description: "When exact is true, createdAt and days are set; otherwise atLeastDays and note are. Null when age couldn't be fetched.",
      required: ["exact"],
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

// /v1/sample-report wraps the report with a short note.
export const SAMPLE_SCHEMA = {
  type: "object",
  required: ["note", "report"],
  properties: {
    note: { type: "string" },
    report: REPORT_SCHEMA,
  },
};

const errorBody = {
  type: "object",
  required: ["error", "message"],
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
              // Same token as the response example below, so the two agree.
              example: EXAMPLE_REPORT.mint,
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
          description: `Returns a live report for the BONK token mint (${EXAMPLE_MINT}), cached for 15 minutes and wrapped with a short note, so you can preview the output format. No payment needed.`,
          responses: {
            200: {
              description: "A current report for BONK.",
              content: { "application/json": { schema: SAMPLE_SCHEMA } },
            },
            503: { description: "Sample temporarily unavailable.", content: { "application/json": { schema: errorBody } } },
          },
        },
      },
    },
  };
}
