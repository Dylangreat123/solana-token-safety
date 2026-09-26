// Gathers on-chain facts about a token mint and turns them into a report.
// Uses only public Solana RPC methods: no third-party data sources.

import {
  address,
  isAddress,
  isOffCurveAddress,
  getProgramDerivedAddress,
  getAddressEncoder,
  getUtf8Encoder,
} from "@solana/kit";
import {
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  METAPLEX_METADATA_PROGRAM,
  PUMP_FUN_PROGRAM,
  KNOWN_PROGRAMS,
  KNOWN_AUTHORITIES,
  BURN_ADDRESSES,
  KNOWN_ASSETS,
} from "./known.js";
import { decodeMetaplexMetadata } from "./metadata.js";
import { evaluate } from "./rules.js";

export const REPORT_VERSION = "1.0";
const SIGNATURE_WINDOW = 1000;

/** An error that maps to a specific HTTP status for the caller. */
export class ReportError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const utf8 = getUtf8Encoder();
const addressBytes = getAddressEncoder();

async function derive(programId, seeds) {
  const [pda] = await getProgramDerivedAddress({ programAddress: address(programId), seeds });
  return pda;
}

// Account data comes back either parsed (JSON) or as [base64, "base64"].
function rawBytes(data) {
  if (Array.isArray(data) && typeof data[0] === "string" && data[1] === "base64") {
    return Buffer.from(data[0], "base64");
  }
  return null;
}

