# Raphael — Build Plan

> **TL;DR**: A Solana agentic wallet system, installable as an OpenClaw skill via ClawHub.
> After install, you just tell the agent: _"check my balance", "transfer 0.5 SOL", "find 3x plays",
> "trade with my wallet"_ — and it does it autonomously on devnet (mainnet-ready).

---

## What We're Building

```
raphael-solana/
├── src/
│   ├── environment.ts         # env var loading + validation
│   ├── crypto.ts              # AES-GCM/PBKDF2 encryption (your code, adapted)
│   ├── db.ts                  # JSON-file wallet store (read/write encrypted records)
│   ├── wallet.ts              # createWallet, listWallets, loadKeypair, decryptWallet
│   ├── balance.ts             # getSolBalance, getTokenBalances, getPortfolioSummary
│   ├── transfer.ts            # transferSOL, transferSPL
│   ├── swap.ts                # jupiterSwap (Jupiter V6 REST API — no classes)
│   ├── screener.ts            # pump.fun WebSocket + graduation events (primary signal)
│   ├── strategy.ts            # threeXStrategy: score + filter + decide
│   ├── agent.ts               # autonomous loop (poll → analyze → trade → report)
│   └── types.ts               # all TypeScript types (no classes)
├── bin/
│   └── solana-wallet.ts       # CLI entry — subcommand dispatch
├── skills/
│   └── solana-wallet/
│       └── SKILL.md           # OpenClaw skill descriptor (published to ClawHub)
├── SKILLS.md                  # Human/agent-readable skill docs (bounty requirement)
├── .env.example               # template for required env vars
├── package.json               # bin entry: "solana-wallet"
├── tsconfig.json
└── README.md
```

---

## Phase 1 — Foundations (crypto + wallet store)

### 1.1 Environment (`src/environment.ts`)

```ts
// Typed env loader — fails fast if required vars missing
export const MASTER_ENCRYPTION_PASSWORD_CRYPTO =
  process.env.MASTER_ENCRYPTION_PASSWORD_CRYPTO!;
export const MASTER_ENCRYPTED = process.env.MASTER_ENCRYPTED!;
export const MASTER_SALT = process.env.MASTER_SALT!;
export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const WALLET_STORE_PATH =
  process.env.WALLET_STORE_PATH ??
  `${process.env.HOME}/.solana-agent-wallets.json`;
export const PUMPPORTAL_WS = "wss://pumpportal.fun/api/data";
export const PUMPPORTAL_API = "https://pumpportal.fun/api";
export const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex"; // secondary confirmation
```

### 1.2 Crypto (`src/crypto.ts`)

Your existing AES-GCM + PBKDF2 code, exported cleanly:

```ts
// All exported as pure functions — no classes
export const deriveKeyFromPassword = async (password, salt?) => { ... }
export const encrypt = async (plaintext, key) => { ... }
export const decrypt = async (encryptedBase64, key) => { ... }
export const encryptWithPassword = async (plaintext, password) => { ... }
export const decryptWithPassword = async (encrypted, password, saltBase64) => { ... }

// Two-layer convenience wrappers for wallet keys
export const encryptPrivateKey = async (privateKeyBase58, masterKey) => { ... }
export const decryptPrivateKey = async (encryptedKey, saltBase64, masterKey) => { ... }
```

**Two-layer model** (exactly as you showed):

```
.env: MASTER_ENCRYPTION_PASSWORD_CRYPTO  (human password, never stored)
  ↓  PBKDF2
MASTER_ENCRYPTED / MASTER_SALT           (in .env — encrypted master key)
  ↓  decrypt → masterKey
wallet private key (encrypted with masterKey) → stored in wallet JSON store
```

### 1.3 Wallet Store (`src/db.ts`)

Simple JSON file, no external DB:

```ts
// wallet store shape
type WalletStore = {
  wallets: Record<string, EncryptedWalletRecord>
}

type EncryptedWalletRecord = {
  name: string
  publicKey: string
  encryptedPrivateKey: string
  salt: string
  createdAt: string
  network: "devnet" | "mainnet-beta"
  tags: string[]
}

// pure functions
export const readStore = async (): Promise<WalletStore> => { ... }
export const writeStore = async (store: WalletStore): Promise<void> => { ... }
export const getWallet = async (name: string) => { ... }
export const saveWallet = async (record: EncryptedWalletRecord) => { ... }
export const listWallets = async () => { ... }
```

