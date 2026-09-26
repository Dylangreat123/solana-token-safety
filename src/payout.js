// Checks that the payout wallet can receive USDC. x402 buyers send USDC to
// the wallet's USDC token account, and their payment doesn't create that
// account, so a wallet that has never held USDC can't be paid.

import { address, getProgramDerivedAddress, getAddressEncoder, createSolanaRpc } from "@solana/kit";
import { TOKEN_PROGRAM } from "./known.js";

const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const USDC_MINT = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};
const DEVNET_RPC = "https://api.devnet.solana.com";

export async function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [enc.encode(address(owner)), enc.encode(address(tokenProgram)), enc.encode(address(mint))],
  });
  return ata;
}

/** Returns { ready: boolean | null, usdcAccount, message }. null = couldn't check. */
export async function checkPayoutAccount(config) {
  const mint = USDC_MINT[config.networkName];
  const usdcAccount = await associatedTokenAddress(config.payTo, mint);
  const rpc = createSolanaRpc(config.networkName === "devnet" ? DEVNET_RPC : config.rpcUrl);
  try {
    const res = await rpc.getAccountInfo(usdcAccount, { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
      .send({ abortSignal: AbortSignal.timeout(8000) });
    if (res.value) {
      return { ready: true, usdcAccount, message: "Payout wallet has a USDC account and can receive payments." };
    }
    return {
      ready: false,
      usdcAccount,
      message:
        "Payout wallet has no USDC account yet, so payments will fail. Send it any amount of USDC (even $1) once to create one.",
    };
  } catch (err) {
    return { ready: null, usdcAccount, message: `Couldn't check the payout wallet: ${err?.message ?? err}` };
  }
}