// Percentage of supply with 4 decimal places of precision, computed on
// integers so huge supplies don't lose precision.
function percentOf(amount, supply) {
  if (supply <= 0n) return 0;
  return Number((amount * 1_000_000n) / supply) / 10_000;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function formatUnits(raw, decimals) {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

async function loadHolders(rpc, mint, supply) {
  const largest = await rpc.call((r) => r.getTokenLargestAccounts(mint));
  const accounts = largest.value ?? [];
  if (!accounts.length) return null;

  const infos = await rpc.call((r) =>
    r.getMultipleAccounts(accounts.map((a) => a.address), { encoding: "jsonParsed" }),
  );

  // Several token accounts can belong to one owner; add them up.
  const byOwner = new Map();
  accounts.forEach((acct, i) => {
    const owner = infos.value[i]?.data?.parsed?.info?.owner ?? null;
    const key = owner ?? `unknown:${acct.address}`;
    const amount = BigInt(acct.amount);
    byOwner.set(key, (byOwner.get(key) ?? 0n) + amount);
  });

  const owners = [...byOwner.keys()].filter((k) => !k.startsWith("unknown:"));
  const needsLookup = owners.filter(
    (o) => !BURN_ADDRESSES.has(o) && !KNOWN_AUTHORITIES[o] && isOffCurveAddress(address(o)),
  );
  const ownerProgram = {};
  if (needsLookup.length) {
    const res = await rpc.call((r) =>
      r.getMultipleAccounts(needsLookup.map((o) => address(o)), {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      }),
    );
    needsLookup.forEach((o, i) => {
      ownerProgram[o] = res.value[i]?.owner ?? null;
    });
  }

  const entries = [...byOwner.entries()]
    .map(([owner, amount]) => {
      let kind;
      let label = null;
      if (owner.startsWith("unknown:")) {
        kind = "unknown";
      } else if (BURN_ADDRESSES.has(owner)) {
        kind = "burn";
        label = "Burn address";
      } else if (KNOWN_AUTHORITIES[owner]) {
        kind = "program";
        label = KNOWN_AUTHORITIES[owner];
      } else if (isOffCurveAddress(address(owner))) {
        kind = "program";
        label = KNOWN_PROGRAMS[ownerProgram[owner]] ?? null;
      } else {
        kind = "wallet";
      }
      return {
        owner: owner.startsWith("unknown:") ? null : owner,
        tokenAccount: owner.startsWith("unknown:") ? owner.slice(8) : undefined,
        amount,
        pct: percentOf(amount, supply),
        kind,
        label,
      };
    })
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  const wallets = entries.filter((e) => e.kind === "wallet");
  const sum = (list) => list.reduce((s, e) => s + e.pct, 0);

  return {
    source: `largest ${accounts.length} token accounts`,
    coveredPct: round2(sum(entries)),
    largestWalletPct: round2(wallets[0]?.pct ?? 0),
    top10WalletsPct: round2(sum(wallets.slice(0, 10))),
    programControlledPct: round2(sum(entries.filter((e) => e.kind === "program"))),
    burnedPct: round2(sum(entries.filter((e) => e.kind === "burn"))),
    top: entries.slice(0, 10).map((e) => ({
      owner: e.owner,
      ...(e.tokenAccount ? { tokenAccount: e.tokenAccount } : {}),
      pct: round2(e.pct),
      kind: e.kind,
      label: e.label,
    })),
  };
}

function loadAge(signatures, now) {
  if (!signatures?.length) return null;
  const oldest = signatures[signatures.length - 1];
  if (oldest.blockTime == null) return null;
  const ms = Number(oldest.blockTime) * 1000;
  const days = round2((now.getTime() - ms) / 86_400_000);
  if (signatures.length < SIGNATURE_WINDOW) {
    return { exact: true, createdAt: new Date(ms).toISOString(), days };
  }
  return {
    exact: false,
    atLeastDays: days,
    note: `Very active token: its creation is older than its latest ${SIGNATURE_WINDOW} transactions.`,
  };
}

/**
 * Build a safety report for a token mint.
 * @param {{ call: Function }} rpc - from makeRpc()
 * @param {string} mintInput - base58 mint address
 */
export async function buildReport(rpc, mintInput, { now = new Date() } = {}) {
  if (typeof mintInput !== "string" || !isAddress(mintInput)) {
    throw new ReportError(400, "invalid_mint", "`mint` must be a Solana token mint address (base58).");
  }
  const mint = address(mintInput);
  const metadataPda = await derive(METAPLEX_METADATA_PROGRAM, [
    utf8.encode("metadata"),
    addressBytes.encode(address(METAPLEX_METADATA_PROGRAM)),
    addressBytes.encode(mint),
  ]);
  const curvePda = await derive(PUMP_FUN_PROGRAM, [utf8.encode("bonding-curve"), addressBytes.encode(mint)]);

  const base = await rpc.call((r) =>
    r.getMultipleAccounts([mint, metadataPda, curvePda], { encoding: "jsonParsed" }),
  );
  const [mintAcc, metadataAcc, curveAcc] = base.value;

  if (!mintAcc) {
    throw new ReportError(404, "not_found", "No account exists at this address on Solana mainnet.");
  }
  const parsed = mintAcc.data?.parsed;
  if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(mintAcc.owner) || parsed?.type !== "mint") {
    throw new ReportError(
      422,
      "not_a_mint",
      "This address is not a token mint. Pass the token's mint address, not a wallet or token account.",
    );
  }

  const info = parsed.info;
  const program = mintAcc.owner === TOKEN_2022_PROGRAM ? "token-2022" : "spl-token";
  const decimals = Number(info.decimals);
  const supply = BigInt(info.supply);
  const extensions = Array.isArray(info.extensions) ? info.extensions : [];

  // Metadata: Token-2022's built-in metadata first, then Metaplex.
  let metadata = null;
  const t22meta = extensions.find((e) => e.extension === "tokenMetadata")?.state;
  if (t22meta) {
    metadata = {
      name: t22meta.name ?? null,
      symbol: t22meta.symbol ?? null,
      uri: t22meta.uri ?? null,
      updateAuthority: t22meta.updateAuthority ?? null,
      isMutable: Boolean(t22meta.updateAuthority),
      standard: "token-2022",
    };
  } else if (metadataAcc?.owner === METAPLEX_METADATA_PROGRAM) {
    const bytes = rawBytes(metadataAcc.data);
    if (bytes) metadata = decodeMetaplexMetadata(bytes);
  }

  // pump.fun launch stage, read from the bonding curve's "complete" flag.
  let launch = null;
  if (curveAcc?.owner === PUMP_FUN_PROGRAM) {
    const bytes = rawBytes(curveAcc.data);
    if (bytes && bytes.length >= 49) {
      launch = { platform: "pump.fun", stage: bytes[48] === 1 ? "graduated" : "bonding-curve" };
    }
  }

  const limitations = [];
  const [holdersRes, sigsRes] = await Promise.allSettled([
    supply > 0n ? loadHolders(rpc, mint, supply) : Promise.resolve(null),
    rpc.call((r) => r.getSignaturesForAddress(mint, { limit: SIGNATURE_WINDOW })),
  ]);
  const holders = holdersRes.status === "fulfilled" ? holdersRes.value : null;
  if (holdersRes.status === "rejected") limitations.push("Largest holders could not be fetched from the RPC node.");
  const age = sigsRes.status === "fulfilled" ? loadAge(sigsRes.value, now) : null;
  if (sigsRes.status === "rejected") limitations.push("Token age could not be fetched from the RPC node.");
  if (holders) limitations.push("Holder figures cover only the largest 20 token accounts.");
  if (age && !age.exact) limitations.push("Exact creation date not checked for very active tokens.");

  const knownAsset = KNOWN_ASSETS[mint] ?? null;
  const facts = {
    program,
    supply,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    extensions,
    metadata,
    launch,
    holders,
    age,
    knownAsset,
  };
  const result = evaluate(facts);

  const extMap = Object.fromEntries(extensions.map((e) => [e.extension, e.state ?? {}]));
  const feeCfg = extMap.transferFeeConfig;
  const feeBps = feeCfg
    ? Math.max(
        Number(feeCfg.olderTransferFee?.transferFeeBasisPoints ?? 0),
        Number(feeCfg.newerTransferFee?.transferFeeBasisPoints ?? 0),
      )
    : 0;

  return {
    reportVersion: REPORT_VERSION,
    mint,
    network: "solana-mainnet",
    checkedAt: now.toISOString(),
    token: {
      name: metadata?.name || null,
      symbol: metadata?.symbol || null,
      decimals,
      supply: formatUnits(supply, decimals),
      program,
      knownAsset,
    },
    risk: { level: result.level, safetyScore: result.safetyScore },
    verdict: result.verdict,
    findings: result.findings,
    flags: {
      canMintMore: Boolean(facts.mintAuthority),
      canFreeze: Boolean(facts.freezeAuthority),
      permanentDelegate: Boolean(extMap.permanentDelegate?.delegate),
      nonTransferable: "nonTransferable" in extMap,
      pausable: Boolean(extMap.pausableConfig?.authority || extMap.pausableConfig?.paused),
      transferHook: Boolean(extMap.transferHook?.programId),
      transferFeeBps: feeBps,
      defaultFrozen: extMap.defaultAccountState?.accountState === "frozen",
      metadataMutable: metadata ? Boolean(metadata.isMutable) : null,
    },
    authorities: {
      mint: facts.mintAuthority,
      freeze: facts.freezeAuthority,
      metadataUpdate: metadata?.updateAuthority ?? null,
    },
    extensions: extensions.map((e) => e.extension),
    holders,
    launch,
    age,
    limitations,
    disclaimer:
      "Automated on-chain checks, not financial advice. They can't detect off-chain promises, hidden team wallets, coordinated selling or every scam pattern.",
  };
}