### 1.4 Wallet Operations (`src/wallet.ts`)

```ts
// Create new keypair, encrypt it, store it
export const createWallet = async (name: string, network?: "devnet" | "mainnet-beta") => {
  // Keypair.generate() → bs58 private key
  // decryptWithPassword(MASTER_ENCRYPTED, MASTER_PASS, MASTER_SALT) → masterKey
  // encryptPrivateKey(privateKeyBs58, masterKey) → { encrypted, salt }
  // saveWallet({ name, publicKey, encryptedPrivateKey, salt, ... })
  return { name, publicKey, network }
}

// Load decrypted keypair for signing (only in memory, never written back)
export const loadKeypair = async (name: string): Promise<Keypair> => { ... }

// List all wallets (public info only)
export const listWallets = async () => { ... }
```

---

## Phase 2 — Core Solana Operations

### 2.1 Balance (`src/balance.ts`)

```ts
// SOL balance in lamports + SOL
export const getSolBalance = async (publicKey: string, rpcUrl?: string) => {
  // new Connection(rpcUrl) → getBalance(new PublicKey(publicKey))
  return { lamports, sol }
}

// All SPL token accounts + balances
export const getTokenBalances = async (publicKey: string, rpcUrl?: string) => {
  // getTokenAccountsByOwner → parse each account
  return [{ mint, symbol, decimals, amount, uiAmount }]
}

// Summary: SOL + all tokens with USD estimates (via pumpportal price fallback → DexScreener)
export const getPortfolioSummary = async (walletName: string) => { ... }
```

### 2.2 Transfer (`src/transfer.ts`)

```ts
export const transferSOL = async (
  fromWalletName: string,
  toAddress: string,
  amountSol: number,
) => {
  // loadKeypair(fromWalletName) → keypair
  // SystemProgram.transfer(...) → sendAndConfirmTransaction(...)
  return { signature, explorerUrl };
};

export const transferSPL = async (
  fromWalletName: string,
  toAddress: string,
  mintAddress: string,
  amount: number,
) => {
  // getOrCreateAssociatedTokenAccount → createTransferInstruction
  return { signature, explorerUrl };
};
```

### 2.3 Swap via Jupiter (`src/swap.ts`)

Uses Jupiter V6 REST API directly — no class, no SDK required:

```ts
const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_API = "https://quote-api.jup.ag/v6/swap";

export const jupiterQuote = async (
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number,
) => {
  // GET /v6/quote?inputMint=...&outputMint=...&amount=...&slippageBps=...
  return quoteResponse;
};

export const jupiterSwap = async (
  walletName: string,
  inputMint: string, // SOL = "So11111111111111111111111111111111111111112"
  outputMint: string,
  amountLamports: number,
  slippageBps: number = 300,
) => {
  // 1. getQuote()
  // 2. POST /v6/swap → get swapTransaction (base64)
  // 3. VersionedTransaction.deserialize(Buffer.from(swapTx, 'base64'))
  // 4. keypair.sign(transaction)
  // 5. connection.sendRawTransaction(...)
  return { signature, inputAmount, outputAmount, explorerUrl };
};
```

**Devnet note**: Jupiter on devnet has limited liquidity. Strategy:

- Devnet: use SOL_MINT ↔ USDC_DEVNET pair for testing the signing flow
- Mainnet: full Jupiter routing with all tokens

---

## Phase 3 — Trading Intelligence

### 3.1 Pair Screener (`src/screener.ts`)

**Primary signal: pump.fun WebSocket** — real-time new launches + graduation events.
**Secondary: DexScreener REST** — post-graduation volume/liquidity confirmation.

The graduation event (token completes pump.fun bonding curve → migrates to Raydium) is
the single most actionable on-chain signal for a fast 3x: demand is proven, real
liquidity is about to arrive, early Raydium buyers ride the move.

