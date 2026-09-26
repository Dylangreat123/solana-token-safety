# Solana Token Safety Report

A small web service that sells one thing: a safety report for any Solana
token, for **2 cents in USDC per report**. Buyers are mostly AI agents. They
pay automatically with the x402 payment standard, so nobody needs an account
or an API key.

You send it a token address and it answers these questions:

- Can the creator still mint more tokens or freeze people's tokens?
- Does the token use risky Token-2022 features, such as a permanent delegate that
  can take tokens from any wallet, transfer taxes, transfer hooks or pausing?
- How much of the supply sits in a few wallets? Liquidity pools, launch curves
  and locks are counted separately from wallets.
- Is it still on the pump.fun launch curve, or has it graduated?
- How old is it?

It returns a risk level (low, medium, high or critical), a 0–100 safety score
and a plain-English verdict. Well-known stablecoins like USDC aren't flagged
for their normal issuer controls.

**Your server never holds a private key.** Buyers pay straight to your wallet
address. A payment company (the PayAI facilitator) checks each payment and pays
the Solana network fee. If a report fails (bad address, not a token, chain
data unavailable), the buyer is not charged.

---

## What it costs to run

| Item | Cost |
|---|---|
| Railway hosting | About $5/month (Hobby plan); new accounts get $5 of trial credit for 30 days |
| Helius (Solana data) | Free plan: 1M credits a month and 10 requests a second, plenty to start |
| PayAI facilitator | Free for your first payments, then $0.001 per payment (5% of a 2¢ sale) |
| Network fees | Paid by the facilitator, not you |

Realistic expectation: agent payment demand is small today, so early income
may be only a few dollars. This is an early bet on a growing market.

---

## Setup (about 30–45 minutes)

### 1. Make a payout wallet
1. In Phantom, add a **new account** just for this service.
2. Copy its **Solana address** (the public address, which is safe to share).
   Never copy or share your recovery phrase or private key anywhere in this setup.

### 2. Send that wallet a little USDC (required)
Send any amount of USDC ($1 is fine) to the new address, for example from your
main Phantom account (Send, then USDC, then paste the address). This creates
the wallet's USDC account. **Until you do this, every payment will fail**,
because a buyer's payment can't create that account for you.

### 3. Get a free Helius key
1. Sign up at [helius.dev](https://www.helius.dev).
2. In the dashboard, copy your **mainnet RPC URL**. It looks like
   `https://mainnet.helius-rpc.com/?api-key=...`. Treat it like a password.

### 4. Put the code on GitHub
1. On github.com, create a **new repository** called `solana-token-safety`
   (private is fine).
2. Click **"uploading an existing file"**, drag in everything from this folder
   (all files and folders), then click **Commit changes**.

### 5. Deploy on Railway
1. Go to [railway.com](https://railway.com) and sign in with GitHub.
2. Click **New Project**, then **Deploy from GitHub repo**, and pick
   `solana-token-safety`. If asked, let Railway access that repository.
3. Open the new service, go to **Variables** and add:

   | Name | Value |
   |---|---|
   | `PAY_TO` | Your payout wallet address from step 1 |
   | `RPC_URL` | Your Helius URL from step 3 |

4. Go to **Settings**, then **Networking**, and click **Generate Domain**.
   Copy the address it gives you (like `https://solana-token-safety-production.up.railway.app`).
5. Back in **Variables**, add `PUBLIC_URL` with that address. Railway redeploys
   automatically.

### 6. Check it works
Open these in your browser (use your own address):

- `https://YOUR-ADDRESS/health` should show `"payoutReady": true`. If it says
  `false`, redo step 2.
- `https://YOUR-ADDRESS/v1/sample-report` should show a full report for the BONK
  token, including a `holders` section.
- `https://YOUR-ADDRESS/v1/token-report?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`
  should say payment is required. That's correct: this is the paid route.

### 7. Get listed on Pay.sh (so agents can find you)
Send Claude your Railway address. Claude will run the official catalog check
against your live service and make the two listing files for you, using
`node scripts/make-listing.js https://YOUR-ADDRESS your-github-username`. Then:

1. Open [github.com/solana-foundation/pay-skills](https://github.com/solana-foundation/pay-skills)
   and click **Fork**.
2. In your fork, click **Add file**, then **Upload files**, and upload `PAY.md`
   and `openapi.json` into the folder
   `providers/<your-github-username>/solana-token-safety/`.
3. Click **Contribute**, then **Open pull request**. The Pay.sh maintainers review it.

---

## Settings

| Variable | Required | What it does |
|---|---|---|
| `PAY_TO` | Yes | Public address that receives USDC. |
| `RPC_URL` | Strongly recommended | Solana mainnet RPC. Without it, the public endpoint is used, and it blocks the holder check. |
| `PUBLIC_URL` | Recommended | Your service's public address, used in the docs it serves. |
| `PRICE_USD` | No | Price per report in dollars. Default `0.02`. |
| `NETWORK` | No | `mainnet` (default) or `devnet` for test payments. |
| `FACILITATOR_URL` | No | Defaults to the PayAI facilitator. |

To change the price, edit `PRICE_USD` in Railway. If you're listed on Pay.sh,
update the listing too.

---

## Try a real paid request yourself (optional, costs 2¢)

1. Install the pay CLI: `npm install -g @solana/pay`
2. Run `pay setup`, then fund the wallet it creates with a dollar of USDC.
3. Run:
   ```
   pay curl "https://YOUR-ADDRESS/v1/token-report?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
   ```

---

## For developers

```
npm install
npm test                      # offline tests
PAY_TO=<address> npm start    # run locally on port 3000
node test/live-check.js       # real reports against mainnet (set RPC_URL)
node test/local-e2e.js        # full pay-and-settle test; needs solana-test-validator running
```

- `src/report.js` gathers on-chain facts (RPC only, no third-party data).
- `src/rules.js` turns facts into findings, a level, a score and the verdict.
- `src/server.js` handles the free routes and the x402-paid `/v1/token-report`.
- Routes: `/` (info), `/health`, `/openapi.json`, `/v1/sample-report` (free),
  `/v1/token-report?mint=` (paid).

## Notes

- Reports are automated on-chain checks, not financial advice. They can't see
  off-chain promises, hidden team wallets or coordinated selling.
- USDC you earn is income for tax purposes; keep records.
- Never commit a private key, recovery phrase or your Helius key to GitHub.
  The key belongs only in Railway's Variables.
