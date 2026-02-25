import { Connection, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import { getMint } from "@solana/spl-token"
import { explorerTx } from "./environment.ts"
import { loadKeypair } from "./wallet.ts"
import type { SwapResult } from "./types.ts"

const RAYDIUM_SWAP_HOST = "https://transaction-v1.raydium.io"

export const SOL_MINT  = "So11111111111111111111111111111111111111112"
export const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

export const solToLamports = (sol: number): number => Math.floor(sol * LAMPORTS_PER_SOL)

interface RaydiumSwapCompute {
  success: boolean
  data?: {
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

async function sendRawTx(rpcUrl: string, txBase64: string): Promise<string> {
  console.log(`[RPC] Sending transaction...`)

  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "sendTransaction",
    params: [txBase64, { encoding: "base64", skipPreflight: true }]
  }

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  const responseText = await res.text()
  const data = JSON.parse(responseText) as { result?: string; error?: { message: string; code?: number } }
  
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`)
  }
  
  if (!data.result) {
    throw new Error(`No signature`)
  }

  return data.result
}

async function confirmTx(rpcUrl: string, signature: string, timeout = 30000): Promise<void> {
  const startTime = Date.now()
  let attempts = 0
  
  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[signature]],
        }),
      })

      const data = await res.json() as { result?: { value?: Array<{ confirmationStatus?: string } | null> } }
      const status = data.result?.value?.[0]?.confirmationStatus
      
      if (status === "confirmed" || status === "finalized") {
        console.log(`[RPC] ✅ Confirmed`)
        return
      }
      
      attempts++
      if (attempts % 5 === 0) {
        console.log(`[RPC] Waiting... (status: ${status || "pending"})`)
      }
    } catch (e) {}
    
    await new Promise(r => setTimeout(r, 1000))
  }

  throw new Error(`Timeout`)
}

export const raydiumSwap = async (
  walletName: string,
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps = 300,
  rpcUrl?: string
): Promise<SwapResult> => {
  const rpc = rpcUrl || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com"
  const connection = new Connection(rpc, "confirmed")
  const keypair = await loadKeypair(walletName)

  console.log(`[RAYDIUM] Getting quote...`)
  const quoteResponse = await raydiumQuote(inputMint, outputMint, amountLamports, slippageBps)
  if (!quoteResponse.success) {
    throw new Error(`Quote failed`)
  }

  console.log(`[RAYDIUM] Output: ${quoteResponse.data?.outputAmount}`)

  let computeUnitPrice = "1000000"
  try {
    const feeRes = await fetch(`${RAYDIUM_SWAP_HOST}/priority-fee`)
    if (feeRes.ok) {
      const feeData = await feeRes.json() as { data: { default: { h: number } } }
      computeUnitPrice = String(feeData.data.default.h)
    }
  } catch (e) {}

  console.log(`[RAYDIUM] Building transaction...`)
  const swapRes = await fetch(`${RAYDIUM_SWAP_HOST}/transaction/swap-base-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      computeUnitPriceMicroLamports: computeUnitPrice,
      swapResponse: quoteResponse,
      txVersion: "V0",
      wallet: keypair.publicKey.toBase58(),
      wrapSol: inputMint === SOL_MINT,
      unwrapSol: outputMint === SOL_MINT,
    }),
  })

  if (!swapRes.ok) throw new Error(`Raydium tx build failed (${swapRes.status}): ${await swapRes.text()}`)
  const swapData = await swapRes.json() as { success?: boolean; msg?: string; data?: Array<{ transaction: string }> }

  if (!swapData.success) throw new Error(`Raydium tx build failed: ${swapData.msg ?? "unknown error"}`)
  if (!swapData.data?.length) throw new Error(`Raydium tx build returned no transactions`)

  const txBuf = Buffer.from(swapData.data[0].transaction, "base64")
  const transaction = VersionedTransaction.deserialize(txBuf)
  transaction.sign([keypair])
  const signedBase64 = Buffer.from(transaction.serialize()).toString("base64")

  const signature = await sendRawTx(rpc, signedBase64)
  console.log(`[RPC] TX: ${signature}`)
  
  await confirmTx(rpc, signature)

  const mintInfo = await getMint(connection, new PublicKey(outputMint))
  const outputAmount = parseInt(quoteResponse.data?.outputAmount || "0") / 10 ** mintInfo.decimals
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
