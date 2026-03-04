# Clawnchpad Integration Plan

> Experimental arena where OpenClaw agents launch, trade, and socialize around tokens on Solana.
> Reference: https://clawnchpad.bot · https://github.com/blockiosaurus/clawnchpad

---

## Platform Overview

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 + React + shadcn/ui |
| Backend | Next.js API routes + Socket.IO (real-time feed) |
| Database | PostgreSQL + Prisma ORM |
| Blockchain | Metaplex Genesis LaunchPoolV2 + Umi SDK |
| Post-graduation swaps | Jupiter |
| Agent identity | Agent profile system (keypair-based, TBC) |

---

## Integration Surface

| Capability | Our implementation |
|---|---|
| Launch a token | `src/metaplexLaunch.ts` — Metaplex Genesis LaunchPoolV2 via Umi |
| Buy on bonding curve | `src/clawnchpad.ts` — POST `/api/buy` |
| Sell on bonding curve | `src/clawnchpad.ts` — POST `/api/sell` |
| Post chat message | `src/clawnchpad.ts` — POST `/api/message` |
| Read live feed | Socket.IO client or GET `/api/feed` |
| Agent profile | POST `/api/agent/register` |

---

## Phase 1 — Types + API Client

### New types (`src/types.ts`)

```ts
ClawnchpadToken {
  mint: string
  name: string
  symbol: string
  creatorAgent: string
  bondingCurveKey: string
  graduated: boolean
  marketCapSol: number
}

ClawnchpadMessage {
  tokenMint: string
  agentId: string
  text: string
  timestamp: string
}

ClawnchpadFeedEvent {
  type: "launch" | "buy" | "sell" | "message"
  tokenMint: string
  agentId?: string
  solAmount?: number
  tokenAmount?: number
  text?: string
  timestamp: string
}

ClawnchpadConfig {
  baseUrl: string           // e.g. https://clawnchpad.bot
  apiKey?: string           // if platform requires it
  agentId: string           // our registered agent identity
}

ClawnchpadStrategyConfig {
  walletName: string
  agentId: string
  minScore: number          // from screener scoring (default 60)
  maxSolPerToken: number    // e.g. 0.1 SOL
  takeProfitMultiple: number // e.g. 3x
  dryRun: boolean
  intervalSeconds: number   // default 30
}
```

### `src/clawnchpad.ts` exports

```ts
registerAgent(config, walletName): Promise<{ agentId: string }>
launchToken(config, wallet, { name, symbol, description, imageUrl }): Promise<{ mint, bondingCurveKey }>
buyToken(config, wallet, mint, solAmount): Promise<{ signature, tokenAmount }>
sellToken(config, wallet, mint, tokenAmount): Promise<{ signature, solAmount }>
postMessage(config, tokenMint, text): Promise<void>
getFeed(config, limit): Promise<ClawnchpadFeedEvent[]>
subscribeFeed(config, onEvent: (e: ClawnchpadFeedEvent) => void): () => void  // returns unsubscribe fn
```

---

## Phase 2 — On-chain: Metaplex Genesis LaunchPoolV2

**File:** `src/metaplexLaunch.ts`

Uses `@metaplex-foundation/umi` + `@metaplex-foundation/mpl-core` (or the Genesis-specific package — needs npm research).

```ts
createLaunchPool(wallet, {
  name: string
  symbol: string
  uri: string         // metadata JSON URI (arweave / IPFS)
  initialSupply: number
}): Promise<{ mint: string, bondingCurveKey: string, signature: string }>
```

**Key decisions needed:**
- Confirm correct npm package for Genesis LaunchPoolV2 (may be `@metaplex-foundation/mpl-token-metadata` + Genesis extension)
- Metadata upload strategy: use Bundlr/Irys or just pass an IPFS URI
- Whether Clawnchpad's `/api/launch` wraps this on-chain call or indexes an already-submitted tx

---

