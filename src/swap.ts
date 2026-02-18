import { Connection, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { SOLANA_RPC_URL, explorerTx } from "./environment.ts"
import { loadKeypair } from "./wallet.ts"
import type { SwapResult } from "./types.ts"

const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6/quote"
const JUPITER_SWAP_API  = "https://quote-api.jup.ag/v6/swap"

export const SOL_MINT  = "So11111111111111111111111111111111111111112"
// Orca devnet USDC — useful for devnet swap tests
export const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

export const solToLamports = (sol: number): number => Math.floor(sol * LAMPORTS_PER_SOL)

export const jupiterQuote = async (
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps = 300
): Promise<Record<string, unknown>> => {
  const url =
    `${JUPITER_QUOTE_API}` +
    `?inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amountLamports}` +
    `&slippageBps=${slippageBps}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Jupiter quote failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<Record<string, unknown>>
}

export const jupiterSwap = async (
  walletName: string,
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps = 300,
  rpcUrl?: string
): Promise<SwapResult> => {
  const rpc = rpcUrl ?? SOLANA_RPC_URL
  const connection = new Connection(rpc, "confirmed")
  const keypair = await loadKeypair(walletName)

  const quoteResponse = await jupiterQuote(inputMint, outputMint, amountLamports, slippageBps)

  const swapRes = await fetch(JUPITER_SWAP_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  })

  if (!swapRes.ok) throw new Error(`Jupiter swap failed (${swapRes.status}): ${await swapRes.text()}`)

  const { swapTransaction } = await swapRes.json() as { swapTransaction: string }

  const txBuf = Buffer.from(swapTransaction, "base64")
  const transaction = VersionedTransaction.deserialize(txBuf)
  transaction.sign([keypair])

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 2,
  })

  await connection.confirmTransaction(signature, "confirmed")

  const inputAmountSol = amountLamports / LAMPORTS_PER_SOL
  const rawOutAmount = quoteResponse.outAmount as string | number
  const outDecimals = (quoteResponse.outputMint as { decimals?: number } | undefined)?.decimals ?? 6
  const outputAmount = Number(rawOutAmount) / 10 ** outDecimals

  return {
    signature,
    explorerUrl: explorerTx(signature, rpc),
    inputMint,
    outputMint,
    inputAmountSol,
    outputAmount,
  }
}
