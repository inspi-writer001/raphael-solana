---
name: solana-wallet
description: >
  Manage Solana and Polygon wallets, run Polymarket weather arbitrage, post to X/Twitter,
  and execute Raydium swaps — all from natural language.
version: 1.0.1
homepage: https://github.com/inspiration-gx/raphael-solana
user-invocable: true
metadata:
  openclaw:
    emoji: "🤖"
    primaryEnv: MASTER_ENCRYPTION_PASSWORD_CRYPTO
    requires:
      env:
        - RAPHAEL_INSTALL_DIR
        - MASTER_ENCRYPTION_PASSWORD_CRYPTO
        - MASTER_ENCRYPTED
        - MASTER_SALT
      anyBins:
        - node
        - tsx
    os:
      - macos
      - linux
---

# Solana + Polymarket + X Wallet Agent Skill

You control Solana wallets, Polygon EVM wallets, a Polymarket weather arbitrage scanner,
and an X/Twitter strategy — all from natural language.

## Setup

Set `RAPHAEL_INSTALL_DIR` in your environment to the directory where you cloned this repo:

```bash
# In your ~/.openclaw/.env or shell profile:
RAPHAEL_INSTALL_DIR=/path/to/raphael-solana
```

Then add the other required credentials (see **Credential Model** below).

## Execution Rules

1. **Build the CLI prefix from the install directory env var:**
   ```
   node --experimental-transform-types $RAPHAEL_INSTALL_DIR/bin/solana-wallet.ts
   ```
2. Run CLI commands directly in the current exec context so that all env vars are available in the same shell session.
3. **Prefer plugin tools over CLI** when available — all 13 tools are available as direct plugin calls and require no exec.
4. The following Node.js warnings are expected and harmless: `ExperimentalWarning`, `bigint` deprecation, `punycode`. Disregard them in output parsing.

## Plugin Tools (use these first — no exec needed)

### Wallet & Polymarket

| Tool | When to use |
|---|---|
| `create_evm_wallet` | User wants to create a Polygon wallet for Polymarket |
| `list_evm_wallets` | User asks what EVM wallets exist |
| `check_usdc_balance` | User wants to verify USDC arrived on Polygon |
| `start_weather_arb` | User wants to start the weather arb scanner |
| `stop_weather_arb` | User wants to stop the weather arb scanner |
| `get_strategy_status` | User asks about scanner status, city readings, edges, X tweet count |

### X / Twitter

| Tool | When to use |
|---|---|
| `x_post_tweet` | User wants to post a tweet |
| `x_reply` | User wants to reply to a specific tweet |
| `x_search` | User wants to search recent tweets (requires Basic+ X tier) |
| `x_get_mentions` | User wants to see recent mentions of the bot |
| `x_resolve_user` | User wants to look up a Twitter user by @handle |
| `start_x_strategy` | User wants to start mention monitoring / keyword feed / trade posting |
| `stop_x_strategy` | User wants to stop the X strategy |

## CLI Command Reference

The CLI prefix for ALL commands below is:
```
node --experimental-transform-types $RAPHAEL_INSTALL_DIR/bin/solana-wallet.ts
```

### Solana Wallet Commands

| User says | Command |
|---|---|
| Check Solana balance | `<prefix> balance <wallet-name>` |
| Create Solana wallet | `<prefix> wallet create <name> [--network devnet\|mainnet-beta]` |
| List Solana wallets | `<prefix> wallet list` |
| Transfer SOL | `<prefix> transfer sol <wallet> <to-address> <amount>` |
| Transfer SPL token | `<prefix> transfer spl <wallet> <to-address> <mint> <amount>` |
| Transfer MATIC | `<prefix> transfer matic <wallet> <to-address> <amount>` |
| Transfer ERC-20 (USDC etc.) | `<prefix> transfer erc20 <wallet> <to-address> <token-address> <amount>` |
| Swap tokens | `<prefix> swap <wallet> SOL <output-mint> <amount>` |
| Find pump.fun plays | `<prefix> find-pairs` |

### EVM / Polygon Wallet Commands

| User says | Command |
|---|---|
| Create Polygon wallet | `<prefix> evm-wallet create <name>` |
| List Polygon wallets | `<prefix> evm-wallet list` |
| Check MATIC / ERC-20 balance | `<prefix> evm-wallet balance <name> [--token <address>]` |

### X / Twitter Commands