```ts
// ── Types ──────────────────────────────────────────────────────────────────

type PumpEvent =
  | {
      type: "newToken";
      mint: string;
      name: string;
      symbol: string;
      creator: string;
      timestamp: number;
    }
  | {
      type: "trade";
      mint: string;
      sol_amount: number;
      is_buy: boolean;
      timestamp: number;
    }
  | {
      type: "graduation";
      mint: string;
      name: string;
      symbol: string;
      raydium_pool: string;
      timestamp: number;
    };

type ScoredToken = {
  mint: string;
  symbol: string;
  name: string;
  score: number;
  reason: string;
  raydiumPool?: string; // set on graduation
  graduatedAt?: number;
  source: "graduation" | "momentum";
};

// ── WebSocket listener ──────────────────────────────────────────────────────

// In-memory buffer of recent events (capped at 500)
const eventBuffer: PumpEvent[] = [];

export const startPumpListener = (
  onGraduation: (token: ScoredToken) => void,
) => {
  // ws package: npm install ws
  const ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.on("open", () => {
    // Subscribe to new token creations + trades
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [] })); // all tokens
  });

  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as PumpEvent;
    eventBuffer.push(event);
    if (eventBuffer.length > 500) eventBuffer.shift();

    if (event.type === "graduation") {
      const scored = scoreGraduatedToken(event);
      onGraduation(scored); // fire callback immediately
    }
  });

  ws.on("close", () => setTimeout(() => startPumpListener(onGraduation), 3000));
  return ws;
};

// ── Scoring ─────────────────────────────────────────────────────────────────

// Score a graduated token 0-100
export const scoreGraduatedToken = (
  event: PumpEvent & { type: "graduation" },
): ScoredToken => {
  // Pull recent trades for this mint from buffer
  const trades = eventBuffer.filter(
    (e) => e.type === "trade" && e.mint === event.mint,
  ) as (PumpEvent & { type: "trade" })[];

  const buys = trades.filter((t) => t.is_buy).length;
  const sells = trades.filter((t) => !t.is_buy).length;
  const buyPressure = buys / Math.max(buys + sells, 1); // 0-1

  const totalVolSol = trades.reduce((s, t) => s + t.sol_amount, 0);

  let score = 50; // base: graduating is already bullish
  score += buyPressure > 0.7 ? 25 : buyPressure > 0.5 ? 10 : -10; // buy pressure
  score += totalVolSol > 100 ? 15 : totalVolSol > 50 ? 8 : 0; // volume (SOL)
  score += trades.length > 200 ? 10 : trades.length > 50 ? 5 : 0; // trade count = community interest

  const reason = [
    `Graduated to Raydium`,
    `${buys}/${buys + sells} buys (${Math.round(buyPressure * 100)}% buy pressure)`,
    `${totalVolSol.toFixed(1)} SOL volume on bonding curve`,
  ].join(" · ");

  return {
    mint: event.mint,
    symbol: event.symbol,
    name: event.name,
    score: Math.max(0, Math.min(100, score)),
    reason,
    raydiumPool: event.raydium_pool,
    graduatedAt: event.timestamp,
    source: "graduation",
  };
};

// ── REST fallback: DexScreener confirmation ──────────────────────────────────

// After graduation, confirm liquidity on Raydium before trading
export const confirmOnDexScreener = async (mint: string) => {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
  );
  const data = await res.json();
  const pair = data.pairs?.[0];
  if (!pair) return null;
  return {
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume1h: pair.volume?.h1 ?? 0,
    priceChange1h: pair.priceChange?.h1 ?? 0,
  };
};

// ── One-shot snapshot for CLI `find-pairs` command ──────────────────────────

// Returns top scored tokens from the last N minutes of buffered events
export const findHighPotentialPairs = async (
  minScore = 60,
): Promise<ScoredToken[]> => {
  // Get recent graduations from buffer (last 30 min)
  const cutoff = Date.now() - 30 * 60 * 1000;
  const recentGraduations = eventBuffer.filter(
    (e) => e.type === "graduation" && e.timestamp > cutoff,
  ) as (PumpEvent & { type: "graduation" })[];

  const scored = recentGraduations.map(scoreGraduatedToken);

  return scored
    .filter((t) => t.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
};
```

### 3.2 3x Strategy (`src/strategy.ts`)

