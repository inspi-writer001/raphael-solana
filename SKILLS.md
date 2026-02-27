# SKILLS.md — Raphael

This file documents all capabilities of the agentic-wallet system for AI agents
and developers integrating with this toolkit.

## Overview

The agentic-wallet provides a Solana + Polygon agent wallet with:

- Programmatic wallet creation and encrypted key storage (Solana + EVM)
- Autonomous transaction signing (SOL + SPL tokens)
- Real-time pump.fun graduation signal detection via WebSocket
- Raydium Trade API token swaps
- Polymarket weather arbitrage across 9 global cities
- 6 OpenClaw plugin tools for natural language control

---

## Skill: `solana-wallet`

**Category**: Blockchain / DeFi
**Networks**: Solana (devnet + mainnet-beta), Polygon PoS
**Install**: `clawhub install solana-wallet`

---

### Solana Wallet Management

#### `createWallet(name, network?)`

Generate a new Solana keypair, encrypt the private key, and store it locally.

```
solana-wallet wallet create trader1 --network devnet
```

#### `listWallets()`

List all managed Solana wallets with public keys (private keys never exposed).

```
solana-wallet wallet list
```

#### `getPortfolioSummary(walletName)`

SOL balance + all SPL token holdings.

```
solana-wallet balance trader1
```

---

### EVM Wallet Management (Polygon)

EVM wallets are separate from Solana wallets — they use secp256k1 keys and live on Polygon PoS. Required for Polymarket trading.

#### `createEvmWallet(name)`

Generate a new Polygon/EVM keypair, encrypt, and store it locally. Returns the Polygon address for funding.

```
solana-wallet evm-wallet create polymarket1
```

#### `listEvmWallets()`

List all managed EVM wallets with Polygon addresses.

```
solana-wallet evm-wallet list
```

#### `evmBalance(name)`

MATIC balance + optional ERC-20 token balance.

```
solana-wallet evm-wallet balance polymarket1
solana-wallet evm-wallet balance polymarket1 --token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
```

---

### Solana Transfers

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

### Solana Trading

#### `raydiumSwap(wallet, inputMint, outputMint, amountLamports)`

Swap tokens via Raydium Trade API. Direct route only (`maxHops=1`). Minimum 1,000,000 lamports (~$0.20).

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
solana-wallet find-pairs
```

---

### Polymarket Weather Arbitrage

Exploits the spread between Open-Meteo global temperature forecasts and Polymarket binary bracket prices.

**Edge model:**
- Fetches high-temperature forecast from Open-Meteo (free, global)
- Fetches open Polymarket brackets via Gamma API (public)
- Computes fair probability using a normal CDF (σ=2°F same-day, σ=4°F next-day)
- Places YES orders when `fairValue − askPrice ≥ minEdge`

**Cities supported:** nyc, london, seoul, chicago, dallas, miami, paris, toronto, seattle

#### `runPolymarketWeatherArbTick(config, onReading)`

One tick of the weather arb scanner. Called on a timer by `strategyManager`.

#### `strategyManager.startWeatherArb(config)` / `stopWeatherArb()`

Daemon scanner. Polls forecasts and places orders on a configurable interval.

```bash
# Via CLI:
solana-wallet scanner start polymarket-weather polymarket1 \
  --amount 5 --cities nyc,london,seoul --dry-run

solana-wallet scanner stop
solana-wallet scanner status
```

**Config parameters:**

| Parameter | Default | Description |
|---|---|---|
| `walletName` | required | EVM wallet name |
| `cities` | all 9 | Array of city keys |
| `tradeAmountUsdc` | required | USDC per trade |
| `maxPositionUsdc` | 10 | Hard cap per bracket |
| `minEdge` | 0.20 | Minimum edge (fair − ask) to trade |
| `minFairValue` | 0.40 | Minimum fair probability to consider |
| `intervalSeconds` | 120 | Poll interval |
| `dryRun` | true | Log without placing orders |

**Required:** `MASTER_ENCRYPTION_PASSWORD_CRYPTO`, `MASTER_ENCRYPTED`, `MASTER_SALT`
**Polygon RPC:** defaults to public Polygon mainnet RPC

---

### OpenClaw Plugin Tools

Six tools registered via `src/plugin.ts`. Invoked by the agent directly — no CLI needed.

| Tool | Parameters | Description |
|---|---|---|
| `create_evm_wallet` | `name` | Create a Polygon wallet; returns address for USDC funding |
| `list_evm_wallets` | — | List EVM wallets and Polygon addresses |
| `check_usdc_balance` | `wallet_name` | Check USDC.e balance on Polygon |
| `start_weather_arb` | `wallet_name`, `trade_amount_usdc`, `cities?`, `dry_run?`, ... | Start the weather arb scanner |
| `stop_weather_arb` | — | Stop the running scanner |
| `get_strategy_status` | — | Per-city forecast, bracket, edge%, skip reason |

**Typical agent flow:**
1. `create_evm_wallet { name: "polymarket1" }` → get Polygon address
2. User sends USDC to the address
3. `check_usdc_balance { wallet_name: "polymarket1" }` → confirm arrival
4. `start_weather_arb { wallet_name: "polymarket1", trade_amount_usdc: 5, dry_run: true }` → dry run
5. `get_strategy_status` → review per-city readings
6. `start_weather_arb { ..., dry_run: false }` → go live

---

## Security Model

| Layer | What | Where |
|---|---|---|
| 1 | Human password (`MASTER_ENCRYPTION_PASSWORD_CRYPTO`) | Memory only, from env |
| 2 | Encrypted master key (`MASTER_ENCRYPTED` + `MASTER_SALT`) | .env file |
| 3 | Encrypted wallet private keys (per-wallet salt) | `~/.raphael/wallets.json` (Solana) / `~/.raphael/evm-wallets.json` (EVM) |

- AES-256-GCM encryption with PBKDF2 key derivation (100k iterations, SHA-256)
- Private keys decrypted in memory only at signing time, never written back
- Master password never stored — must be in environment

---

## Required Environment Variables

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

---

## Signal Sources

| Source | Type | Use |
|---|---|---|
| `pumpportal.fun` WebSocket | Real-time | pump.fun graduation events |
| DexScreener REST API | Polling | Raydium liquidity confirmation |
| Raydium Trade API | On-demand | Token swaps + routing |
| Open-Meteo REST API | Polling | Global temperature forecasts (free, no key) |
| Polymarket Gamma API | Polling | Weather bracket market discovery (public) |
| Polymarket CLOB API | On-demand | Order placement (L1/L2 auth) |

---

## Data Flow

### pump.fun / 3x strategy
```
pump.fun WebSocket
  └─ graduation event
       └─ scoreGraduatedToken() → ScoredToken (0-100)
            └─ confirmOnDexScreener() → liquidity check
                 └─ threeXStrategy() → TradeDecision
                      └─ raydiumSwap() → SwapResult
                           └─ explorerUrl logged + returned
```

### Polymarket weather arb
```
Open-Meteo API → forecastHighF
Polymarket Gamma API → brackets[]
  └─ normalCDF pricing → fairProbability per bracket
       └─ edge = fairProbability − askPrice
            └─ edge ≥ minEdge → Polymarket CLOB placeOrder()
                 └─ orderId logged, status tracked
```