## Phase 3 — Strategy: `src/clawnchpadStrategy.ts`

Tick-based strategy that integrates with the existing `screener.ts` pipeline:

### Logic per tick

1. **Read Clawnchpad feed** — find recently launched tokens with rising buy pressure
2. **Score them** — reuse `scoreGraduatedToken` logic adapted for Clawnchpad bonding curve events
3. **Check existing positions** — avoid doubling into a token already held
4. **Buy decision** — if score ≥ minScore and position < maxSolPerToken
5. **Post a message** — social signal after every trade ("bought X SOL of $SYMBOL, score=82")
6. **Take profit / stop loss** — sell when price hits `takeProfitMultiple` or drops 50%
7. **Watch pump.fun feed too** — graduated tokens may also appear on Clawnchpad post-migration

### Integration with `strategyManager.ts`

Add `startClawnchpadStrategy(config)` and `stopClawnchpadStrategy()` to the existing singleton pattern, consistent with `startWeatherArb` / `stopWeatherArb`.

---

## Phase 4 — Plugin Tools (`src/plugin.ts`)

New tools registered with OpenClaw:

| Tool | Description |
|---|---|
| `clawnchpad_register_agent` | Register this wallet as an agent on Clawnchpad |
| `clawnchpad_launch_token` | Launch a new token (name, symbol, description, imageUrl) |
| `clawnchpad_buy` | Buy a token on the bonding curve (mint, solAmount) |
| `clawnchpad_sell` | Sell a token (mint, tokenAmount) |
| `clawnchpad_post_message` | Post a chat message for a specific token |
| `clawnchpad_get_feed` | Fetch recent launches, trades, and messages |
| `start_clawnchpad_strategy` | Start the auto-buy/sell/post strategy |
| `stop_clawnchpad_strategy` | Stop the strategy |

All tools follow the same pattern as existing plugin tools: `execute` returns `{ content: [{ type: "text", text: string }] }`.

---

## Phase 5 — CLI (`bin/solana-wallet.ts`)

New commands:

```
clawnchpad register <wallet>
clawnchpad launch <wallet> <name> <symbol> [--description "..."] [--image-url "..."]
clawnchpad buy <wallet> <mint> <sol-amount>
clawnchpad sell <wallet> <mint> <token-amount>
clawnchpad post <wallet> <mint> <message>
clawnchpad feed [--limit 20]
scanner start clawnchpad <wallet> [--min-score 60] [--max-sol 0.1] [--dry-run]
scanner stop clawnchpad
```

---

## Environment Variables

```env
CLAWNCHPAD_BASE_URL=https://clawnchpad.bot
CLAWNCHPAD_API_KEY=          # if required by the platform
CLAWNCHPAD_AGENT_ID=         # populated after first register call
```

---

## Unknowns / Blockers

| Unknown | Resolution path |
|---|---|
| Clawnchpad REST API spec (repo is private) | Inspect live site network traffic in DevTools; or request access from @blockiosaurus |
| Metaplex Genesis LaunchPoolV2 SDK package name | Check npm + Metaplex docs for Genesis/LaunchPool package |
| Agent auth mechanism (keypair sig vs API key) | Network inspection or direct contact |
| Post-graduation swap routing (Jupiter vs Raydium) | Clawnchpad likely uses Jupiter; our existing `raydiumSwap` may not apply |

---

## Suggested Implementation Order

```
Phase 1  types + API client skeleton    ← start here, some stubs OK
Phase 2  Metaplex LaunchPool on-chain   ← needs SDK research
Phase 3  strategy logic                 ← depends on Phase 1 + 2
Phase 4  plugin tools                   ← depends on Phase 3
Phase 5  CLI commands                   ← last, thin wrappers
```

**Recommended first step:** Inspect `clawnchpad.bot` network traffic in browser DevTools while performing a launch and a trade to map the exact API endpoints and auth headers. This unblocks all other phases.
