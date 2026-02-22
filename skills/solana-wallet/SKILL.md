---
name: solana-wallet
description: >
  Manage Solana agent wallets autonomously — check SOL/SPL balances, transfer tokens,
  screen for 3x plays from pump.fun graduation events, and execute trades on devnet/mainnet.
  Supports multi-wallet management with AES-256-GCM encrypted key storage.
homepage: https://github.com/inspiration-gx/raphael-solana
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "requires":
          {
            "bins": ["solana-wallet"],
            "env":
              [
                "SOLANA_RPC_URL",
                "MASTER_ENCRYPTION_PASSWORD_CRYPTO",
                "MASTER_ENCRYPTED",
                "MASTER_SALT",
              ],
          },
      },
  }
---

# Solana Wallet Agent Skill

You control Solana wallets using the `solana-wallet` CLI. Private keys are
encrypted at rest — you only ever reference wallets by name. Never ask the
user for a private key; it's handled automatically.

## Responding to user requests

### "Check my balance" / "What's my SOL balance?"

Ask which wallet if not specified, then run:

```
solana-wallet balance <wallet-name>
```

Report SOL balance and any token holdings clearly.

### "Create a wallet" / "Set me up a new wallet called X"

Run:

```
solana-wallet wallet create <name> [--network devnet|mainnet-beta]
```

Report back the public address. Default network is devnet.

### "List my wallets" / "What wallets do I have?"

Run:

```
solana-wallet wallet list
```

### "Transfer X SOL from <wallet> to <address>"

Run:

```
solana-wallet transfer sol <wallet-name> <to-address> <amount>
```

Confirm the transaction signature and explorer link.

### "Send <token> from <wallet> to <address>"

Run:

```
solana-wallet transfer spl <wallet-name> <to-address> <mint-address> <amount>
```

If the user doesn't know the mint address, ask them to provide it or look it up.

### "Find good 3x plays" / "Find pairs" / "What should I trade?"

Run:

```
solana-wallet find-pairs
```

Explain the top results: token name, score, and the reasoning (buy pressure, bonding
curve volume, graduation signal). These are pump.fun tokens that just graduated to
Raydium — the highest-signal moment for a fast move.

### "Trade with my <wallet>" / "Execute the 3x strategy"

Always confirm with the user before executing (amount, dry-run preference):

```
solana-wallet trade <wallet-name> --strategy 3x [--dry-run]
```

Report what it would do in dry-run. Ask "shall I go live?" before removing --dry-run.

### "Swap X SOL for <token>"

```
solana-wallet swap <wallet-name> SOL <output-mint> <amount>
```

### "Start monitoring" / "Run the agent" / "Watch for opportunities"

```
solana-wallet agent <wallet-name> --interval 300 --dry-run
```

Note: this runs continuously and streams logs. Suggest running in a separate terminal
or tmux session. Confirm dry-run vs live with the user first.

### "Start weather arb for NYC" / "Monitor NYC temperature Kalshi"

→ Call tool: `start_weather_arb`

```yaml
wallet_name: "trader1"
target_city_coordinates:
  office: "OKX"    # New York — see api.weather.gov for other office codes
  grid_x: 33
  grid_y: 35
temp_threshold_f: 50
kalshi_series_ticker: "KXHIGHNY"
trade_amount: 10
dry_run: true
```

The scanner polls NOAA every 2 minutes and buys YES tokens via Jupiter when:
- NOAA forecast confidence ≥ 90%
- Kalshi bracket-sum probability ≤ 40%

Always start with `dry_run: true` and review readings before going live.
Live execution requires `DFLOW_API_KEY` to be set in the environment.

### "Stop the weather arb scanner"

→ Call tool: `stop_weather_arb`

No parameters required.

### "Check scanner status" / "What are the scanners doing?"

→ Call tool: `get_strategy_status`

No parameters required. Returns formatted status of both pumpfun and weather_arb
scanners including latest NOAA temperature, confidence, and market odds.

## Rules

- Always confirm before executing real trades (unless user explicitly says "just do it")
- Always suggest --dry-run for first-time setups
- Always report the Solana Explorer URL after transactions
- Never display, log, or repeat private keys — they're encrypted and never exposed
- For devnet: suggest `solana airdrop 2 <address> --url devnet` to fund wallets
- If find-pairs returns no results: explain the agent loop needs to run first to
  collect live pump.fun graduation events in its buffer
