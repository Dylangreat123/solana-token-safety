// Full paid-request test against a local Solana validator with an in-process
// x402 facilitator (the reference @x402/svm facilitator). Proves that:
//   1. an unpaid request gets a 402 challenge,
//   2. a paying client gets the report and the seller receives the money,
//   3. a request that fails (not a mint) is NOT charged.
// Requires solana-test-validator running on 127.0.0.1:8899.
// Usage: node test/local-e2e.js

import {
  createSolanaRpc,
  generateKeyPairSigner,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  getMintSize,
  getInitializeMint2Instruction,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
} from "@solana-program/token";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { registerExactSvmScheme as registerFacilitatorScheme } from "@x402/svm/exact/facilitator";
import { ExactSvmScheme as ClientScheme } from "@x402/svm/exact/client";
import { ExactSvmScheme as ServerScheme } from "@x402/svm/exact/server";
import { loadConfig, NETWORKS } from "../src/config.js";
import { createApp } from "../src/server.js";

const LOCAL = "http://127.0.0.1:8899";
const NETWORK = NETWORKS.devnet; // payment network ID; every RPC below points at the local validator
const rpc = createSolanaRpc(LOCAL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[local-e2e]", ...a);
let failures = 0;
const check = (cond, msg) => {
  log(cond ? "ok  " : "FAIL", msg);
  if (!cond) failures++;
};

async function confirm(sig) {
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    if (value[0]?.err) throw new Error(JSON.stringify(value[0].err));
    if (["confirmed", "finalized"].includes(value[0]?.confirmationStatus)) return;
    await sleep(500);
  }
  throw new Error("not confirmed");
}

async function send(payer, ixs) {
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" }).send();
  await confirm(getSignatureFromTransaction(signed));
}

async function airdrop(addr) {
  const sig = await rpc.requestAirdrop(addr, lamports(2_000_000_000n)).send();
  await confirm(sig);
}

const balance = async (ata) => {
  try {
    return BigInt((await rpc.getTokenAccountBalance(ata).send()).value.amount);
  } catch {
    return 0n;
  }
};

// --- Wallets, test token -------------------------------------------------------
const payer = await generateKeyPairSigner();
const seller = await generateKeyPairSigner();
const facilitatorKey = await generateKeyPairSigner();
const mint = await generateKeyPairSigner();
await airdrop(payer.address);
await airdrop(facilitatorKey.address);

const space = BigInt(getMintSize());
const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
const [payerAta] = await findAssociatedTokenPda({ mint: mint.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const [sellerAta] = await findAssociatedTokenPda({ mint: mint.address, owner: seller.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
await send(payer, [
  getCreateAccountInstruction({ payer, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
  getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address }),
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, mint: mint.address, owner: payer.address }),
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, mint: mint.address, owner: seller.address }),
  getMintToInstruction({ mint: mint.address, token: payerAta, mintAuthority: payer, amount: 10_000_000n }),
]);
log("test token ready; payer holds", (await balance(payerAta)).toString());

// --- In-process facilitator on the local validator -----------------------------
const facilitator = new x402Facilitator();
registerFacilitatorScheme(facilitator, {
  signer: toFacilitatorSvmSigner(facilitatorKey, { [NETWORK]: rpc }),
  networks: NETWORK,
});
const facilitatorClient = {
  verify: (p, r) => facilitator.verify(p, r),
  settle: (p, r) => facilitator.settle(p, r),
  getSupported: async () => facilitator.getSupported(),
};

// --- The real app, priced in the test token --------------------------------------
const config = loadConfig({ PAY_TO: seller.address, NETWORK: "devnet", PRICE_USD: "0.02", RPC_URL: process.env.RPC_URL });
const scheme = new ServerScheme().registerMoneyParser(async (amount) => ({
  amount: String(Math.round(Number(amount) * 1_000_000)),
  asset: mint.address,
}));
const app = createApp(config, { facilitator: facilitatorClient, scheme, payoutCheck: async () => ({ ready: true, message: "test" }) });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // 1. Unpaid request
  const unpaid = await fetch(`${base}/v1/token-report?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`);
  check(unpaid.status === 402 && unpaid.headers.get("payment-required"), `unpaid request -> ${unpaid.status} with PAYMENT-REQUIRED`);

  // 2. Paid request
  // The test token isn't a default asset, so the client's asset allowlist is relaxed here only.
  const client = x402Client.fromConfig({
    schemes: [{ network: "solana:*", client: new ClientScheme(payer, { rpcUrl: LOCAL }) }],
    spendControls: { allowedAssets: true },
  });
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const res = await paidFetch(`${base}/v1/token-report?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`);
  const body = await res.json();
  check(res.status === 200, `paid request -> ${res.status} (${body?.token?.name ?? body?.error}, level ${body?.risk?.level})`);
  const receipt = res.headers.get("payment-response");
  const decoded = receipt ? JSON.parse(Buffer.from(receipt, "base64").toString()) : null;
  check(decoded?.success === true && typeof decoded?.transaction === "string", `settlement receipt ${decoded?.transaction ?? "(missing)"}`);
  check((await balance(sellerAta)) === 20_000n, `seller received ${(await balance(sellerAta)).toString()} (expected 20000 = 0.02)`);

  // 3. Failed report is not charged
  const before = await balance(payerAta);
  // A real mainnet account that is not a token mint (a system-owned address).
  const bad = await paidFetch(`${base}/v1/token-report?mint=5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`);
  const badBody = await bad.json();
  await sleep(1500);
  const after = await balance(payerAta);
  check(bad.status === 422, `non-mint request -> ${bad.status} ${badBody.error}`);
  check(after === before, `payer not charged for the failed request (${before} -> ${after})`);
  check((await balance(sellerAta)) === 20_000n, "seller balance unchanged after the failed request");
} finally {
  server.close();
}
log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
