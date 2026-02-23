---
name: solana-wallet
description: >
  Manage Solana agent wallets and run weather arbitrage scanner.
homepage: https://github.com/inspiration-gx/raphael-solana
user-invocable: true
---

# Solana Wallet Agent Skill

You control Solana wallets and a weather arbitrage scanner using a CLI.

## CRITICAL RULES

1. **ALWAYS use exec with this exact prefix for ALL commands:**
   ```
   node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts
   ```
2. **NEVER use bare `solana-wallet`** — it is not on PATH in this environment.
3. **NEVER delegate these commands to subagents.** Run them yourself directly with exec.
4. **NEVER spawn subagents for scanner operations.** Always exec directly.
5. Ignore warnings about "ExperimentalWarning", "bigint", or "punycode" — these are harmless.

## Command Reference

The CLI prefix for ALL commands below is:
```
node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts
```

### Wallet Commands

| User says | Command |
|-----------|---------|
| Check balance | `<prefix> balance <wallet-name>` |
| Create wallet | `<prefix> wallet create <name> [--network devnet\|mainnet-beta]` |
| List wallets | `<prefix> wallet list` |
| Transfer SOL | `<prefix> transfer sol <wallet> <to-address> <amount>` |
| Transfer SPL | `<prefix> transfer spl <wallet> <to-address> <mint> <amount>` |

### Scanner Commands

| User says | Command |
|-----------|---------|
| Start weather arb | `<prefix> scanner start weather-arb <wallet> --office <code> --grid-x <n> --grid-y <n> --threshold <f> --series <ticker> --amount <n> [--dry-run]` |
| Stop weather arb | `<prefix> scanner stop` |
| Check status | `<prefix> status` |
| Find pairs | `<prefix> find-pairs` |
| Trade | `<prefix> trade <wallet> --strategy 3x [--dry-run]` |
| Swap | `<prefix> swap <wallet> SOL <output-mint> <amount>` |

### Weather Arb Examples

Start NYC scanner (dry run):
```
node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts scanner start weather-arb trader1 --office OKX --grid-x 33 --grid-y 35 --threshold 50 --series KXHIGHNY --amount 10 --dry-run
```

Check status:
```
node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts status
```

Stop scanner:
```
node --experimental-transform-types /root/raphael-solana/bin/solana-wallet.ts scanner stop
```

### City Configurations

| City | Office | Grid X | Grid Y | Series |
|------|--------|--------|--------|--------|
| NYC | OKX | 33 | 35 | KXHIGHNY |
| Chicago | LOT | 65 | 76 | KXHIGHCHI |
| LA | LOX | 154 | 44 | KXHIGHLA |

## Rules

- Always confirm before real trades (unless user says "just do it")
- Always suggest --dry-run for first-time setups
- Report Solana Explorer URL after transactions
- Never display private keys
- For devnet: suggest `solana airdrop 2 <address> --url devnet` to fund wallets
