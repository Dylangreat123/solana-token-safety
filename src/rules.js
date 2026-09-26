// Turns the raw facts about a token into findings, a risk level, a 0-100
// safety score and a plain-English verdict. Everything here is deterministic:
// the same facts always produce the same report.

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];
const PENALTY = { critical: 45, high: 20, medium: 8, low: 2, info: 0 };
// Score band for each level, so the number never contradicts the label.
const BANDS = { low: [80, 100], medium: [50, 79], high: [20, 49], critical: [0, 19] };

const fmtPct = (n) => {
  if (n >= 10) return `${Math.round(n)}%`;
  if (n >= 1) return `${n.toFixed(1)}%`;
  return `${n.toFixed(2)}%`;
};

function finding(id, severity, title, detail) {
  return { id, severity, title, detail };
}

function extensionMap(extensions) {
  const map = {};
  for (const e of extensions ?? []) {
    if (e && typeof e.extension === "string") map[e.extension] = e.state ?? {};
  }
  return map;
}

function maxTransferFeeBps(cfg) {
  const a = Number(cfg?.olderTransferFee?.transferFeeBasisPoints ?? 0);
  const b = Number(cfg?.newerTransferFee?.transferFeeBasisPoints ?? 0);
  return Math.max(a, b);
}

/**
 * @param facts {{
 *   program: "spl-token" | "token-2022",
 *   supply: bigint,
 *   mintAuthority: string | null,
 *   freezeAuthority: string | null,
 *   extensions: Array<{extension: string, state: object}>,
 *   metadata: null | { isMutable: boolean },
 *   launch: null | { platform: string, stage: "bonding-curve" | "graduated" },
 *   holders: null | { largestWalletPct: number, top10WalletsPct: number },
 *   age: null | { exact: boolean, days: number },
 *   knownAsset: null | { name: string, issuer: string, kind: string },
 * }}
 */
