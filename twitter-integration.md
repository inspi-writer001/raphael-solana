# Twitter / X API Integration Plan

> Enable the agent to read and write to X (Twitter) using both OAuth 1.0a and OAuth 2.0.
> Library: `twitter-api-v2` (npm) — handles both auth flows, typed responses, rate limit plugin.

---

## Auth Requirements by Operation

| Operation | Auth needed | Notes |
|---|---|---|
| Search tweets | OAuth 2.0 App-Only (Bearer) | Read-only, no user context needed |
| Get user timeline | OAuth 2.0 App-Only | Same |
| Get mentions | OAuth 1.0a **or** OAuth 2.0 User (PKCE) | User context required |
| Post tweet | OAuth 1.0a **or** OAuth 2.0 User (PKCE) | User context required |
| Reply to tweet | OAuth 1.0a **or** OAuth 2.0 User (PKCE) | User context required |
| Like / Retweet | OAuth 1.0a **or** OAuth 2.0 User (PKCE) | User context required |
| Upload media | OAuth 1.0a **only** | OAuth 2.0 does NOT support media upload |

**Practical conclusion:** We need both OAuth 1.0a credentials (for writes + media) and a Bearer token (for efficient read-only searches). OAuth 2.0 PKCE is optional — OAuth 1.0a covers everything for a single-account agent.

---

## Environment Variables Required

```env
# OAuth 1.0a — user context (read + write + media)
X_API_KEY=                    # Consumer Key
X_API_SECRET=                 # Consumer Secret
X_ACCESS_TOKEN=               # User Access Token (your bot account)
X_ACCESS_TOKEN_SECRET=        # User Access Token Secret

# OAuth 2.0 — App-Only (faster/cheaper reads)
X_BEARER_TOKEN=               # Generated from developer portal

# OAuth 2.0 PKCE (optional, only if we add 3-legged flow later)
# X_CLIENT_ID=
# X_CLIENT_SECRET=
```

All obtained from: https://developer.x.com → Projects & Apps → Keys and Tokens.

---

## Rate Limits (March 2026)

| Tier | Monthly cost | POST /2/tweets | GET search/recent | Mentions |
|---|---|---|---|---|
| Free | $0 | 1,500/month write-only | ✗ NO READ | ✗ |
| Basic | $100/mo | Unlimited* | 10 req/15min | Limited |
| Pro | $5,000/mo | Unlimited* | 450 req/15min | 180 req/15min |

**For an agent that reads AND writes: Basic tier minimum.**
Free tier has zero read access — useless for monitoring/arb use cases.

---

## Package

```
pnpm add twitter-api-v2
pnpm add -D @twitter-api-v2/plugin-rate-limit
```

`twitter-api-v2` features:
- Built-in OAuth 1.0a + 2.0 handling (no manual HMAC signing)
- Fully typed v2 responses
- Async iterator pagination for timelines and search
- Rate limit tracking via plugin
- Chunked media upload helper

---

## Phase 1 — Client module: `src/xClient.ts`

```ts
export type XConfig = {
  // OAuth 1.0a (required for writes)
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
  // OAuth 2.0 app-only (for reads)
  bearerToken: string
}

// Returns: { rw: read-write user client, ro: read-only app client }
export const createXClients = (config: XConfig): { rw: TwitterApi, ro: TwitterApi }

// Post a tweet (text only)
export const postTweet = (rw: TwitterApi, text: string): Promise<{ id: string, text: string }>

// Reply to a tweet
export const replyToTweet = (rw: TwitterApi, tweetId: string, text: string): Promise<{ id: string }>

// Search recent tweets (last 7 days) — needs Basic+ tier
export const searchTweets = (ro: TwitterApi, query: string, maxResults?: number): Promise<Tweet[]>

// Get own mentions
export const getMentions = (rw: TwitterApi, userId: string, sinceId?: string): Promise<Tweet[]>

// Get a user's recent timeline
export const getUserTimeline = (ro: TwitterApi, userId: string, maxResults?: number): Promise<Tweet[]>

// Like a tweet
export const likeTweet = (rw: TwitterApi, userId: string, tweetId: string): Promise<void>

// Retweet
export const retweet = (rw: TwitterApi, userId: string, tweetId: string): Promise<void>

// Resolve @handle → userId (needed for timeline + like calls)
export const resolveUser = (ro: TwitterApi, handle: string): Promise<{ id: string, name: string, username: string }>
```

