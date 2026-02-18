// Typed env loader — validated at access time, not import time
// so commands that don't touch keys (e.g. find-pairs) don't fail on missing vars

const require = (key: string): string => {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}\nRun: cp .env.example .env && pnpm setup`)
  return val
}

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback

// Master key — required for any wallet signing operation
export const MASTER_ENCRYPTION_PASSWORD_CRYPTO = () => require("MASTER_ENCRYPTION_PASSWORD_CRYPTO")
export const MASTER_ENCRYPTED = () => require("MASTER_ENCRYPTED")
export const MASTER_SALT = () => require("MASTER_SALT")

// Network
export const SOLANA_RPC_URL = optional(
  "SOLANA_RPC_URL",
  "https://api.devnet.solana.com"
)

// Wallet store path
export const WALLET_STORE_PATH = optional(
  "WALLET_STORE_PATH",
  `${process.env.HOME ?? "~"}/.solana-agent-wallets.json`
)

// pump.fun WebSocket — public, no key needed
export const PUMPPORTAL_WS = optional(
  "PUMPPORTAL_WS",
  "wss://pumpportal.fun/api/data"
)

// Secondary: DexScreener (free REST, no key)
export const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex"

// Explorer URLs
export const explorerTx = (sig: string, rpcUrl = SOLANA_RPC_URL): string =>
  rpcUrl.includes("devnet")
    ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    : `https://explorer.solana.com/tx/${sig}`
