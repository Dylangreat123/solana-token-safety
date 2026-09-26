// Offline tests: rules, metadata decoding and holder classification.
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "../src/rules.js";
import { decodeMetaplexMetadata } from "../src/metadata.js";
import { buildReport, formatUnits, ReportError } from "../src/report.js";
import { TOKEN_PROGRAM, PUMP_FUN_PROGRAM } from "../src/known.js";

const base = {
  program: "spl-token",
  supply: 1_000_000_000n,
  mintAuthority: null,
  freezeAuthority: null,
  extensions: [],
  metadata: { isMutable: false },
  launch: null,
  holders: { largestWalletPct: 3, top10WalletsPct: 12 },
  age: { exact: true, days: 40 },
  knownAsset: null,
};

test("clean token is low risk with a positive verdict", () => {
  const r = evaluate(base);
  assert.equal(r.level, "low");
  assert.equal(r.safetyScore, 100);
  assert.match(r.verdict, /^Low risk\. No red flags/);
  assert.match(r.verdict, /not financial advice/);
});

test("mint + freeze authority on a memecoin is high risk", () => {
  const r = evaluate({ ...base, mintAuthority: "Mint1111", freezeAuthority: "Frz1111" });
  assert.equal(r.level, "high");
  assert.ok(r.safetyScore >= 20 && r.safetyScore <= 49);
  assert.deepEqual(r.findings.map((f) => f.id).slice(0, 2), ["mint_authority", "freeze_authority"]);
});

test("known stablecoin powers are context, not risk", () => {
  const r = evaluate({
    ...base,
    mintAuthority: "x",
    freezeAuthority: "y",
    knownAsset: { name: "USD Coin (USDC)", issuer: "Circle", kind: "regulated stablecoin" },
  });
  assert.equal(r.level, "low");
  assert.ok(r.findings.every((f) => f.severity === "info"));
  assert.match(r.verdict, /USD Coin/);
});

test("permanent delegate is critical", () => {
  const r = evaluate({
    ...base,
    program: "token-2022",
    extensions: [{ extension: "permanentDelegate", state: { delegate: "Del111" } }],
  });
  assert.equal(r.level, "critical");
  assert.ok(r.safetyScore <= 19);
  assert.match(r.verdict, /^Critical risk\. A permanent delegate/);
});

test("unset permanent delegate is ignored", () => {
  const r = evaluate({
    ...base,
    program: "token-2022",
    extensions: [{ extension: "permanentDelegate", state: { delegate: null } }],
  });
  assert.equal(r.level, "low");
});

test("transfer fee severity scales with the rate", () => {
  const fee = (bps) => ({
    ...base,
    program: "token-2022",
    extensions: [{
      extension: "transferFeeConfig",
      state: {
        transferFeeConfigAuthority: null,
        olderTransferFee: { transferFeeBasisPoints: bps },
        newerTransferFee: { transferFeeBasisPoints: bps },
      },
    }],
  });
  assert.equal(evaluate(fee(300)).level, "medium");
  assert.equal(evaluate(fee(1000)).level, "high");
  assert.match(evaluate(fee(1000)).findings[0].title, /10% tax/);
});

test("paused token is critical; pausable is high", () => {
  const paused = evaluate({ ...base, extensions: [{ extension: "pausableConfig", state: { authority: "a", paused: true } }] });
  const pausable = evaluate({ ...base, extensions: [{ extension: "pausableConfig", state: { authority: "a", paused: false } }] });
  assert.equal(paused.level, "critical");
  assert.equal(pausable.level, "high");
});

test("whale and top-10 thresholds", () => {
  assert.equal(evaluate({ ...base, holders: { largestWalletPct: 15, top10WalletsPct: 20 } }).level, "medium");
  assert.equal(evaluate({ ...base, holders: { largestWalletPct: 25, top10WalletsPct: 20 } }).level, "high");
  assert.equal(evaluate({ ...base, holders: { largestWalletPct: 5, top10WalletsPct: 55 } }).level, "high");
});

