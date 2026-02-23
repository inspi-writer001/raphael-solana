export type Network = "devnet" | "mainnet-beta"

// ── Wallet Store ────────────────────────────────────────────────────────────

export type EncryptedWalletRecord = {
  name: string
  publicKey: string
  encryptedPrivateKey: string
  salt: string
  createdAt: string
  network: Network
  tags: string[]
}

export type WalletStore = {
  version: number
  wallets: Record<string, EncryptedWalletRecord>
}

export type WalletInfo = {
  name: string
  publicKey: string
  network: Network
  createdAt: string
  tags: string[]
}

// ── Balances ─────────────────────────────────────────────────────────────────

export type TokenBalance = {
  mint: string
  symbol: string
  decimals: number
  amount: bigint
  uiAmount: number
}

export type BalanceResult = {
  walletName: string
  publicKey: string
  solBalance: number
  lamports: number
  tokens: TokenBalance[]
}

// ── Transfers + Swaps ────────────────────────────────────────────────────────

export type TransferResult = {
  signature: string
  explorerUrl: string
  from: string
  to: string
  amount: number
  mint?: string
}

export type SwapResult = {
  signature: string
  explorerUrl: string
  inputMint: string
  outputMint: string
  inputAmountSol: number
  outputAmount: number
}

// ── pump.fun events ──────────────────────────────────────────────────────────

// Raw events from pumpportal.fun WebSocket (field names match their live API)
export type RawPumpEvent = Record<string, unknown> & {
  txType?: string
  mint?: string
}

export type PumpCreateEvent = {
  txType: "create"
  mint: string
  name: string
  symbol: string
  traderPublicKey: string
  initialBuy?: number
  bondingCurveKey?: string
}

export type PumpTradeEvent = {
  txType: "buy" | "sell"
  mint: string
  solAmount: number
  tokenAmount: number
  traderPublicKey: string
  newTokenBalance?: number
  bondingCurveKey?: string
}

// Graduation = token completed bonding curve, migrated to Raydium
// pump.fun may send this as txType "migrate" or a top-level "type" field
export type PumpGraduationEvent = {
  txType: "migrate" | "graduation"
  mint: string
  name: string
  symbol: string
  raydiumPool?: string
  bondingCurveKey?: string
}

export type PumpEvent = (PumpCreateEvent | PumpTradeEvent | PumpGraduationEvent) & {
  receivedAt: number   // added by us on receipt
}

// ── Screener ─────────────────────────────────────────────────────────────────

export type ScoredToken = {
  mint: string
  symbol: string
  name: string
  score: number
  reason: string
  raydiumPool?: string
  graduatedAt?: number
  source: "graduation" | "momentum"
}

export type DexScreenerConfirmation = {
  liquidityUsd: number
  volume1h: number
  priceChange1h: number
} | null

// ── Strategy ─────────────────────────────────────────────────────────────────

export type TradeDecision = {
  action: "buy" | "hold" | "skip"
  token: ScoredToken | null
  reason: string
  suggestedAmountSol: number
  targetMultiple: number
  stopLossPercent: number
}

// ── Agent ────────────────────────────────────────────────────────────────────

export type Position = {
  walletName: string
  mint: string
  symbol: string
  entryAmountSol: number
  tokensHeld: number
  openedAt: string
  targetMultiple: number
  stopLossPercent: number
  score: number
}

export type Trade = {
  walletName: string
  mint: string
  symbol: string
  action: "buy" | "sell"
  amountSol: number
  signature: string
  timestamp: string
  score: number
}

export type AgentConfig = {
  walletName: string
  intervalSeconds: number
  strategy: "3x" | "manual"
  maxRiskPercent: number
  dryRun: boolean
}

export type AgentState = {
  openPositions: Position[]
  tradeHistory: Trade[]
  lastRunAt: string | null
}

// ── Weather Arb ──────────────────────────────────────────────────────────────
export type WeatherArbConfig = {
  walletName: string
  gridpointOffice: string   // e.g. "OKX" (New York), "LOT" (Chicago)
  gridX: number
  gridY: number
  tempThresholdF: number    // e.g. 50  — the binary event temperature
  kalshiSeriesTicker: string  // e.g. "KXHIGHNY", "KXHIGHCHI", "KXHIGHLA"
  tradeAmountUsdc: number   // USDC to spend per buy (e.g. 10)
  minConfidence: number     // default 0.90 (fire only when NOAA ≥ this confident)
  maxMarketOdds: number     // default 0.40 (buy only when market is this or cheaper)
  intervalSeconds: number   // poll interval, default 120
  dryRun: boolean
}

export type NoaaForecast = {
  forecastHighF: number
  periodName: string
  shortForecast: string
  isDaytime: boolean
  fetchedAt: number
}

export type WeatherArbReading = {
  noaaForecast: NoaaForecast
  confidence: number              // 0-1 derived from threshold delta model
  kalshiImpliedOdds: number       // 0-1 bracket-sum probability from Kalshi
  edge: number                    // confidence − kalshiImpliedOdds
  hasEdge: boolean
  thresholdBracketTicker: string | null  // Kalshi ticker at threshold (for execution)
  resolvedYesMint: string | null         // SPL mint from DFlow (null if no API key)
  fetchedAt: number
}

// ── Strategy Manager ─────────────────────────────────────────────────────────
export type StrategyStatus = {
  pumpfun: {
    running: boolean
    lastGraduations: number
    lastCheckAt: string | null
  }
  weather_arb: {
    running: boolean
    lastNoaaTemp: number | null
    lastMarketOdds: number | null
    lastConfidence: number | null
    lastCheckAt: string | null
    city: string | null           // human label derived from gridpointOffice
  }
  _source?: "live" | "file" | "default" | "dead_daemon_cleanup"
  _stale?: boolean
}
