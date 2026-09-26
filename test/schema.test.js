// Checks that real report shapes match the published OpenAPI schema, so the
// contract agents rely on (/openapi.json and the Pay.sh listing) can't drift
// from what the API actually returns.

import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { generateKeyPairSigner } from "@solana/kit";
import { buildOpenApi, REPORT_SCHEMA, SAMPLE_SCHEMA, SAMPLE_NOTE } from "../src/openapi.js";
import { EXAMPLE_REPORT } from "../src/example.js";
import { buildReport } from "../src/report.js";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "../src/known.js";

// Formats (date-time) are documentation here; structure is what's checked.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateReport = ajv.compile(REPORT_SCHEMA);
const validateSample = ajv.compile(SAMPLE_SCHEMA);

// What a client actually receives: the report after a JSON round trip.
const asJson = (value) => JSON.parse(JSON.stringify(value));

function assertValid(validate, data, label) {
  const ok = validate(asJson(data));
  assert.ok(ok, `${label}: ${ajv.errorsText(validate.errors)}`);
}

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT = "8woKVbhwy3FvcGSMWdc5govMJE8rAoQnWt1g6USTpump";
const WALLET = (await generateKeyPairSigner()).address;

/** A fake RPC: `mint` is the parsed mint account, `holders` the largest
 *  token accounts as [owner|null, pctOfSupply], `signatures` a count. */
function fakeRpc({ owner = TOKEN_PROGRAM, info, holders = [], signatures = 2 }) {
  const supply = BigInt(info.supply);
  let firstLookup = true;
  return {
    async call(build) {
      const r = new Proxy({}, { get: (_, method) => (...params) => ({ method, params }) });
      const { method, params } = build(r);
      // buildReport's first call reads [mint, metadata PDA, pump.fun curve PDA].
      if (method === "getMultipleAccounts" && firstLookup) {
        firstLookup = false;
        return { value: [{ owner, data: { parsed: { type: "mint", info }, program: "spl-token" } }, null, null] };
      }
      if (method === "getTokenLargestAccounts") {
        return { value: holders.map(([, pct], i) => ({ address: `TA${i}`, amount: ((supply * BigInt(pct)) / 100n).toString() })) };
      }
      if (method === "getMultipleAccounts" && params[1]?.encoding === "jsonParsed") {
        return {
          value: holders.map(([o]) =>
            o ? { owner: TOKEN_PROGRAM, data: { parsed: { type: "account", info: { owner: o } }, program: "spl-token" } } : null,
          ),
        };
      }
      if (method === "getMultipleAccounts") return { value: params[0].map(() => null) };
      if (method === "getSignaturesForAddress") {
        const now = Math.floor(Date.now() / 1000);
        return Array.from({ length: signatures }, (_, i) => ({ blockTime: BigInt(now - 60 * (i + 1)) }));
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("the documented example matches the report schema", () => {
  assertValid(validateReport, EXAMPLE_REPORT, "EXAMPLE_REPORT");
});

test("the sample route's wrapper matches its schema", () => {
  assertValid(validateSample, { note: SAMPLE_NOTE, report: EXAMPLE_REPORT }, "sample wrapper");
});

test("OpenAPI examples match their own schemas", () => {
  const doc = buildOpenApi({ publicUrl: "https://example.test", priceUsd: 0.02, networkId: "solana:x" });
  for (const [path, item] of Object.entries(doc.paths)) {
    const media = item.get.responses[200].content["application/json"];
    const validate = ajv.compile(media.schema);
    assertValid(validate, media.example, `${path} example`);
  }
});

test("fields agents gate on are required", () => {
  const p = REPORT_SCHEMA.properties;
  for (const key of ["risk", "verdict", "findings", "flags"]) assert.ok(REPORT_SCHEMA.required.includes(key), key);
  assert.deepEqual(p.risk.required, ["level", "safetyScore"]);
  assert.deepEqual([...p.flags.required].sort(), Object.keys(p.flags.properties).sort());
  assert.deepEqual(p.findings.items.required, ["id", "severity", "title", "detail"]);
  // Every key a report carries is required at the top level.
  assert.deepEqual([...REPORT_SCHEMA.required].sort(), Object.keys(EXAMPLE_REPORT).sort());
});

test("a bare token (no holders, metadata or launchpad) matches the schema", async () => {
  const rpc = fakeRpc({ info: { decimals: 6, supply: "0", mintAuthority: null, freezeAuthority: null }, signatures: 0 });
  const report = await buildReport(rpc, MINT);
  assert.equal(report.holders, null);
  assert.equal(report.age, null);
  assertValid(validateReport, report, "bare token");
});

test("a Token-2022 token with risky extensions matches the schema", async () => {
  const info = {
    decimals: 9,
    supply: "5000000000000",
    mintAuthority: WALLET,
    freezeAuthority: null,
    extensions: [
      { extension: "permanentDelegate", state: { delegate: WALLET } },
      {
        extension: "transferFeeConfig",
        state: {
          transferFeeConfigAuthority: WALLET,
          olderTransferFee: { transferFeeBasisPoints: 300 },
          newerTransferFee: { transferFeeBasisPoints: 900 },
        },
      },
      { extension: "tokenMetadata", state: { name: "Test", symbol: "TST", uri: "https://x", updateAuthority: WALLET } },
    ],
  };
  const report = await buildReport(fakeRpc({ owner: TOKEN_2022_PROGRAM, info, holders: [[WALLET, 40]] }), MINT);
  assert.equal(report.risk.level, "critical");
  assert.equal(report.flags.transferFeeBps, 900);
  assertValid(validateReport, report, "token-2022");
});

test("a known asset with an unreadable holder and inexact age matches the schema", async () => {
  const info = { decimals: 6, supply: "1000000000000", mintAuthority: WALLET, freezeAuthority: WALLET };
  const report = await buildReport(fakeRpc({ info, holders: [[null, 30], [WALLET, 5]], signatures: 1000 }), USDC);
  assert.ok(report.token.knownAsset);
  assert.equal(report.holders.top[0].kind, "unknown");
  assert.equal(report.age.exact, false);
  assertValid(validateReport, report, "known asset");
});