| User says | Command |
|---|---|
| Post a tweet | `<prefix> x tweet <text>` |
| Reply to a tweet | `<prefix> x reply <tweet-id> <text>` |
| Search tweets | `<prefix> x search <query> [--max 10]` |
| Check mentions | `<prefix> x mentions [--since <tweet-id>]` |
| Look up a user | `<prefix> x resolve <handle>` |
| Start X strategy | See full command below |

**Start X strategy (full command):**
```
node --experimental-transform-types $RAPHAEL_INSTALL_DIR/bin/solana-wallet.ts scanner start x \
  --handle <bot-handle> \
  [--keywords "pump.fun,graduation"] \
  [--post-trade-updates] \
  [--auto-reply] \
  [--max-tweets-per-hour 2] \
  [--interval 60] \
  [--dry-run]
```

### Scanner Commands

| User says | Command |
|---|---|
| Start weather arb | See full command below |
| Stop scanner | `node --experimental-transform-types $RAPHAEL_INSTALL_DIR/bin/solana-wallet.ts scanner stop` |
| Check scanner status | `node --experimental-transform-types $RAPHAEL_INSTALL_DIR/bin/solana-wallet.ts scanner status` |

**Start weather arb (full command):**
```
node --experimental-transform-types $RAPHAEL_INSTALL_DIR/bin/solana-wallet.ts scanner start polymarket-weather <evm-wallet-name> \
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

## Typical Agent Flow: X / Twitter

1. Confirm X credentials are set: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `X_BEARER_TOKEN`
2. Start in dry-run to verify: `start_x_strategy { handle: "mybot", dry_run: true, post_trade_updates: true }`
3. Check status: `get_strategy_status` — shows tweets sent this hour
4. Once confirmed working, restart without dry run

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

## Credential Model

This skill uses a **two-layer local encryption** scheme to keep private keys safe at rest. No keys or secrets are ever sent to a remote server — all signing happens locally on your machine.

| Variable | What it is | Sensitive? |
|---|---|---|
| `RAPHAEL_INSTALL_DIR` | Path to your cloned repo | No |
| `MASTER_ENCRYPTION_PASSWORD_CRYPTO` | Your chosen password — lives in memory only, never written to disk | Yes |
| `MASTER_ENCRYPTED` | AES-256-GCM encrypted master key (output of `pnpm setup`) — useless without the password | Low |
| `MASTER_SALT` | PBKDF2 salt used to derive the decryption key (output of `pnpm setup`) — useless without the password | Low |

**How it works:**
```
MASTER_ENCRYPTION_PASSWORD_CRYPTO  (env var, memory only)
  ↓ PBKDF2 — 100,000 iterations, SHA-256
MASTER_ENCRYPTED + MASTER_SALT     (in .env — cannot decrypt wallets without the password)
  ↓ AES-256-GCM decrypt → master key
wallet private key                 (AES-256-GCM encrypted, per-wallet salt, stored in ~/.raphael/)
```

`MASTER_ENCRYPTED` and `MASTER_SALT` are generated by running `pnpm setup` in the repo. They are specific to your machine and password — sharing them with anyone else is meaningless without also sharing the password.

### X / Twitter credentials (optional)

X features are fully optional. The skill works without them. To enable posting and monitoring:

| Variable | Required for |
|---|---|
| `X_API_KEY` | All X writes (tweets, replies) |
| `X_API_SECRET` | All X writes |
| `X_ACCESS_TOKEN` | All X writes |
| `X_ACCESS_TOKEN_SECRET` | All X writes |
| `X_BEARER_TOKEN` | X reads (search, timelines) — requires Basic+ tier ($100/mo) |

Obtain all five from [developer.x.com](https://developer.x.com) → Projects & Apps → Keys and Tokens. Set app permissions to **Read and Write** before generating the access token.

## Rules

- Always confirm before live trades (unless user explicitly says "just do it" or "no dry run")
- Always suggest `--dry-run` / `dry_run: true` for first-time scanner and X strategy starts
- Report Solana Explorer URL after Solana transactions
- Never display private keys
- For Polymarket: USDC must be on **Polygon PoS network** — not Solana, not Ethereum mainnet
- For X: never auto-like or auto-retweet — TOS violation; the agent only reads and posts text
- For devnet Solana funding: suggest `solana airdrop 2 <address> --url devnet`
- X search requires Basic+ tier ($100/mo) — gracefully skip if unavailable