```ts
type TradeDecision = {
  action: "buy" | "hold" | "skip"
  pair: ScoredPair | null
  reason: string
  suggestedAmountSol: number
  targetMultiple: number       // 3.0 = 3x
  stopLossPercent: number      // e.g. 30%
}

// Full strategy logic — pure function
export const threeXStrategy = async (
  currentPortfolioSol: number,
  maxRiskPercent: number = 5   // never risk more than 5% of portfolio per trade
): Promise<TradeDecision> => {
  // Primary: recent graduations from live WebSocket buffer
  // Fallback: DexScreener momentum scan if buffer is cold (no live listener running)
  const topPairs = await findHighPotentialPairs(65)

  if (topPairs.length === 0) {
    return { action: "skip", reason: "No pairs meet criteria", ... }
  }

  const best = topPairs[0]

  // Don't trade if already in significant drawdown
  // Risk: maxRiskPercent% of portfolio, min 0.01 SOL, max 0.5 SOL
  const amountSol = Math.min(
    currentPortfolioSol * (maxRiskPercent / 100),
    0.5
  )

  return {
    action: "buy",
    pair: best,
    reason: `Score: ${best.score}/100 — ${best.symbol} · ${best.reason}`,
    suggestedAmountSol: amountSol,
    targetMultiple: 3.0,
    stopLossPercent: 30,
  }
}
```

### 3.3 Autonomous Agent Loop (`src/agent.ts`)

```ts
type AgentConfig = {
  walletName: string;
  intervalSeconds: number; // default: 300 (5 min)
  strategy: "3x" | "manual";
  maxRiskPercent: number;
  dryRun: boolean; // true = log decisions, don't execute
};

type AgentState = {
  openPositions: Position[];
  tradeHistory: Trade[];
  lastRunAt: string;
};

// The autonomous loop
export const runAgentLoop = async (config: AgentConfig) => {
  console.log(`[agent] Starting for wallet: ${config.walletName}`);

  while (true) {
    const portfolio = await getPortfolioSummary(config.walletName);
    const decision = await threeXStrategy(
      portfolio.solBalance,
      config.maxRiskPercent,
    );

    if (decision.action === "buy" && !config.dryRun) {
      const result = await jupiterSwap(
        config.walletName,
        SOL_MINT,
        decision.pair!.mint,
        solToLamports(decision.suggestedAmountSol),
      );
      logTrade(result, decision);
    } else {
      console.log(`[agent] Decision: ${decision.action} — ${decision.reason}`);
    }

    // Check open positions for take-profit / stop-loss
    await monitorPositions(config.walletName, config.openPositions);

    await sleep(config.intervalSeconds * 1000);
  }
};
```

---

## Phase 4 — CLI (`bin/solana-wallet.ts`)

```
Usage: solana-wallet <command> [options]

Commands:
  wallet create <name>                      Create and store encrypted wallet
  wallet list                               List all managed wallets
  balance <wallet-name>                     SOL + token balances
  transfer sol <from> <to> <amount>         Transfer SOL
  transfer spl <from> <to> <mint> <amount>  Transfer SPL token
  swap <wallet> <from-mint> <to-mint> <amount>  Swap via Jupiter
  find-pairs [--min-score 60]               Screen for 3x opportunities
  trade <wallet> [--strategy 3x] [--dry-run]   Execute strategy trade
  agent <wallet> [--interval 300] [--dry-run]  Autonomous trading loop

Options:
  --rpc <url>        Override RPC URL
  --network devnet|mainnet-beta
  --json             Output as JSON
```

Implementation: flat switch/case dispatch, no commander dependency (or use `minimist` if needed).

---

## Phase 5 — OpenClaw Skill

### `skills/solana-wallet/SKILL.md`

```markdown
---
name: solana-wallet
description: >
  Manage Solana agent wallets autonomously — check SOL/SPL balances, transfer
  tokens, screen for 3x trading opportunities, and execute trades on devnet/mainnet.
  Supports multi-wallet management with encrypted key storage.
homepage: https://github.com/<your-repo>/agentic-wallet
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

# Solana Wallet Agent

You control Solana wallets using the `solana-wallet` CLI. Private keys are
encrypted — you never see them, you just use wallet names.

## How to respond to user requests

### "Check my balance" / "What's my SOL balance"

→ Ask which wallet if not specified, then run:
```

solana-wallet balance <wallet-name>

```

### "Create a wallet" / "Set up a new wallet named X"
→ Run:
```

solana-wallet wallet create <name>

```
Report the public address back to the user.

### "List my wallets"
→ Run:
```

solana-wallet wallet list

```

### "Transfer X SOL from <wallet> to <address>"
→ Run:
```

solana-wallet transfer sol <wallet-name> <to-address> <amount>

```
Confirm the signature and explorer link.

### "Transfer <token> from <wallet> to <address>"
→ Run:
```

