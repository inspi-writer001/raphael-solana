# SKILLS.md — Raphael

This file documents all capabilities of the agentic-wallet system for AI agents
and developers integrating with this toolkit.

## Overview

The agentic-wallet provides a Solana agent wallet with:

- Programmatic wallet creation and encrypted key storage
- Autonomous transaction signing (SOL + SPL tokens)
- Real-time pump.fun graduation signal detection via WebSocket
- Jupiter V6 swap execution
- Autonomous trading agent loop

---

## Skill: `solana-wallet`

**Category**: Blockchain / DeFi
**Network**: Solana (devnet + mainnet-beta)
**Install**: `clawhub install solana-wallet`

---

### Wallet Management

#### `createWallet(name, network?)`

Generate a new Solana keypair, encrypt the private key, and store it locally.

```ts
// Result: { name, publicKey, network, createdAt, tags }
solana-wallet wallet create trader1 --network devnet
```

#### `listWallets()`

List all managed wallets with public keys (private keys never exposed).

```
solana-wallet wallet list
```

#### `getPortfolioSummary(walletName)`

SOL balance + all SPL token holdings.

```
solana-wallet balance trader1
```

---

### Transfers

#### `transferSOL(from, to, amountSol)`

Sign and broadcast a SOL transfer. Returns signature + explorer URL.

```
solana-wallet transfer sol trader1 <recipient-address> 0.5
```

#### `transferSPL(from, to, mint, amount)`

Transfer an SPL token. Creates associated token accounts if needed.

```
solana-wallet transfer spl trader1 <recipient-address> <mint-address> 100
```

---

### Trading

#### `jupiterSwap(wallet, inputMint, outputMint, amountLamports)`

Swap tokens via Jupiter V6 aggregator. Best routing across all Solana DEXes.

```
solana-wallet swap trader1 SOL <token-mint> 0.1
```

#### `findHighPotentialPairs(minScore?)`

Scan the last 30 minutes of pump.fun graduation events from the live buffer.
Returns tokens scored 0-100 based on:

- Buy pressure on bonding curve (buys / total trades)
- SOL volume during bonding curve phase
- Total trade count (community interest)
- Confirmed Raydium liquidity (via DexScreener)

```
solana-wallet find-pairs --min-score 65
```

#### `threeXStrategy(portfolioSol, maxRiskPercent?)`

Automated trade decision engine. Scores recent pump.fun graduates, confirms
liquidity, sizes the position as a % of portfolio, checks SOL sufficiency.

```
solana-wallet trade trader1 --strategy 3x --dry-run
```

---

### Autonomous Agent

#### `runAgentLoop(config)`

Continuous monitoring loop:

1. Connects to pump.fun WebSocket for live graduation events
2. Scores incoming tokens in real-time
3. Runs threeXStrategy every `intervalSeconds`
4. Executes trades (or logs in dry-run mode)

```
solana-wallet agent trader1 --interval 300 --max-risk 5 --dry-run
```

**Config options:**
| Flag | Default | Description |
|---|---|---|
| `--interval` | 300 | Seconds between strategy evaluations |
| `--max-risk` | 5 | Max % of SOL portfolio per trade |
| `--dry-run` | false | Log decisions without executing |

---

## Security Model

| Layer | What                                                  | Where                        |
| ----- | ----------------------------------------------------- | ---------------------------- |
| 1     | Human password (MASTER_ENCRYPTION_PASSWORD_CRYPTO)    | Memory only, from env        |
| 2     | Encrypted master key (MASTER_ENCRYPTED + MASTER_SALT) | .env file                    |
| 3     | Encrypted wallet private keys (per-wallet salt)       | ~/.solana-agent-wallets.json |

- AES-256-GCM encryption with PBKDF2 key derivation (100k iterations, SHA-256)
- Private keys decrypted in memory only at signing time, never written back
- Master password never stored — must be in environment

---

## Required Environment Variables

| Variable                            | Required | Description                                               |
| ----------------------------------- | -------- | --------------------------------------------------------- |
| `MASTER_ENCRYPTION_PASSWORD_CRYPTO` | ✓        | Root password for key derivation                          |
| `MASTER_ENCRYPTED`                  | ✓        | Encrypted master key (base64)                             |
| `MASTER_SALT`                       | ✓        | Master key salt (base64)                                  |
| `SOLANA_RPC_URL`                    | ✓        | RPC endpoint (devnet or mainnet)                          |
| `WALLET_STORE_PATH`                 | optional | JSON store path (default: `~/.solana-agent-wallets.json`) |
| `PUMPPORTAL_WS`                     | optional | pump.fun WS (default: `wss://pumpportal.fun/api/data`)    |

---

### Background Scanner Manager

#### `strategyManager.startPumpfun(config)` / `stopPumpfun()`

Non-blocking `setInterval`-based pumpfun scanner. Wraps `runPumpfunTick` so the
strategy runs on a timer rather than a blocking `while(true)` loop.

```
solana-wallet scanner start pumpfun trader1 --interval 300 --dry-run
solana-wallet scanner stop  pumpfun
solana-wallet scanner status
```

#### `strategyManager.startWeatherArb(config)` / `stopWeatherArb()`

Polls NOAA gridpoint forecasts and Jupiter DEX to detect spread opportunities on
Polymarket YES SPL tokens. Buys when NOAA confidence ≥ `minConfidence` (default 90%)
and Jupiter implied odds ≤ `maxJupiterOdds` (default 40%).

```
solana-wallet scanner start weather-arb trader1 \
  --office OKX --grid-x 33 --grid-y 35 \
  --threshold 50 --yes-token <mint> --amount 10 --dry-run
solana-wallet scanner stop  weather-arb
```

**Config parameters:**
| Parameter | Default | Description |
|---|---|---|
| `--office` | required | NOAA office code (e.g. OKX=NYC, LOT=Chicago, SEW=Seattle) |
| `--grid-x` | required | NOAA gridpoint X coordinate |
| `--grid-y` | required | NOAA gridpoint Y coordinate |
| `--threshold` | required | Temperature threshold in °F for the binary event |
| `--yes-token` | required | Polymarket YES SPL token mint address (user-provided) |
| `--amount` | required | USDC to spend per trade |
| `--interval` | 120 | Poll interval in seconds |
| `--dry-run` | false | Log decisions without executing trades |

**Required environment variables:** same as existing (`SOLANA_RPC_URL`, `MASTER_ENCRYPTION_PASSWORD_CRYPTO`, `MASTER_ENCRYPTED`, `MASTER_SALT`).

**OpenClaw plugin tools:**
- `start_weather_arb` — start scanner with city + token config
- `stop_weather_arb` — stop running scanner
- `get_strategy_status` — formatted status of both scanners

**Note:** Polymarket YES token mints are user-provided parameters. Find the correct mint for your market at [polymarket.com](https://polymarket.com) or via the Polymarket API.

---

## Signal Sources

| Source                     | Type      | Use                                       |
| -------------------------- | --------- | ----------------------------------------- |
| `pumpportal.fun` WebSocket | Real-time | Primary: graduation events                |
| DexScreener REST API       | Polling   | Secondary: Raydium liquidity confirmation |
| Jupiter V6 Quote API       | On-demand | Pre-trade routing + output estimation     |

---

## Data Flow

```
pump.fun WebSocket
  └─ graduation event
       └─ scoreGraduatedToken() → ScoredToken (0-100)
            └─ confirmOnDexScreener() → liquidity check
                 └─ threeXStrategy() → TradeDecision
                      └─ jupiterSwap() → SwapResult
                           └─ explorerUrl logged + returned
```