Types to add to `src/types.ts`:
```ts
XConfig { apiKey, apiSecret, accessToken, accessTokenSecret, bearerToken }
Tweet { id, text, authorId, createdAt, conversationId?, replyToId? }
XMentionEvent { tweet: Tweet, fromUser: string, receivedAt: number }
```

---

## Phase 2 — Strategy module: `src/xStrategy.ts`

A polling strategy that:

1. **Reads mentions** — checks for mentions of the agent's account every N seconds
2. **Reads keyword feed** — searches for configured keywords (e.g. `$BONK pump.fun graduation`)
3. **Decides to respond** — rule-based or model-based decision (configurable)
4. **Posts reply / quote tweet** — with rate-limit-aware backoff
5. **Posts market updates** — when the pumpfun scanner or weather arb fires a trade, auto-tweet a summary

Config shape:
```ts
XStrategyConfig {
  walletName: string
  xHandle: string                  // our bot's @handle
  monitorKeywords: string[]        // search terms to watch
  autoReplyToMentions: boolean
  postTradeUpdates: boolean        // tweet on every trade
  maxTweetsPerHour: number         // self-imposed rate limit (default 2)
  dryRun: boolean
  intervalSeconds: number          // poll interval (default 60)
}
```

### Integration hooks

- `strategyManager.ts` gets `startXStrategy(config)` + `stopXStrategy()`
- `runPolymarketWeatherArbTick` can call `xStrategy.onTrade(tradeResult)` to tweet
- `runPumpfunTick` can call `xStrategy.onGraduation(scoredToken)` to tweet

---

## Phase 3 — Plugin tools (`src/plugin.ts`)

New tools registered with OpenClaw:

| Tool | Parameters | Description |
|---|---|---|
| `x_post_tweet` | text | Post a tweet from the configured account |
| `x_reply` | tweet_id, text | Reply to a specific tweet |
| `x_search` | query, max_results | Search recent tweets |
| `x_get_mentions` | since_id? | Fetch recent mentions of the bot account |
| `x_like` | tweet_id | Like a tweet |
| `x_retweet` | tweet_id | Retweet |
| `start_x_strategy` | config | Start the mention monitor + keyword feed |
| `stop_x_strategy` | — | Stop it |

---

## Phase 4 — CLI (`bin/solana-wallet.ts`)

New commands:
```
x tweet <text>
x reply <tweet-id> <text>
x search <query> [--max 10]
x mentions [--since <tweet-id>]
x like <tweet-id>
x retweet <tweet-id>
scanner start x [--keywords "pump.fun,graduation"] [--dry-run]
scanner stop x
```

---

## `src/environment.ts` additions

```ts
export const X_API_KEY              = process.env["X_API_KEY"]              ?? ""
export const X_API_SECRET           = process.env["X_API_SECRET"]           ?? ""
export const X_ACCESS_TOKEN         = process.env["X_ACCESS_TOKEN"]         ?? ""
export const X_ACCESS_TOKEN_SECRET  = process.env["X_ACCESS_TOKEN_SECRET"]  ?? ""
export const X_BEARER_TOKEN         = process.env["X_BEARER_TOKEN"]         ?? ""
```

---

## Bot Safety Rules (X Terms of Service)

X's automation detection is aggressive. Follow these to avoid suspension:

| Rule | Limit |
|---|---|
| Max tweets per day | 5 (human average is 2-5; 30+ triggers flags) |
| Posting interval | Randomize ± 20% around target interval |
| Auto-likes / auto-retweets | Prohibited — do not automate engagement |
| Auto-follow / unfollow | Prohibited — instant ban |
| Coordinated posting | Never post same content across accounts |
| Mentions | OK to read; auto-reply must be manually reviewed content |

**Agent design principle:** The agent reads widely, posts sparingly, and never engages (likes/retweets) programmatically unless explicitly triggered by a human-approved command.

---

## Suggested Implementation Order

```
Phase 1  src/xClient.ts              ← start here, no deps
Phase 2  src/types.ts additions      ← alongside Phase 1
Phase 3  src/xStrategy.ts            ← after client works
Phase 4  plugin.ts tools             ← after strategy
Phase 5  CLI commands                ← last
```

**Recommended first step:** Set up a Basic tier developer account at https://developer.x.com, generate all 5 credentials, and wire them into `.env`. Then implement `src/xClient.ts` Phase 1 and verify `postTweet` + `searchTweets` work end-to-end before building the strategy layer.