solana-wallet transfer spl <wallet-name> <to-address> <mint-address> <amount>

```

### "Find pairs" / "Find good trading opportunities" / "Find 3x plays"
→ Run:
```

solana-wallet find-pairs

```
Explain the top 3 results: score, token, reasoning.

### "Trade with my wallet" / "Execute the 3x strategy"
→ Confirm with user first (amount, dry-run preference), then:
```

solana-wallet trade <wallet-name> --strategy 3x [--dry-run]

```

### "Start autonomous trading" / "Run the agent loop"
→ Confirm interval and risk settings, then:
```

solana-wallet agent <wallet-name> --interval 300 --dry-run

```
Note: this runs continuously. User should run it in a separate terminal/tmux.

## Important rules
- Always confirm before executing trades (unless user explicitly said "just do it")
- Always use --dry-run first for new setups
- Report explorer URLs so user can verify on-chain
- Never ask for or repeat private keys — they're encrypted automatically
```

### Publishing to ClawHub

```bash
# Install ClawHub CLI
npm install -g clawhub-cli

# Publish the skill
clawhub publish ./skills/solana-wallet --slug solana-wallet --version 1.0.0

# Users then install with:
clawhub install solana-wallet
```

---

## Phase 6 — SKILLS.md (Bounty Requirement)

```markdown
# SKILLS.md — Solana Agentic Wallet Skills

This file documents the capabilities of the agentic-wallet system for AI agents.

## Available Skills

### solana-wallet

**Category**: Blockchain / DeFi
**Network**: Solana (devnet + mainnet)

#### Wallet Management

- `createWallet(name, network)` → generate encrypted keypair
- `listWallets()` → all managed wallets + public keys
- `getPortfolioSummary(walletName)` → SOL + token balances

#### Transfers

- `transferSOL(from, to, amount)` → signed SOL transfer
- `transferSPL(from, to, mint, amount)` → SPL token transfer

#### Trading

- `jupiterSwap(wallet, fromMint, toMint, amount)` → Jupiter V6 swap
- `findHighPotentialPairs(minScore)` → pump.fun graduation screener (+ DexScreener confirm)
- `threeXStrategy(portfolio)` → automated 3x trade decision

#### Autonomous Agent

- `runAgentLoop(config)` → continuous monitoring + trading

## Security Model

- Private keys: AES-256-GCM encrypted, never in plaintext
- Two-layer encryption: master password → master key → wallet key
- Master password: only in environment variable, never stored
- All signing: in-memory only, keys zeroed after use

## Required Environment Variables

| Variable                          | Required | Description                                             |
| --------------------------------- | -------- | ------------------------------------------------------- |
| MASTER_ENCRYPTION_PASSWORD_CRYPTO | ✓        | Master password for key derivation                      |
| MASTER_ENCRYPTED                  | ✓        | Encrypted master key (base64)                           |
| MASTER_SALT                       | ✓        | Salt for master key (base64)                            |
| SOLANA_RPC_URL                    | ✓        | RPC endpoint (devnet or mainnet)                        |
| WALLET_STORE_PATH                 | optional | JSON store path (default: ~/.solana-agent-wallets.json) |
```

---

## Phase 7 — README + Deep Dive

The README covers:

1. What it is + live demo GIF
2. Quick setup (3 commands)
3. Security model (two-layer encryption diagram)
4. CLI reference
5. OpenClaw integration (clawhub install)
6. How the 3x strategy works
7. Devnet vs mainnet differences
8. Architecture diagram

The deep dive (written doc or video) covers:

- Key management for autonomous agents (threat model)
- Why AES-GCM + PBKDF2 (no HSM, self-contained)
- How the agent loop separates concerns: screener → strategy → wallet → execution
- How OpenClaw skills bridge natural language → CLI → blockchain
- Scaling to multiple agents (each with their own encrypted wallet)

---

## Package Dependencies

```json
{
  "dependencies": {
    "@solana/web3.js": "^1.98.0",
    "@solana/spl-token": "^0.4.9",
    "bs58": "^6.0.0",
    "dotenv": "^16.4.7",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.0"
  }
}
```

**No OOP in our code** — `@solana/web3.js` uses classes internally (Connection, Keypair,
PublicKey) but we wrap them in our own functional API. Our layer is all functions.

