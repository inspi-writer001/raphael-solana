# Raphael

Autonomous Solana agent wallet — installable as an OpenClaw skill.

Tell your agent: _"check my balance", "transfer 0.5 SOL", "find 3x plays", "run the trading agent", "start weather arb for NYC"_ — it handles everything on-chain, autonomously.

## What it does

- **Multi-wallet management** — create and name wallets, private keys encrypted at rest
- **SOL + SPL transfers** — signed and broadcast without manual input
- **pump.fun graduation detection** — live WebSocket feed, scores newly graduated tokens
- **Jupiter V6 swaps** — best-route token swaps across all Solana DEXes
- **Autonomous trading loop** — continuous monitoring + 3x strategy execution
- **Weather arbitrage scanner** — NOAA point-forecast vs Polymarket YES token spread detection
- **Background scanner manager** — non-blocking `setInterval` runners for both strategies
- **OpenClaw skill** — natively links to your agent to understand natural language commands

## Prerequisites
- **Node.js 24+**: This project utilizes Node 24's native `--experimental-transform-types` flag, entirely bypassing the need for `tsc`, `ts-node`, or a `dist` folder.
- **OpenClaw**: Configured and running locally.

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/inspiration-gx/raphael-solana
cd raphael-solana
pnpm install

# 2. Create the global executable (No build step required)
cat << 'EOF' > /usr/local/bin/solana-wallet
#!/bin/bash
node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts "$@"
EOF
chmod +x /usr/local/bin/solana-wallet

# 3. Configure environment and Master Keys
cp .env.example .env
MASTER_ENCRYPTION_PASSWORD_CRYPTO=your-password node --experimental-transform-types scripts/setup-master-key.ts

# Open .env and paste the generated MASTER_ENCRYPTED + MASTER_SALT values.

# 4. Test the CLI
solana-wallet wallet create trader1 --network devnet
```

## OpenClaw Setup (Local Linking)

To allow your OpenClaw agent to autonomously use the wallet, you must link the skill, inject the environment variables, and grant terminal execution permissions.

### 1. Link the Skill
```bash
mkdir -p ~/.openclaw/workspace/skills
ln -snf ~/raphael-solana/skills/solana-wallet ~/.openclaw/workspace/skills/solana-wallet
```

### 2. Inject Environment Variables
OpenClaw runs its background daemon in an isolated context. Inject your keys directly into the global OpenClaw environment:
```bash
cat ~/raphael-solana/.env >> ~/.openclaw/.env

# Add your runtime password and RPC URL:
cat << 'EOF' >> ~/.openclaw/.env
MASTER_ENCRYPTION_PASSWORD_CRYPTO="your-password"
SOLANA_RPC_URL="https://api.devnet.solana.com"
EOF
```

### 3. Grant Execution Permissions
By default, OpenClaw agents are sandboxed and cannot execute terminal commands. Update `~/.openclaw/openclaw.json` to include the `exec` tool. For safety, it is highly recommended to enable approvals:
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
Ensure your agent knows it has wallet capabilities. Append a directive to `~/.openclaw/workspace/SOUL.md`:
```markdown
You are authorized to manage Solana wallets, execute trades, and utilize the `solana-wallet` terminal tool.
```

### 5. Restart and Chat
```bash
openclaw gateway restart
```
**In Telegram/Chat:** Send `System command: flush previous session memory` to clear out any old hallucinations, then say: _"Create a devnet wallet named alpha."_

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
solana-wallet scanner start pumpfun <wallet> [--interval 300] [--max-risk 5] [--dry-run]
solana-wallet scanner stop  pumpfun
solana-wallet scanner start weather-arb <wallet>
              --office <code> --grid-x <n> --grid-y <n>
              --threshold <F> --yes-token <mint> --amount <usdc>
              [--interval 120] [--dry-run]
solana-wallet scanner stop  weather-arb
solana-wallet scanner status
```

### Weather arb flags

| Flag | Default | Description |
|---|---|---|
| `--office` | required | NOAA office code (OKX = NYC, LOT = Chicago, SEW = Seattle) |
| `--grid-x` | required | NOAA gridpoint X coordinate |
| `--grid-y` | required | NOAA gridpoint Y coordinate |
| `--threshold` | required | Temperature in °F that the binary event is priced on |
| `--yes-token` | required | Polymarket YES SPL token mint on Solana |
| `--amount` | required | USDC to spend per trade |
| `--interval` | 120 | Poll interval in seconds |
| `--dry-run` | false | Log decisions without executing trades |

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

## The weather arbitrage strategy

Exploits the spread between NOAA gridpoint temperature forecasts and Polymarket binary-outcome YES token prices on Jupiter.

**Edge fires when both conditions hold:**
- NOAA forecast confidence ≥ 90%
- Jupiter-implied probability ≤ 40% (market underpricing the event)

**Confidence model:**

| Forecast vs threshold | Confidence |
|---|---|
| ≥ +5 °F above threshold | 95% |
| 0 – +4 °F above threshold | 70% |
| Below threshold | 10% |

Scanner polls every 2 minutes. Always start with `--dry-run` to review readings before going live.

## OpenClaw plugin tools

The skill exposes three tools via `src/plugin.ts` (entry point: `dist/plugin.js`):

| Tool | Description |
|---|---|
| `start_weather_arb` | Start the weather arb scanner with city + token config |
| `stop_weather_arb` | Stop the running weather arb scanner |
| `get_strategy_status` | Formatted status of both pumpfun and weather_arb scanners |

Your agent can invoke these directly without any CLI commands.

## Architecture

```
src/
  environment.ts      env vars (lazy validation)
  crypto.ts           AES-GCM + PBKDF2 (Web Crypto API)
  db.ts               JSON wallet store
  wallet.ts           create / load / list wallets
  balance.ts          SOL + SPL balances
  transfer.ts         SOL + SPL transfers
  swap.ts             Jupiter V6 swaps
  screener.ts         pump.fun WebSocket + scoring
  strategy.ts         3x decision engine
  agent.ts            runPumpfunTick (one tick) + runAgentLoop (CLI blocking loop)
  weatherArb.ts       NOAA fetch, confidence model, Jupiter implied odds, tick
  strategyManager.ts  setInterval singleton managing both scanners
  plugin.ts           OpenClaw plugin entry point (3 tools)
  types.ts            all TypeScript types

bin/
  solana-wallet.ts    CLI entry point

scripts/
  setup-master-key.ts  Encryption key generator

skills/
  solana-wallet/
    SKILL.md           OpenClaw skill descriptor + agent instructions
```
