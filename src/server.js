// HTTP server: free info/health/docs routes plus the paid report route.
// The server never holds a private key. Payments go straight from the buyer
// to PAY_TO; the facilitator verifies them and pays the network fee.

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { isAddress } from "@solana/kit";
import { makeRpc } from "./rpc.js";
import { buildReport, ReportError } from "./report.js";
import { buildOpenApi, EXAMPLE_MINT, SAMPLE_NOTE } from "./openapi.js";
import { EXAMPLE_REPORT } from "./example.js";
import { TtlCache, rateLimit } from "./cache.js";
import { checkPayoutAccount } from "./payout.js";

const SERVICE_NAME = "Solana Token Safety Report";
const REPORT_PATH = "/v1/token-report";
const DESCRIPTION =
  "Safety report for a Solana token mint: mint/freeze authority, risky Token-2022 extensions, holder concentration, pump.fun launch stage, token age and a plain-English verdict.";

export function createApp(config, { rpc = makeRpc(config.rpcUrl), facilitator, scheme, payoutCheck = checkPayoutAccount } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Railway (and most hosts) sit one proxy hop in front of the app.
  app.set("trust proxy", 1);

  const reports = new TtlCache({ ttlMs: 60_000 });
  const samples = new TtlCache({ ttlMs: 15 * 60_000, maxEntries: 1 });
  const inflight = new Map();

  // One report per mint at a time; concurrent requests share the result.
  async function getReport(mint) {
    const cached = reports.get(mint);
    if (cached) return cached;
    if (inflight.has(mint)) return inflight.get(mint);
    const p = buildReport(rpc, mint)
      .then((r) => {
        reports.set(mint, r);
        return r;
      })
      .finally(() => inflight.delete(mint));
    inflight.set(mint, p);
    return p;
  }

  // CORS so browser-based agents can read the payment headers.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT");
    res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(rateLimit({ max: 120 }));

  // ---- Free routes ---------------------------------------------------------
  const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

  app.get("/", (req, res) => {
    res.json({
      service: SERVICE_NAME,
      description: DESCRIPTION,
      price: `${config.priceUsd} USDC per report (x402, Solana)`,
      network: config.networkId,
      payTo: config.payTo,
      endpoints: {
        report: `${baseUrl(req)}${REPORT_PATH}?mint=<token mint address>`,
        sample: `${baseUrl(req)}/v1/sample-report`,
        openapi: `${baseUrl(req)}/openapi.json`,
        health: `${baseUrl(req)}/health`,
      },
      howToPay:
        "Call the report URL. You'll get HTTP 402 with a PAYMENT-REQUIRED header; pay with any x402 client (for example `pay curl <url>`) and retry. Failed reports are not charged.",
    });
  });

  // Re-checks the payout wallet every 5 minutes once it's ready, every
  // minute until then.
  let payout = { checkedAt: 0, result: null };
  app.get("/health", async (req, res) => {
    const age = Date.now() - payout.checkedAt;
    if (!payout.result || age > 5 * 60_000 || (payout.result.ready !== true && age > 60_000)) {
      payout = { checkedAt: Date.now(), result: await payoutCheck(config) };
    }
    res.json({ status: "ok", payoutWallet: config.payTo, payoutReady: payout.result.ready, payoutNote: payout.result.message });
  });

  app.get("/openapi.json", (req, res) => {
    res.json(buildOpenApi({ publicUrl: baseUrl(req), priceUsd: config.priceUsd, networkId: config.networkId }));
  });

  app.get("/v1/sample-report", async (req, res) => {
    try {
      let sample = samples.get("sample");
      if (!sample) {
        sample = await getReport(EXAMPLE_MINT);
        samples.set("sample", sample);
      }
      res.json({ note: SAMPLE_NOTE, report: sample });
    } catch (err) {
      console.error("sample failed:", err?.message ?? err);
      res.status(503).json({ error: "sample_unavailable", message: "Sample temporarily unavailable.", exampleShape: EXAMPLE_REPORT });
    }
  });

  // ---- Paid route ----------------------------------------------------------
  // Reject malformed input before asking for payment. A missing mint still
  // gets the normal 402 (so catalog probes see the price); the handler then
  // returns 400 and the payment is not settled.
  app.use(REPORT_PATH, (req, res, next) => {
    // Express would also run the GET handler for HEAD requests, which the
    // payment rule (GET only) doesn't cover, so only GET is allowed here.
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "method_not_allowed", message: "Use GET." });
    }
    const mint = req.query.mint;
    if (mint !== undefined && (typeof mint !== "string" || !isAddress(mint))) {
      return res.status(400).json({ error: "invalid_mint", message: "`mint` must be a Solana token mint address (base58)." });
    }
    next();
  });

  const facilitatorClient = facilitator ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(config.networkId, scheme ?? new ExactSvmScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);

  const routes = {
    [`GET ${REPORT_PATH}`]: {
      accepts: {
        scheme: "exact",
        price: `$${config.priceUsd}`,
        network: config.networkId,
        payTo: config.payTo,
        maxTimeoutSeconds: 120,
      },
      description: DESCRIPTION,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
      tags: ["solana", "token", "security", "rug-check", "risk"],
      extensions: declareDiscoveryExtension({
        input: { mint: EXAMPLE_MINT },
        inputSchema: {
          properties: { mint: { type: "string", description: "Base58 token mint address" } },
          required: ["mint"],
        },
        // Kept short: this travels inside the PAYMENT-REQUIRED header.
        output: {
          example: {
            mint: EXAMPLE_REPORT.mint,
            risk: EXAMPLE_REPORT.risk,
            verdict: EXAMPLE_REPORT.verdict,
            flags: EXAMPLE_REPORT.flags,
          },
        },
      }),
      unpaidResponseBody: async () => ({
        contentType: "application/json",
        body: {
          error: "payment_required",
          message: `This report costs ${config.priceUsd} USDC on Solana. Pay with an x402 client using the PAYMENT-REQUIRED header, then retry. Failed reports are not charged.`,
          docs: "/openapi.json",
          sample: "/v1/sample-report",
        },
      }),
    },
  };

  app.use(paymentMiddleware(routes, resourceServer));

  app.get(REPORT_PATH, async (req, res) => {
    const started = Date.now();
    const mint = req.query.mint;
    if (!mint) {
      return res.status(400).json({ error: "missing_mint", message: "Add ?mint=<token mint address>. You were not charged." });
    }
    try {
      const report = await getReport(mint);
      res.json(report);
      console.log(`report ok mint=${mint} level=${report.risk.level} ms=${Date.now() - started}`);
    } catch (err) {
      if (err instanceof ReportError) {
        return res.status(err.status).json({ error: err.code, message: `${err.message} You were not charged.` });
      }
      console.error(`report failed mint=${mint}:`, err?.message ?? err);
      res.status(502).json({ error: "chain_data_unavailable", message: "Couldn't read chain data right now. You were not charged; try again shortly." });
    }
  });

  app.use((req, res) => res.status(404).json({ error: "not_found", message: "See /openapi.json for available routes." }));

  return app;
}
