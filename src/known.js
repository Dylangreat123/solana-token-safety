// Addresses the report recognizes. Every program ID below was checked on
// Solana mainnet (it exists and is an executable program) in September 2026.

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const METAPLEX_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Programs whose accounts commonly hold tokens on behalf of a pool, curve or lock.
export const KNOWN_PROGRAMS = {
  [PUMP_FUN_PROGRAM]: "pump.fun bonding curve",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "PumpSwap pool",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM pool",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: "Raydium CPMM pool",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM pool",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "Raydium LaunchLab curve",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM pool",
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: "Meteora DAMM v1 pool",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2 pool",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora bonding curve",
  "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi": "Meteora vault",
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: "Streamflow lock or vesting",
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: "Jupiter Lock",
  PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu: "Jupiter Perps pool",
  opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb: "OpenBook market",
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: "Phoenix market",
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: "Squads multisig",
  MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG: "Moonshot curve",
};

// Pool "authority" addresses that own vaults for many pools at once. They are
// program-derived (no private key) but have no data of their own, so they
// can't be recognized by their owner program. Derived from each program's
// published seeds.
export const KNOWN_AUTHORITIES = {
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "Raydium AMM pool",
  GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL: "Raydium CPMM pool",
  WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh: "Raydium LaunchLab curve",
  HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC: "Meteora DAMM v2 pool",
  FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM: "Meteora bonding curve",
};

// Tokens sent here can never be moved again.
export const BURN_ADDRESSES = new Set(["1nc1nerator11111111111111111111111111111111"]);

// Well-known assets whose issuers keep mint/freeze powers on purpose (for
// compliance), so those powers are reported as context rather than red flags.
export const KNOWN_ASSETS = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { name: "USD Coin (USDC)", issuer: "Circle", kind: "regulated stablecoin" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { name: "Tether USD (USDT)", issuer: "Tether", kind: "stablecoin" },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { name: "PayPal USD (PYUSD)", issuer: "Paxos", kind: "regulated stablecoin" },
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": { name: "Global Dollar (USDG)", issuer: "Paxos", kind: "regulated stablecoin" },
  HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr: { name: "Euro Coin (EURC)", issuer: "Circle", kind: "regulated stablecoin" },
  So11111111111111111111111111111111111111112: { name: "Wrapped SOL", issuer: "Solana (native)", kind: "native asset wrapper" },
};