`ws` is the only added dep — needed for the pump.fun WebSocket in Node (browser has
native WebSocket, Node 22 has experimental support but `ws` is still safer for production).
Jupiter and DexScreener use plain `fetch` (native in Node 22), CLI uses `process.argv`.

---

## `.env.example`

```bash
# === Master Key (generate once with the setup script) ===
MASTER_ENCRYPTION_PASSWORD_CRYPTO=your-strong-password-here
MASTER_ENCRYPTED=<base64-from-setup>
MASTER_SALT=<base64-from-setup>

# === Solana Network ===
SOLANA_RPC_URL=https://api.devnet.solana.com
# SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# === pump.fun (no key needed — public WebSocket) ===
# PUMPPORTAL_WS=wss://pumpportal.fun/api/data   (default, no need to set)

# === Optional ===
WALLET_STORE_PATH=/home/you/.solana-agent-wallets.json
```

---

## Build Order (for implementation session)

```
1. package.json + tsconfig.json + .env setup
2. src/environment.ts
3. src/crypto.ts (your existing code, adapted to named exports)
4. src/types.ts
5. src/db.ts
6. src/wallet.ts  →  test: solana-wallet wallet create test1
7. src/balance.ts →  test: solana-wallet balance test1
8. src/transfer.ts → test: solana-wallet transfer sol test1 <addr> 0.01
9. src/swap.ts    →  test: solana-wallet swap test1 SOL USDC 0.01
10. src/screener.ts → test: solana-wallet find-pairs
11. src/strategy.ts
12. src/agent.ts  →  test: solana-wallet agent test1 --dry-run
13. bin/solana-wallet.ts (wire all commands)
14. skills/solana-wallet/SKILL.md
15. SKILLS.md
16. README.md
17. airdrop devnet SOL → run full E2E demo
18. clawhub publish
```

---

## Key Design Decisions

| Decision             | Choice                                               | Why                                                                              |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Wallet storage       | Local JSON file                                      | Portable, no external DB, simple for prototype                                   |
| Encryption           | User's AES-GCM + PBKDF2                              | Already tested, two-layer is solid for agents                                    |
| Swap router          | Jupiter V6 REST                                      | Best liquidity, no class needed, just fetch                                      |
| Pair screener        | pump.fun WebSocket (primary) + DexScreener (confirm) | Graduation = strongest 3x signal; DexScreener validates liquidity post-migration |
| CLI framework        | Native process.argv                                  | Zero deps, simple dispatch                                                       |
| OpenClaw integration | SKILL.md + ClawHub                                   | Standard skill format, agent reads SKILL.md                                      |
| TypeScript runtime   | tsx (dev) + tsc (build)                              | Fast iteration                                                                   |
| Package manager      | pnpm                                                 | As specified                                                                     |

---

## Devnet Strategy

- All wallet operations: devnet (free SOL via airdrop: `solana airdrop 2 <pubkey> --url devnet`)
- Pair screener: pump.fun WebSocket runs against mainnet events (analysis only, no execution)
  — graduation signals are mainnet-real; we surface them as recommendations
- Devnet swaps: test with SOL ↔ devnet USDC (Circle's devnet USDC or Orca devnet pools)
- Demo flow:
  1. `solana-wallet wallet create trader1`
  2. Airdrop 2 devnet SOL
  3. `solana-wallet balance trader1`
  4. `solana-wallet find-pairs` (live pump.fun graduation feed, mainnet data)
  5. `solana-wallet trade trader1 --dry-run` (shows exact trade it would execute)
  6. `solana-wallet swap trader1 <SOL_MINT> <USDC_DEVNET> 0.1` (real devnet swap)

---

## OpenClaw Flow (end-to-end after install)

```
User: "OpenClaw, check my Solana balance for wallet 'trader1'"

→ OpenClaw reads SKILL.md from ~/.openclaw/skills/solana-wallet/
→ System prompt includes: "you can run: solana-wallet balance <wallet-name>"
→ Model decides to run: solana-wallet balance trader1
→ Output parsed + formatted back to user
```

```
User: "Find good 3x plays and trade with my trader1 wallet"

→ Model runs: solana-wallet find-pairs
→ Shows top opportunities, asks confirmation
→ User: "yes, go"
→ Model runs: solana-wallet trade trader1 --strategy 3x
→ Reports: signature, amount spent, token received, explorer link
```
