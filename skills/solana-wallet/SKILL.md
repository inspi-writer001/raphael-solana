---
name: solana-wallet
description: >
  Manage Solana and Polygon wallets, run Polymarket weather arbitrage, and execute Raydium swaps.
homepage: https://github.com/inspiration-gx/raphael-solana
user-invocable: true
---

# Solana + Polymarket Wallet Agent Skill

You control Solana wallets, Polygon EVM wallets, and a Polymarket weather arbitrage scanner.

## CRITICAL RULES

1. **For CLI commands, use exec with this exact prefix:**
   ```
   node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts
   ```
2. **NEVER use bare `solana-wallet`** — it is not on PATH in this environment.
3. **NEVER delegate these commands to subagents.** Run them yourself directly with exec.
4. Ignore warnings about "ExperimentalWarning", "bigint", or "punycode" — these are harmless.
5. **Prefer plugin tools over CLI** when available — `create_evm_wallet`, `check_usdc_balance`, `start_weather_arb`, `stop_weather_arb`, `get_strategy_status`, `list_evm_wallets` are all available as direct tools.

## Plugin Tools (use these first — no exec needed)

| Tool | When to use |
|---|---|
| `create_evm_wallet` | User wants to create a Polygon wallet for Polymarket |
| `list_evm_wallets` | User asks what EVM wallets exist |
| `check_usdc_balance` | User wants to verify USDC arrived on Polygon |
| `start_weather_arb` | User wants to start the weather arb scanner |
| `stop_weather_arb` | User wants to stop the scanner |
| `get_strategy_status` | User asks about scanner status, city readings, edges |

## CLI Command Reference

The CLI prefix for ALL commands below is:
```
node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts
```

### Solana Wallet Commands

| User says | Command |
|---|---|
| Check Solana balance | `<prefix> balance <wallet-name>` |
| Create Solana wallet | `<prefix> wallet create <name> [--network devnet\|mainnet-beta]` |
| List Solana wallets | `<prefix> wallet list` |
| Transfer SOL | `<prefix> transfer sol <wallet> <to-address> <amount>` |
| Transfer SPL token | `<prefix> transfer spl <wallet> <to-address> <mint> <amount>` |
| Swap tokens | `<prefix> swap <wallet> SOL <output-mint> <amount>` |
| Find pump.fun plays | `<prefix> find-pairs` |

### EVM / Polygon Wallet Commands

| User says | Command |
|---|---|
| Create Polygon wallet | `<prefix> evm-wallet create <name>` |
| List Polygon wallets | `<prefix> evm-wallet list` |
| Check MATIC / ERC-20 balance | `<prefix> evm-wallet balance <name> [--token <address>]` |

### Scanner Commands

| User says | Command |
|---|---|
| Start weather arb | See full command below |
| Stop scanner | `<prefix> scanner stop` |
| Check scanner status | `<prefix> scanner status` |

**Start weather arb (full command):**
```
<prefix> scanner start polymarket-weather <evm-wallet-name> \
  --amount <usdc-per-trade> \
  [--cities nyc,london,seoul,chicago,dallas,miami,paris,toronto,seattle] \
  [--max-position <usdc>] \
  [--min-edge 0.20] \
  [--min-fair-value 0.40] \
  [--interval <seconds>] \
  [--dry-run]
```

## Typical Agent Flow: Polymarket Weather Arb

1. Create EVM wallet (plugin: `create_evm_wallet` or CLI: `evm-wallet create polymarket1`)
2. Tell user: **"Send USDC (Polygon PoS network) to: `<address>`"**
3. Poll balance until funded: `check_usdc_balance { wallet_name: "polymarket1" }`
4. Start dry run: `start_weather_arb { wallet_name: "polymarket1", trade_amount_usdc: 5, dry_run: true }`
5. Check readings after 2 minutes: `get_strategy_status`
6. If edges look reasonable, restart without dry run: `start_weather_arb { ..., dry_run: false }`

## Supported Cities for Weather Arb

| Key | City |
|---|---|
| `nyc` | New York City |
| `london` | London |
| `seoul` | Seoul |
| `chicago` | Chicago |
| `dallas` | Dallas |
| `miami` | Miami |
| `paris` | Paris |
| `toronto` | Toronto |
| `seattle` | Seattle |

## Rules

- Always confirm before live trades (unless user explicitly says "just do it" or "no dry run")
- Always suggest `--dry-run` / `dry_run: true` for first-time scanner starts
- Report Solana Explorer URL after Solana transactions
- Never display private keys
- For Polymarket: the USDC must be on **Polygon PoS network** — not Solana, not Ethereum mainnet
- For devnet Solana funding: suggest `solana airdrop 2 <address> --url devnet`
