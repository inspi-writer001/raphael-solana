# Raphael

Autonomous Solana + Polygon agent wallet — installable as an OpenClaw skill.

Tell your agent: _"create an EVM wallet", "check my USDC balance", "start the weather arb scanner", "check status"_ — it handles everything on-chain, autonomously.

## What it does

- **Solana wallet management** — create and name wallets, private keys encrypted at rest
- **EVM wallet management** — create Polygon wallets for Polymarket trading (separate secp256k1 keys)
- **SOL + SPL transfers** — signed and broadcast without manual input
- **Raydium swaps** — direct-route token swaps via Raydium Trade API
- **pump.fun graduation detection** — live WebSocket feed, scores newly graduated tokens
- **Polymarket weather arbitrage** — Open-Meteo global forecasts vs Polymarket bracket prices; buys underpriced YES shares across 9 cities
- **Background scanner manager** — non-blocking `setInterval` daemon for the weather arb strategy
- **OpenClaw plugin** — 6 tools for natural language control via your agent

## Prerequisites

- **Node.js 22+** (uses native fetch — no node-fetch needed)
- **pnpm** — package manager
- **tsx** — TypeScript runner (installed as dev dependency)
- **OpenClaw** — configured and running locally

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/inspiration-gx/raphael-solana
cd raphael-solana
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your values, then generate the master key:
MASTER_ENCRYPTION_PASSWORD_CRYPTO=your-password pnpm tsx scripts/setup-master-key.ts
# Paste the output MASTER_ENCRYPTED and MASTER_SALT into .env

# 3. Test the CLI
pnpm tsx bin/solana-wallet.ts wallet create trader1 --network devnet
```

## OpenClaw Setup

### 1. Link the Skill
```bash
mkdir -p ~/.openclaw/workspace/skills
ln -snf ~/raphael-solana/skills/solana-wallet ~/.openclaw/workspace/skills/solana-wallet
```

### 2. Inject Environment Variables
```bash
cat ~/raphael-solana/.env >> ~/.openclaw/.env

cat << 'EOF' >> ~/.openclaw/.env
MASTER_ENCRYPTION_PASSWORD_CRYPTO="your-password"
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
EOF
```

### 3. Grant Execution Permissions
Update `~/.openclaw/openclaw.json`:
```json
{
  "tools": {
    "allow": ["exec", "read", "write"]
  },
  "approvals": {
    "exec": { "enabled": true }
  }
}
```

### 4. Update Agent Identity
Append to `~/.openclaw/workspace/SOUL.md`:
```markdown
You are authorized to manage Solana and Polygon wallets, execute trades, and use the `solana-wallet` terminal tool. You have 6 plugin tools for Polymarket weather arbitrage.
```

### 5. Restart and Chat
```bash
openclaw gateway restart
```

## CLI reference

```
solana-wallet wallet create <name> [--network devnet|mainnet-beta]
solana-wallet wallet list
solana-wallet evm-wallet create <name>
solana-wallet evm-wallet list
solana-wallet evm-wallet balance <name> [--token <erc20-address>]
solana-wallet balance <wallet-name>
solana-wallet transfer sol <wallet> <to-address> <amount>
solana-wallet transfer spl <wallet> <to-address> <mint> <amount>
solana-wallet swap <wallet> SOL <output-mint> <amount>
solana-wallet find-pairs
solana-wallet scanner start polymarket-weather <evm-wallet-name>
              --amount <usdc-per-trade>
              [--cities nyc,london,seoul,chicago,dallas,miami,paris,toronto,seattle]
              [--max-position <usdc>]
              [--min-edge 0.20]
              [--min-fair-value 0.40]
              [--interval <seconds>]
              [--dry-run]
solana-wallet scanner stop
solana-wallet scanner status
```

### Polymarket weather scanner flags

| Flag | Default | Description |
|---|---|---|
| `--amount` | required | USDC to spend per trade |
| `--cities` | all 9 | Comma-separated city keys (see table below) |
| `--max-position` | 10 | Hard cap USDC per bracket |
| `--min-edge` | 0.20 | Minimum edge (fairValue − askPrice) to trigger a trade |
| `--min-fair-value` | 0.40 | Minimum fair probability to consider trading |
| `--interval` | 120 | Poll interval in seconds |
| `--dry-run` | false | Log decisions without placing orders |

### Supported cities

| Key | City | Exchange |
|---|---|---|
| `nyc` | New York City | Polymarket |
| `london` | London | Polymarket |
| `seoul` | Seoul | Polymarket |
| `chicago` | Chicago | Polymarket |
| `dallas` | Dallas | Polymarket |
| `miami` | Miami | Polymarket |
| `paris` | Paris | Polymarket |
| `toronto` | Toronto | Polymarket |
| `seattle` | Seattle | Polymarket |

## Security model

Three-layer encryption — private keys are never in plaintext on disk:

```
MASTER_ENCRYPTION_PASSWORD_CRYPTO  (memory only, from env var)
  ↓ PBKDF2 (100k iterations, SHA-256)
MASTER_ENCRYPTED + MASTER_SALT     (in .env — useless without the password)
  ↓ AES-256-GCM decrypt → master key