test("large unidentified program holder is flagged; known pools are not", () => {
  const h = (label, pct) => ({ largestWalletPct: 2, top10WalletsPct: 10, top: [{ owner: "x", pct, kind: "program", label }] });
  assert.ok(evaluate({ ...base, holders: h(null, 35) }).findings.some((f) => f.id === "large_program_holder"));
  assert.ok(evaluate({ ...base, holders: h("Squads multisig", 25) }).findings.some((f) => f.id === "large_program_holder"));
  assert.ok(!evaluate({ ...base, holders: h("pump.fun bonding curve", 70) }).findings.some((f) => f.id === "large_program_holder"));
  assert.ok(!evaluate({ ...base, holders: h(null, 15) }).findings.some((f) => f.id === "large_program_holder"));
});

test("missing holder data is disclosed in the verdict", () => {
  const r = evaluate({ ...base, holders: null });
  assert.match(r.verdict, /Holder concentration couldn't be checked/);
});

test("new pump.fun token on the curve is flagged", () => {
  const r = evaluate({ ...base, launch: { platform: "pump.fun", stage: "bonding-curve" }, age: { exact: true, days: 0.2 } });
  assert.equal(r.level, "medium");
  const ids = r.findings.map((f) => f.id);
  assert.ok(ids.includes("pumpfun_bonding_curve") && ids.includes("very_new"));
});

test("inexact age never produces an age finding", () => {
  const r = evaluate({ ...base, age: { exact: false, atLeastDays: 0 } });
  assert.ok(!r.findings.some((f) => f.id === "very_new" || f.id === "new"));
});

test("decodes real Metaplex metadata (BONK)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/bonk-metadata.json", import.meta.url)));
  const md = decodeMetaplexMetadata(Buffer.from(fx.data[0], "base64"));
  assert.equal(md.name, "Bonk");
  assert.equal(md.symbol, "Bonk");
  assert.equal(typeof md.isMutable, "boolean");
  assert.match(md.uri, /^https?:\/\//);
});

test("metadata decoder rejects garbage", () => {
  assert.equal(decodeMetaplexMetadata(Buffer.from([4, 1, 2, 3])), null);
  assert.equal(decodeMetaplexMetadata(Buffer.alloc(0)), null);
});

test("formatUnits", () => {
  assert.equal(formatUnits(1_500_000n, 6), "1.5");
  assert.equal(formatUnits(5n, 6), "0.000005");
  assert.equal(formatUnits(1000n, 0), "1000");
});

// ---- buildReport with a fake RPC -------------------------------------------

const MINT = "8woKVbhwy3FvcGSMWdc5govMJE8rAoQnWt1g6USTpump";
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
const RAYDIUM_AUTH = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
// Ordinary wallets are real key pairs, so their addresses are on the curve.
const { generateKeyPairSigner } = await import("@solana/kit");
const WALLET_A = (await generateKeyPairSigner()).address;
const WALLET_B = (await generateKeyPairSigner()).address;

function tokenAccount(owner) {
  return { owner: TOKEN_PROGRAM, data: { parsed: { type: "account", info: { owner } }, program: "spl-token" } };
}

