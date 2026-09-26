// Checks that no URL trick reaches the paid report without payment.
// Uses a fake facilitator and a fake RPC that would happily build a report,
// so any bypass would show up as HTTP 200.

import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { TOKEN_PROGRAM } from "../src/known.js";

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const config = loadConfig({ PAY_TO: "7Jpx4VjHYVAXcRxav9SJrb5JJXRefisQtA4k6wbP6rma", RPC_URL: "http://unused.invalid" });

let verifyCalls = 0;
const facilitator = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: config.networkId, extra: { feePayer: "CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww" } }],
    extensions: [],
    signers: {},
  }),
  verify: async () => {
    verifyCalls++;
    return { isValid: false, invalidReason: "invalid_payload" };
  },
  settle: async () => ({ success: false, errorReason: "invalid_payload", transaction: "", network: config.networkId }),
};

// A fake RPC that returns a valid mint instantly: a bypass would yield 200.
const rpc = {
  async call(build) {
    const r = new Proxy({}, { get: (_, method) => (...params) => ({ method, params }) });
    const { method } = build(r);
    if (method === "getMultipleAccounts") {
      return { value: [{ owner: TOKEN_PROGRAM, data: { parsed: { type: "mint", info: { decimals: 5, supply: "100", mintAuthority: null, freezeAuthority: null } } } }, null, null] };
    }
    if (method === "getTokenLargestAccounts") return { value: [] };
    if (method === "getSignaturesForAddress") return [];
    throw new Error(method);
  },
};

const app = createApp(config, { rpc, facilitator, payoutCheck: async () => ({ ready: true, message: "t" }) });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const get = (path, init) => fetch(base + path, init);

test("the plain paid URL asks for payment", async () => {
  const res = await get(`/v1/token-report?mint=${MINT}`);
  assert.equal(res.status, 402);
  assert.ok(res.headers.get("payment-required"));
});

for (const path of [
  `/V1/TOKEN-REPORT?mint=${MINT}`,
  `/v1/token-report/?mint=${MINT}`,
  `/v1/Token-Report/?mint=${MINT}`,
  `/v1/token-report//?mint=${MINT}`,
  `//v1//token-report?mint=${MINT}`,
  `/v1/token%2Dreport?mint=${MINT}`,
  `/v1/token-report%2F?mint=${MINT}`,
  `/v1/./token-report?mint=${MINT}`,
  `/v1/token-report?mint=${MINT}&mint=${MINT}`,
]) {
  test(`no free report via ${path}`, async () => {
    const res = await get(path);
    assert.notEqual(res.status, 200, `bypass: ${path} returned 200`);
  });
}

test("HEAD is refused", async () => {
  const res = await get(`/v1/token-report?mint=${MINT}`, { method: "HEAD" });
  assert.equal(res.status, 405);
});

test("POST is refused", async () => {
  const res = await get(`/v1/token-report?mint=${MINT}`, { method: "POST" });
  assert.equal(res.status, 405);
});

test("a fake payment header is rejected, not served", async () => {
  const fake = Buffer.from(JSON.stringify({ x402Version: 2, scheme: "exact", network: config.networkId, payload: { transaction: "AAAA" } })).toString("base64");
  const res = await get(`/v1/token-report?mint=${MINT}`, { headers: { "PAYMENT-SIGNATURE": fake } });
  assert.equal(res.status, 402);
});

test("malformed mint is rejected before payment", async () => {
  const res = await get("/v1/token-report?mint=not-a-real-address");
  assert.equal(res.status, 400);
});

test("missing mint still shows the price (402)", async () => {
  const res = await get("/v1/token-report");
  assert.equal(res.status, 402);
});

test("free routes work", async () => {
  assert.equal((await get("/health")).status, 200);
  assert.equal((await get("/openapi.json")).status, 200);
  const info = await (await get("/")).json();
  assert.equal(info.payTo, config.payTo);
});