export function evaluate(facts) {
  const findings = [];
  const ext = extensionMap(facts.extensions);
  const known = facts.knownAsset;
  // Issuer controls on well-known assets are expected, so they are reported
  // as context rather than as risks.
  const sev = (s) => (known ? "info" : s);

  // --- Mint and freeze authority ------------------------------------------
  if (facts.mintAuthority) {
    findings.push(finding("mint_authority", sev("high"), "Supply can still grow",
      "The creator can still mint new tokens, which could dilute holders or be sold into the market."));
  }
  if (facts.freezeAuthority) {
    findings.push(finding("freeze_authority", sev("high"), "Holders can be frozen",
      "The creator can freeze any holder's tokens, a common way to stop people from selling."));
  }

  // --- Token-2022 extensions ------------------------------------------------
  if (ext.permanentDelegate?.delegate) {
    findings.push(finding("permanent_delegate", sev("critical"), "Tokens can be taken from any wallet",
      "A permanent delegate can move or burn tokens from any holder's wallet without their permission."));
  }
  if ("nonTransferable" in ext) {
    findings.push(finding("non_transferable", sev("critical"), "Tokens cannot be transferred or sold",
      "This token is non-transferable, so holders can't sell it or send it anywhere."));
  }
  if (ext.pausableConfig) {
    if (ext.pausableConfig.paused === true) {
      findings.push(finding("paused", sev("critical"), "Transfers are paused right now",
        "The creator has paused all transfers; nobody can move or sell this token until it is unpaused."));
    } else if (ext.pausableConfig.authority) {
      findings.push(finding("pausable", sev("high"), "Transfers can be paused",
        "The creator can pause all transfers at any time, which would stop holders from selling."));
    }
  }
  if (ext.defaultAccountState?.accountState === "frozen") {
    findings.push(finding("default_frozen", sev("high"), "New holders start frozen",
      "New token accounts start frozen, so the creator decides who is allowed to trade."));
  }
  if (ext.transferHook) {
    if (ext.transferHook.programId) {
      findings.push(finding("transfer_hook", sev("high"), "Custom code runs on every transfer",
        "Every transfer runs a program chosen by the creator, which can block or tax sales."));
    } else if (ext.transferHook.authority) {
      findings.push(finding("transfer_hook_addable", sev("medium"), "A transfer hook can be added later",
        "The creator can later attach a program that runs on every transfer and could block sales."));
    }
  }
  if (ext.transferFeeConfig) {
    const bps = maxTransferFeeBps(ext.transferFeeConfig);
    const canChange = Boolean(ext.transferFeeConfig.transferFeeConfigAuthority);
    if (bps > 0) {
      const p = bps / 100;
      findings.push(finding("transfer_fee", sev(bps > 500 ? "high" : "medium"), `${p}% tax on every transfer`,
        `Each transfer loses ${p}% to a fee the creator can collect${canChange ? ", and the creator can change the rate" : ""}.`));
    } else if (canChange) {
      findings.push(finding("transfer_fee_addable", sev("medium"), "A transfer tax can be switched on",
        "The creator can add a fee on every transfer later."));
    }
  }
  if (ext.scaledUiAmountConfig || ext.interestBearingConfig) {
    findings.push(finding("changing_balances", sev("low"), "Displayed balances can change",
      "Wallet balances are shown through a multiplier or interest rate that the creator controls."));
  }
  if (ext.confidentialTransferMint) {
    findings.push(finding("confidential_transfers", sev("low"), "Balances can be hidden",
      "Confidential transfers are enabled, so some balances and amounts may not be visible on-chain."));
  }
  if (ext.mintCloseAuthority?.closeAuthority) {
    findings.push(finding("mint_close_authority", "info", "Mint can be closed",
      "The mint account can be closed once the supply reaches zero."));
  }

  // --- Metadata ------------------------------------------------------------
  if (!facts.metadata) {
    findings.push(finding("no_metadata", sev("low"), "No name or image found",
      "No token metadata was found, so the name and symbol can't be confirmed."));
  } else if (facts.metadata.isMutable) {
    findings.push(finding("mutable_metadata", sev("low"), "Name and image can change",
      "The token's name, symbol and image can still be changed by its update authority."));
  }

  // --- Holder concentration -------------------------------------------------
  if (facts.holders) {
    const { largestWalletPct: top1, top10WalletsPct: top10 } = facts.holders;
    if (top1 > 10) {
      findings.push(finding("whale_wallet", sev(top1 > 20 ? "high" : "medium"), `One wallet holds ${fmtPct(top1)}`,
        `A single wallet holds ${fmtPct(top1)} of the supply and could move the price sharply by selling (it may be an exchange, the team or a whale).`));
    }
    if (top10 > 30) {
      findings.push(finding("concentrated_top10", sev(top10 > 50 ? "high" : "medium"), `Top 10 wallets hold ${fmtPct(top10)}`,
        `The 10 largest wallets hold ${fmtPct(top10)} of the supply combined, so a few holders control the price.`));
    }
    // Program-controlled accounts we can't identify (or multisigs, which are
    // usually team treasuries) aren't counted as wallets above, so flag big ones.
    const opaque = (facts.holders.top ?? []).find(
      (h) => h.kind === "program" && (h.label === null || h.label === "Squads multisig") && h.pct > 20,
    );
    if (opaque) {
      const what = opaque.label === "Squads multisig" ? "A multisig (usually a team treasury)" : "An unidentified program-controlled account";
      findings.push(finding("large_program_holder", sev("medium"), `${what.replace(/ \(.*\)/, "")} holds ${fmtPct(opaque.pct)}`,
        `${what} holds ${fmtPct(opaque.pct)} of the supply; it may be a pool or lock, but it could also be sold by whoever controls it.`));
    }
  } else if (facts.supply > 0n) {
    findings.push(finding("holders_unavailable", "info", "Holder data unavailable",
      "The largest holders couldn't be fetched, so concentration wasn't checked."));
  }
  if (facts.supply === 0n) {
    findings.push(finding("zero_supply", "info", "No tokens in circulation",
      "The current supply is zero."));
  }

  // --- Launch stage and age ----------------------------------------------------
  if (facts.launch?.platform === "pump.fun") {
    if (facts.launch.stage === "bonding-curve") {
      findings.push(finding("pumpfun_bonding_curve", "medium", "Still on the pump.fun launch curve",
        "The token hasn't graduated from its pump.fun bonding curve; most tokens never do, and prices swing hard at this stage."));
    } else {
      findings.push(finding("pumpfun_graduated", "info", "Graduated from pump.fun",
        "The token completed its pump.fun bonding curve and its liquidity moved to a PumpSwap pool."));
    }
  }
  if (facts.age?.exact && !known) {
    if (facts.age.days < 1) {
      findings.push(finding("very_new", "medium", "Less than a day old",
        "The token was created less than a day ago, the riskiest window for rug pulls."));
    } else if (facts.age.days < 7) {
      findings.push(finding("new", "low", "Less than a week old",
        "The token is under a week old, so it has little track record."));
    }
  }

  // --- Level, score, verdict ----------------------------------------------
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const risky = findings.filter((f) => f.severity !== "info");
  const worst = risky[0]?.severity;
  const level = worst === "critical" ? "critical" : worst === "high" ? "high" : worst === "medium" ? "medium" : "low";

  const raw = 100 - findings.reduce((sum, f) => sum + PENALTY[f.severity], 0);
  const [lo, hi] = BANDS[level];
  const safetyScore = Math.max(lo, Math.min(hi, raw));

  return { level, safetyScore, findings, verdict: buildVerdict(level, risky, facts, ext) };
}

function buildVerdict(level, risky, facts, ext) {
  const opener = { critical: "Critical risk.", high: "High risk.", medium: "Moderate risk.", low: "Low risk." }[level];
  const parts = [opener];

  if (facts.knownAsset) {
    const k = facts.knownAsset;
    parts.push(`This is ${k.name}, a ${k.kind} from ${k.issuer}; issuer controls such as minting and freezing are expected for it.`);
  }

  if (risky.length) {
    parts.push(...risky.slice(0, 3).map((f) => f.detail));
    if (risky.length > 3) parts.push(`${risky.length - 3} more ${risky.length - 3 === 1 ? "issue is" : "issues are"} listed in the findings.`);
  } else if (!facts.knownAsset) {
    const ok = [];
    if (!facts.mintAuthority) ok.push("no one can mint more");
    if (!facts.freezeAuthority) ok.push("no one can freeze holders");
    if (facts.program === "spl-token" || Object.keys(ext).every((k) => ["metadataPointer", "tokenMetadata", "mintCloseAuthority", "immutableOwner"].includes(k))) {
      ok.push("no risky token extensions");
    }
    if (facts.holders) ok.push("no single wallet holds over 10%");
    parts.push(`No red flags in the on-chain checks: ${ok.join(", ")}.`);
  }

  if (!facts.holders && facts.supply > 0n && !facts.knownAsset) {
    parts.push("Holder concentration couldn't be checked this time.");
  }
  parts.push("Automated on-chain checks only, not financial advice.");
  return parts.join(" ");
}