async function fakeRpcFor({ curveOwnerPda }) {
  const supply = 1_000_000_000_000_000n; // 1B tokens, 6 decimals
  const curveBytes = Buffer.alloc(151);
  curveBytes[48] = 0; // still on the curve
  const calls = [];
  const rpc = {
    async call(build) {
      const r = new Proxy({}, {
        get: (_, method) => (...params) => ({ method, params }),
      });
      const { method, params } = build(r);
      calls.push(method);
      if (method === "getMultipleAccounts" && params[0].length === 3) {
        return {
          value: [
            { owner: TOKEN_PROGRAM, data: { parsed: { type: "mint", info: { decimals: 6, supply: supply.toString(), mintAuthority: null, freezeAuthority: null } }, program: "spl-token" } },
            null, // no Metaplex metadata
            { owner: PUMP_FUN_PROGRAM, data: [curveBytes.toString("base64"), "base64"] },
          ],
        };
      }
      if (method === "getTokenLargestAccounts") {
        return {
          value: [
            { address: "TA1", amount: (supply * 60n / 100n).toString() }, // curve
            { address: "TA2", amount: (supply * 12n / 100n).toString() }, // wallet A
            { address: "TA3", amount: (supply * 3n / 100n).toString() }, // wallet A again
            { address: "TA4", amount: (supply * 8n / 100n).toString() }, // wallet B
            { address: "TA5", amount: (supply * 5n / 100n).toString() }, // burned
            { address: "TA6", amount: (supply * 4n / 100n).toString() }, // Raydium pool
          ],
        };
      }
      if (method === "getMultipleAccounts" && params[1]?.encoding === "jsonParsed") {
        const owners = [curveOwnerPda, WALLET_A, WALLET_A, WALLET_B, INCINERATOR, RAYDIUM_AUTH];
        return { value: owners.map(tokenAccount) };
      }
      if (method === "getMultipleAccounts") {
        // owner-program lookup for off-curve owners
        return { value: params[0].map(() => ({ owner: PUMP_FUN_PROGRAM })) };
      }
      if (method === "getSignaturesForAddress") {
        const now = Math.floor(Date.now() / 1000);
        return [{ blockTime: BigInt(now - 60) }, { blockTime: BigInt(now - 3600) }];
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return { rpc, calls };
}

test("buildReport classifies holders and aggregates per owner", async () => {
  const { getProgramDerivedAddress, getAddressEncoder, getUtf8Encoder, address } = await import("@solana/kit");
  const [curvePda] = await getProgramDerivedAddress({
    programAddress: address(PUMP_FUN_PROGRAM),
    seeds: [getUtf8Encoder().encode("bonding-curve"), getAddressEncoder().encode(address(MINT))],
  });
  const { rpc } = await fakeRpcFor({ curveOwnerPda: curvePda });
  const r = await buildReport(rpc, MINT);

  assert.equal(r.launch.stage, "bonding-curve");
  assert.equal(r.holders.largestWalletPct, 15); // 12% + 3% for wallet A
  assert.equal(r.holders.top10WalletsPct, 23); // 15% + 8%
  assert.equal(r.holders.programControlledPct, 64); // curve 60% + Raydium 4%
  assert.equal(r.holders.burnedPct, 5);
  const curve = r.holders.top.find((h) => h.owner === curvePda);
  assert.equal(curve.kind, "program");
  assert.equal(curve.label, "pump.fun bonding curve");
  assert.equal(r.holders.top.find((h) => h.owner === RAYDIUM_AUTH).label, "Raydium AMM pool");
  assert.equal(r.holders.top.find((h) => h.owner === INCINERATOR).kind, "burn");
  assert.equal(r.age.exact, true);
  assert.equal(r.risk.level, "medium"); // whale 15% + on curve + brand new
  const ids = r.findings.map((f) => f.id);
  assert.ok(ids.includes("whale_wallet") && ids.includes("very_new") && ids.includes("no_metadata"));
  assert.equal(r.flags.canMintMore, false);
});

test("buildReport rejects bad input and non-mints", async () => {
  await assert.rejects(buildReport({ call: async () => ({}) }, "not-an-address"), (e) => e instanceof ReportError && e.status === 400);
  const missing = { call: async () => ({ value: [null, null, null] }) };
  await assert.rejects(buildReport(missing, MINT), (e) => e.status === 404);
  const wallet = { call: async () => ({ value: [{ owner: "11111111111111111111111111111111", data: ["", "base64"] }, null, null] }) };
  await assert.rejects(buildReport(wallet, MINT), (e) => e.status === 422 && e.code === "not_a_mint");
});
