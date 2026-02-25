import { Connection, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import { getMint } from "@solana/spl-token"
import { SOLANA_RPC_URL, explorerTx } from "./environment.ts"
import { loadKeypair } from "./wallet.ts"
import type { SwapResult } from "./types.ts"

const RAYDIUM_SWAP_HOST = "https://transaction-v1.raydium.io"

export const SOL_MINT  = "So11111111111111111111111111111111111111112"
// Orca devnet USDC — useful for devnet swap tests
export const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

export const solToLamports = (sol: number): number => Math.floor(sol * LAMPORTS_PER_SOL)

interface RaydiumSwapCompute {
  success: boolean
  data: {
    inputMint: string
    inputAmount: string
    outputMint: string
    outputAmount: string
    slippageBps: number
    priceImpactPct: number
    routePlan: Array<{ poolId: string; inputMint: string; outputMint: string }>
  }
}

export const raydiumQuote = async (
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps = 300
): Promise<RaydiumSwapCompute> => {
  const url =
    `${RAYDIUM_SWAP_HOST}/compute/swap-base-in` +
    `?inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amountLamports}` +
    `&slippageBps=${slippageBps}` +
    `&txVersion=V0`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Raydium quote failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<RaydiumSwapCompute>
}

export const raydiumSwap = async (
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

  const quoteResponse = await raydiumQuote(inputMint, outputMint, amountLamports, slippageBps)
  if (!quoteResponse.success) {
    throw new Error(`Raydium quote unsuccessful: ${JSON.stringify(quoteResponse)}`)
  }

  const feeRes = await fetch(`${RAYDIUM_SWAP_HOST}/priority-fee`)
  if (!feeRes.ok) throw new Error(`Raydium priority-fee failed (${feeRes.status}): ${await feeRes.text()}`)
  const feeData = await feeRes.json() as { data: { default: { h: number } } }
  const computeUnitPriceMicroLamports = String(feeData.data.default.h)

  const swapRes = await fetch(`${RAYDIUM_SWAP_HOST}/transaction/swap-base-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      computeUnitPriceMicroLamports,
      swapResponse: quoteResponse,
      txVersion: "V0",
      wallet: keypair.publicKey.toBase58(),
      wrapSol: inputMint === SOL_MINT,
      unwrapSol: outputMint === SOL_MINT,
    }),
  })

  if (!swapRes.ok) throw new Error(`Raydium swap failed (${swapRes.status}): ${await swapRes.text()}`)

  const { data: txData } = await swapRes.json() as { data: [{ transaction: string }] }
  const txBuf = Buffer.from(txData[0].transaction, "base64")
  const transaction = VersionedTransaction.deserialize(txBuf)
  transaction.sign([keypair])

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 2,
  })

  await connection.confirmTransaction(signature, "confirmed")

  const mintInfo = await getMint(connection, new PublicKey(outputMint))
  const outputAmount = parseInt(quoteResponse.data.outputAmount) / 10 ** mintInfo.decimals
  const inputAmountSol = amountLamports / LAMPORTS_PER_SOL

  return {
    signature,
    explorerUrl: explorerTx(signature, rpc),
    inputMint,
    outputMint,
    inputAmountSol,
    outputAmount,
  }
}