wallet private key                 (AES-256-GCM encrypted, per-wallet salt)
  Solana wallets → ~/.raphael/wallets.json
  EVM wallets    → ~/.raphael/evm-wallets.json
```

## The 3x strategy

1. Connects to `pumpportal.fun` WebSocket for real-time pump.fun events
2. Tracks buy/sell pressure + SOL volume per token on the bonding curve
3. On **graduation** (token completes bonding curve → migrates to Raydium):
   - Scores the token 0-100 based on buy pressure, volume, trade count
   - Confirms Raydium liquidity via DexScreener
   - If score ≥ 65 and liquidity ≥ $10k → executes a Raydium swap
4. Target: 3x | Stop-loss: 30%

## The Polymarket weather arbitrage strategy

Exploits the spread between **Open-Meteo global temperature forecasts** and **Polymarket binary bracket prices** for the same city.

**How it works:**
1. Fetches today's high temperature forecast from Open-Meteo (free, global, no API key)
2. Fetches open Polymarket weather bracket markets for the city via the Gamma API
3. Computes **fair probability** for each bracket using a normal distribution:
   - σ = 2°F for same-day markets, σ = 4°F for next-day markets
   - P(bracket) = CDF(hi + 0.5°F) − CDF(lo − 0.5°F)
4. Compares fair probability to the Polymarket ask price (edge = fair − ask)
5. Places a YES order via the Polymarket CLOB if edge ≥ `minEdge` and fair value ≥ `minFairValue`

**Risk controls:**
- Hard cap per bracket (`--max-position`, default $10)
- Already-positioned check (won't double-up on the same bracket)
- USDC balance check before every order
- `--dry-run` mode logs all decisions without placing orders

**Requires a funded Polygon wallet.** Bridge USDC from Solana or an exchange to your Polygon address using [Portal Bridge](https://portalbridge.com) or withdraw directly from an exchange that supports Polygon PoS.

Always run with `--dry-run` first to verify edge detection is working before going live.

## OpenClaw plugin tools

The skill exposes **6 tools** via `src/plugin.ts`:

| Tool | Description |
|---|---|
| `create_evm_wallet` | Create a Polygon wallet; returns the address to send USDC to |
| `list_evm_wallets` | List existing EVM wallets and their Polygon addresses |
| `check_usdc_balance` | Check USDC.e balance on Polygon to confirm funds arrived |
| `start_weather_arb` | Start the Polymarket weather arb scanner (use `dry_run: true` first) |
| `stop_weather_arb` | Stop the running scanner |
| `get_strategy_status` | Per-city forecast, bracket, edge%, and skip reasons |

Your agent can invoke these directly without any CLI commands.

## Architecture

```
src/
  environment.ts          env vars (lazy validation, accessed at call time)
  crypto.ts               AES-GCM + PBKDF2 (Web Crypto API)
  db.ts                   JSON wallet store (Solana)
  wallet.ts               create / load / list Solana wallets
  evmWallet.ts            create / load / list EVM wallets (Polygon/secp256k1)
  balance.ts              SOL + SPL balances
  evmBalance.ts           MATIC + ERC-20 balances on Polygon
  transfer.ts             SOL + SPL transfers
  swap.ts                 Raydium Trade API swaps (3-step; direct route; min 1M lamports)
  screener.ts             pump.fun WebSocket + scoring
  strategy.ts             3x decision engine
  agent.ts                runPumpfunTick (one tick) + runAgentLoop (CLI blocking loop)
  polymarketOracle.ts     Open-Meteo forecast, Polymarket Gamma bracket fetch, normal-CDF pricing
  polymarketClob.ts       Polymarket CLOB L1/L2 auth, placeOrder, getOpenOrders, cancelOrder
  polymarketWeatherArb.ts runPolymarketWeatherArbTick — per-city scan → position check → order
  strategyManager.ts      setInterval singleton managing the weather arb daemon
  plugin.ts               OpenClaw plugin entry point (6 tools)
  types.ts                all TypeScript types

bin/
  solana-wallet.ts        CLI entry point

scripts/
  setup-master-key.ts     Encryption key generator

skills/
  solana-wallet/
    SKILL.md              OpenClaw skill descriptor + agent instructions
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MASTER_ENCRYPTION_PASSWORD_CRYPTO` | ✓ | Root password for key derivation |
| `MASTER_ENCRYPTED` | ✓ | Encrypted master key (base64) |
| `MASTER_SALT` | ✓ | Master key salt (base64) |
| `SOLANA_RPC_URL` | optional | RPC endpoint (default: devnet) |
| `RAPHAEL_DATA_DIR` | optional | Data directory (default: `~/.raphael`) |
| `WALLET_STORE_PATH` | optional | Solana wallet JSON (default: `$RAPHAEL_DATA_DIR/wallets.json`) |
| `EVM_WALLET_STORE_PATH` | optional | EVM wallet JSON (default: `$RAPHAEL_DATA_DIR/evm-wallets.json`) |
| `PUMPPORTAL_WS` | optional | pump.fun WS (default: `wss://pumpportal.fun/api/data`) |
