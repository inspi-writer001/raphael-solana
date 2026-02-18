# Raphael

Autonomous Solana agent wallet — installable as an OpenClaw skill.

Tell your agent: _"check my balance", "transfer 0.5 SOL", "find 3x plays", "run the trading agent"_ — it handles everything on-chain, autonomously.

## What it does

- **Multi-wallet management** — create and name wallets, private keys encrypted at rest
- **SOL + SPL transfers** — signed and broadcast without manual input
- **pump.fun graduation detection** — live WebSocket feed, scores newly graduated tokens
- **Jupiter V6 swaps** — best-route token swaps across all Solana DEXes
- **Autonomous trading loop** — continuous monitoring + 3x strategy execution
- **OpenClaw skill** — installable via ClawHub, agent understands natural language commands

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/inspiration-gx/raphael-solana
cd raphael-solana
pnpm install

# 2. Configure environment
cp .env.example .env
# Set MASTER_ENCRYPTION_PASSWORD_CRYPTO in .env, then:
MASTER_ENCRYPTION_PASSWORD_CRYPTO=your-password pnpm setup
# Copy the output MASTER_ENCRYPTED + MASTER_SALT into .env

# 3. Create your first wallet
pnpm dev -- wallet create trader1
# Fund it on devnet:
solana airdrop 2 <public-key> --url devnet

# 4. Check balance
pnpm dev -- balance trader1

# 5. Start the autonomous agent (dry-run)
pnpm dev -- agent trader1 --dry-run
```

## CLI reference

```
solana-wallet wallet create <name> [--network devnet|mainnet-beta]
solana-wallet wallet list
solana-wallet balance <wallet-name>
solana-wallet transfer sol <from> <to> <amount>
solana-wallet transfer spl <from> <to> <mint> <amount>
solana-wallet swap <wallet> <input-mint> <output-mint> <amount-sol>
solana-wallet find-pairs [--min-score 60]
solana-wallet trade <wallet> [--strategy 3x] [--max-risk 5] [--dry-run]
solana-wallet agent <wallet> [--interval 300] [--max-risk 5] [--dry-run]
```

## OpenClaw skill install

```bash
# Install via ClawHub
clawhub install solana-wallet

# Then just talk to your agent:
# "OpenClaw, check my Solana balance for wallet trader1"
# "Find good 3x plays"
# "Transfer 0.1 SOL from trader1 to <address>"
```

## Security model

Three-layer encryption — your private keys are never in plaintext on disk:

```
MASTER_ENCRYPTION_PASSWORD_CRYPTO  (memory only, from env var)
  ↓ PBKDF2 (100k iterations, SHA-256)
MASTER_ENCRYPTED + MASTER_SALT     (in .env — useless without the password)
  ↓ AES-256-GCM decrypt → master key
wallet private key                 (AES-256-GCM encrypted, in ~/.solana-agent-wallets.json)
```

## The 3x strategy

1. Connects to `pumpportal.fun` WebSocket for real-time pump.fun events
2. Tracks buy/sell pressure + SOL volume per token on the bonding curve
3. On **graduation** (token completes bonding curve → migrates to Raydium):
   - Scores the token 0-100 based on buy pressure, volume, trade count
   - Confirms Raydium liquidity via DexScreener
   - If score ≥ 65 and liquidity ≥ $10k → executes a Jupiter swap
4. Target: 3x | Stop-loss: 30%

## Architecture

```
src/
  environment.ts   env vars (lazy validation)
  crypto.ts        AES-GCM + PBKDF2 (Web Crypto API)
  db.ts            JSON wallet store
  wallet.ts        create / load / list wallets
  balance.ts       SOL + SPL balances
  transfer.ts      SOL + SPL transfers
  swap.ts          Jupiter V6 swaps
  screener.ts      pump.fun WebSocket + scoring
  strategy.ts      3x decision engine
  agent.ts         autonomous loop
  types.ts         all TypeScript types

bin/
  solana-wallet.ts  CLI entry point

skills/
  solana-wallet/
    SKILL.md        OpenClaw skill descriptor
```

## Devnet demo

```bash
# Create wallet
pnpm dev -- wallet create trader1

# Fund it
solana airdrop 2 $(pnpm dev -- balance trader1 --json | jq -r '.publicKey') --url devnet

# Check balance
pnpm dev -- balance trader1

# Find 3x plays (pump.fun graduation analysis)
pnpm dev -- find-pairs

# Dry-run the strategy
pnpm dev -- trade trader1 --strategy 3x --dry-run

# Run autonomous agent
pnpm dev -- agent trader1 --interval 60 --dry-run
```

## Tech stack

- TypeScript ESM, Node 22, pnpm
- `@solana/web3.js` + `@solana/spl-token`
- Jupiter V6 REST API (fetch — no SDK)
- pump.fun WebSocket via `ws`
- DexScreener REST API (free, no key)
- Web Crypto API (built-in, no external crypto dep)
- OpenClaw SKILL.md → ClawHub registry
