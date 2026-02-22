#!/usr/bin/env tsx
import "dotenv/config"
import { createWallet, listWallets } from "../src/wallet.ts"
import { getPortfolioSummary } from "../src/balance.ts"
import { transferSOL, transferSPL } from "../src/transfer.ts"
import { jupiterSwap, solToLamports, SOL_MINT } from "../src/swap.ts"
import { findHighPotentialPairs, getBufferStats } from "../src/screener.ts"
import { threeXStrategy } from "../src/strategy.ts"
import { runAgentLoop } from "../src/agent.ts"
import { strategyManager } from "../src/strategyManager.ts"

// ── Arg helpers ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const cmd  = args[0]
const sub  = args[1]

const flag = (name: string): boolean => args.includes(`--${name}`)

const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

const jsonMode = flag("json")

const out = (data: unknown): void => {
  if (jsonMode) {
    console.log(JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 2))
  } else {
    console.log(data)
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────────

const usage = () => console.log(`
Solana Agentic Wallet — autonomous on-chain agent

Usage: solana-wallet <command> [options]

Commands:
  wallet create <name> [--network devnet|mainnet-beta]
  wallet list
  balance <wallet-name>
  transfer sol <from-wallet> <to-address> <amount-sol>
  transfer spl <from-wallet> <to-address> <mint> <amount>
  swap <wallet> <input-mint> <output-mint> <amount-sol>
  find-pairs [--min-score 60]
  trade <wallet> [--strategy 3x] [--max-risk 5] [--dry-run]
  agent <wallet> [--interval 300] [--max-risk 5] [--dry-run]
  scanner start pumpfun <wallet> [--interval 300] [--max-risk 5] [--dry-run]
  scanner stop  pumpfun
  scanner start weather-arb <wallet>
                --office <code> --grid-x <n> --grid-y <n>
                --threshold <F> --yes-token <mint> --amount <usdc>
                [--dry-run]
  scanner stop  weather-arb
  scanner status

Options:
  --network    devnet (default) or mainnet-beta
  --dry-run    Log decisions without executing trades
  --min-score  Minimum pair score 0-100 (default: 60)
  --interval   Agent loop interval in seconds (default: 300)
  --max-risk   Max % of portfolio per trade (default: 5)
  --json       Output as JSON
  --verbose    Show raw pump.fun WebSocket events

Shortcuts:
  solana-wallet swap <wallet> SOL USDC <amount>   # uses known mint addresses

Setup:
  cp .env.example .env
  pnpm setup    # generates MASTER_ENCRYPTED + MASTER_SALT
`)

// ── Command router ────────────────────────────────────────────────────────────

const run = async () => {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage()
    return
  }

  // ── wallet create <name> ─────────────────────────────────────────────────

  if (cmd === "wallet" && sub === "create") {
    const name = args[2]
    if (!name) { console.error("Error: wallet name required\nUsage: solana-wallet wallet create <name>"); process.exit(1) }

    const network = (opt("network") ?? "devnet") as "devnet" | "mainnet-beta"
    const result = await createWallet(name, network)

    if (jsonMode) { out(result); return }
    console.log(`\n✅ Wallet created`)
    console.log(`   Name:    ${result.name}`)
    console.log(`   Address: ${result.publicKey}`)
    console.log(`   Network: ${result.network}`)
    console.log(`\nTo fund on devnet:`)
    console.log(`   solana airdrop 2 ${result.publicKey} --url devnet`)
    return
  }

  // ── wallet list ──────────────────────────────────────────────────────────

  if (cmd === "wallet" && sub === "list") {
    const wallets = await listWallets()

    if (wallets.length === 0) {
      console.log("No wallets found. Create one:\n  solana-wallet wallet create <name>")
      return
    }

    if (jsonMode) { out(wallets); return }

    console.log(`\n${"NAME".padEnd(20)} ${"PUBLIC KEY".padEnd(46)} NETWORK`)
    console.log("─".repeat(74))
    for (const w of wallets) {
      console.log(`${w.name.padEnd(20)} ${w.publicKey.padEnd(46)} ${w.network}`)
    }
    return
  }

  // ── balance <wallet-name> ────────────────────────────────────────────────

  if (cmd === "balance") {
    if (!sub) { console.error("Usage: solana-wallet balance <wallet-name>"); process.exit(1) }

    const result = await getPortfolioSummary(sub)

    if (jsonMode) { out(result); return }
    console.log(`\nWallet:  ${result.walletName}`)
    console.log(`Address: ${result.publicKey}`)
    console.log(`SOL:     ${result.solBalance.toFixed(6)} (${result.lamports.toLocaleString()} lamports)`)

    if (result.tokens.length > 0) {
      console.log(`\nTokens (${result.tokens.length}):`)
      for (const t of result.tokens) {
        console.log(`  ${t.mint.slice(0, 6)}...${t.mint.slice(-4)}  ${t.uiAmount.toFixed(4)}`)
      }
    } else {
      console.log("Tokens:  none")
    }
    return
  }

  // ── transfer sol <from> <to> <amount> ────────────────────────────────────

  if (cmd === "transfer" && sub === "sol") {
    const [,, from, to, amountStr] = args
    if (!from || !to || !amountStr) {
      console.error("Usage: solana-wallet transfer sol <from-wallet> <to-address> <amount>")
      process.exit(1)
    }

    console.log(`Transferring ${amountStr} SOL from "${from}" to ${to}...`)
    const result = await transferSOL(from, to, parseFloat(amountStr))

    if (jsonMode) { out(result); return }
    console.log(`\n✅ Transfer confirmed`)
    console.log(`   Amount:    ${amountStr} SOL`)
    console.log(`   Explorer:  ${result.explorerUrl}`)
    return
  }

  // ── transfer spl <from> <to> <mint> <amount> ─────────────────────────────

  if (cmd === "transfer" && sub === "spl") {
    const [,, from, to, mint, amountStr] = args
    if (!from || !to || !mint || !amountStr) {
      console.error("Usage: solana-wallet transfer spl <from-wallet> <to-address> <mint> <amount>")
      process.exit(1)
    }

    console.log(`Transferring ${amountStr} tokens from "${from}" to ${to}...`)
    const result = await transferSPL(from, to, mint, parseFloat(amountStr))

    if (jsonMode) { out(result); return }
    console.log(`\n✅ Transfer confirmed`)
    console.log(`   Explorer:  ${result.explorerUrl}`)
    return
  }

  // ── swap <wallet> <input> <output> <amount> ──────────────────────────────

  if (cmd === "swap") {
    const [, walletName, inputRaw, outputRaw, amountStr] = args
    if (!walletName || !inputRaw || !outputRaw || !amountStr) {
      console.error("Usage: solana-wallet swap <wallet> <input-mint> <output-mint> <amount-sol>")
      process.exit(1)
    }

    // Allow shortcuts: SOL → known mint address
    const mintMap: Record<string, string> = {
      SOL:  SOL_MINT,
      WSOL: SOL_MINT,
    }
    const inputMint  = mintMap[inputRaw.toUpperCase()]  ?? inputRaw
    const outputMint = mintMap[outputRaw.toUpperCase()] ?? outputRaw
    const amountSol  = parseFloat(amountStr)

    console.log(`Swapping ${amountStr} SOL via Jupiter...`)
    const result = await jupiterSwap(walletName, inputMint, outputMint, solToLamports(amountSol))

    if (jsonMode) { out(result); return }
    console.log(`\n✅ Swap confirmed`)
    console.log(`   In:       ${result.inputAmountSol} SOL`)
    console.log(`   Out:      ${result.outputAmount}`)
    console.log(`   Explorer: ${result.explorerUrl}`)
    return
  }

  // ── find-pairs ───────────────────────────────────────────────────────────

  if (cmd === "find-pairs") {
    const minScore = parseInt(opt("min-score") ?? "60")

    console.log("[screener] Scanning pump.fun graduation buffer...")
    const stats = getBufferStats()
    console.log(`[screener] Buffer: ${stats.totalEvents} events | ${stats.trackedTokens} tokens | Connected: ${stats.connected}`)

    const pairs = await findHighPotentialPairs(minScore)

    if (pairs.length === 0) {
      console.log("\nNo qualifying pairs found in the last 30 minutes.")
      console.log("Tip: run `solana-wallet agent <wallet> --dry-run` to start collecting live graduation events.")
      return
    }

    if (jsonMode) { out(pairs); return }

    console.log(`\nTop ${pairs.length} pair(s) scoring ≥ ${minScore}/100:\n`)
    for (const [i, p] of pairs.entries()) {
      console.log(`${i + 1}. ${p.symbol} — ${p.name}`)
      console.log(`   Mint:   ${p.mint}`)
      console.log(`   Score:  ${p.score}/100`)
      console.log(`   Signal: ${p.reason}`)
      if (p.raydiumPool) console.log(`   Pool:   ${p.raydiumPool}`)
      console.log()
    }
    return
  }

  // ── trade <wallet> ───────────────────────────────────────────────────────

  if (cmd === "trade") {
    if (!sub) { console.error("Usage: solana-wallet trade <wallet-name> [--strategy 3x] [--dry-run]"); process.exit(1) }

    const walletName = sub
    const dryRun     = flag("dry-run")
    const maxRisk    = parseFloat(opt("max-risk") ?? "5")

    console.log(`Running 3x strategy for wallet "${walletName}"...`)
    const portfolio = await getPortfolioSummary(walletName)
    console.log(`Portfolio: ${portfolio.solBalance.toFixed(6)} SOL`)

    const decision = await threeXStrategy(portfolio.solBalance, maxRisk)

    if (jsonMode) { out(decision); return }

    console.log(`\nDecision: ${decision.action.toUpperCase()}`)
    console.log(`Reason:   ${decision.reason}`)

    if (decision.action === "buy" && decision.token) {
      console.log(`Token:    ${decision.token.symbol} (${decision.token.mint})`)
      console.log(`Amount:   ${decision.suggestedAmountSol} SOL`)
      console.log(`Target:   ${decision.targetMultiple}x | Stop-loss: ${decision.stopLossPercent}%`)

      if (dryRun) {
        console.log("\n[dry-run] No trade executed. Remove --dry-run to go live.")
      } else {
        console.log("\nExecuting swap via Jupiter...")
        const result = await jupiterSwap(
          walletName,
          SOL_MINT,
          decision.token.mint,
          solToLamports(decision.suggestedAmountSol)
        )
        console.log(`\n✅ Trade executed!`)
        console.log(`   In:       ${result.inputAmountSol} SOL`)
        console.log(`   Out:      ${result.outputAmount} ${decision.token.symbol}`)
        console.log(`   Explorer: ${result.explorerUrl}`)
      }
    }
    return
  }

  // ── agent <wallet> ───────────────────────────────────────────────────────

  if (cmd === "agent") {
    if (!sub) { console.error("Usage: solana-wallet agent <wallet-name> [--interval 300] [--dry-run]"); process.exit(1) }

    await runAgentLoop({
      walletName: sub,
      intervalSeconds: parseInt(opt("interval") ?? "300"),
      strategy: "3x",
      maxRiskPercent: parseFloat(opt("max-risk") ?? "5"),
      dryRun: flag("dry-run"),
    })
    return
  }

  // ── scanner ───────────────────────────────────────────────────────────────

  if (cmd === "scanner") {
    // scanner status
    if (sub === "status") {
      const s = strategyManager.getStatus()
      console.log(`\n── Pumpfun Scanner ─────────────────────`)
      console.log(`  Running:          ${s.pumpfun.running}`)
      console.log(`  Graduations seen: ${s.pumpfun.lastGraduations}`)
      console.log(`  Last check:       ${s.pumpfun.lastCheckAt ?? "never"}`)
      console.log(``)
      console.log(`── Weather Arb Scanner ──────────────────`)
      console.log(`  Running:          ${s.weather_arb.running}`)
      console.log(`  City (office):    ${s.weather_arb.city ?? "not configured"}`)
      console.log(`  NOAA forecast:    ${s.weather_arb.lastNoaaTemp != null ? `${s.weather_arb.lastNoaaTemp}°F` : "pending"}`)
      console.log(`  Confidence:       ${s.weather_arb.lastConfidence != null ? `${Math.round(s.weather_arb.lastConfidence * 100)}%` : "pending"}`)
      console.log(`  Jupiter odds:     ${s.weather_arb.lastJupiterOdds != null ? `${Math.round(s.weather_arb.lastJupiterOdds * 100)}%` : "pending"}`)
      console.log(`  Last check:       ${s.weather_arb.lastCheckAt ?? "never"}`)
      return
    }

    const scannerAction = sub           // "start" or "stop"
    const scannerTarget = args[2]       // "pumpfun" or "weather-arb"

    // scanner stop pumpfun
    if (scannerAction === "stop" && scannerTarget === "pumpfun") {
      strategyManager.stopPumpfun()
      console.log("Pumpfun scanner stopped.")
      return
    }

    // scanner stop weather-arb
    if (scannerAction === "stop" && scannerTarget === "weather-arb") {
      strategyManager.stopWeatherArb()
      console.log("Weather arb scanner stopped.")
      return
    }

    // scanner start pumpfun <wallet>
    if (scannerAction === "start" && scannerTarget === "pumpfun") {
      const walletName = args[3]
      if (!walletName) {
        console.error("Usage: solana-wallet scanner start pumpfun <wallet>")
        process.exit(1)
      }
      strategyManager.startPumpfun({
        walletName,
        intervalSeconds: parseInt(opt("interval") ?? "300"),
        strategy: "3x",
        maxRiskPercent: parseFloat(opt("max-risk") ?? "5"),
        dryRun: flag("dry-run"),
      })
      console.log(`Pumpfun scanner started for wallet "${walletName}". Process will keep running.`)
      // setInterval keeps the process alive
      return
    }

    // scanner start weather-arb <wallet>
    if (scannerAction === "start" && scannerTarget === "weather-arb") {
      const walletName = args[3]
      const office = opt("office")
      const gridX = opt("grid-x")
      const gridY = opt("grid-y")
      const threshold = opt("threshold")
      const yesToken = opt("yes-token")
      const amount = opt("amount")

      if (!walletName || !office || !gridX || !gridY || !threshold || !yesToken || !amount) {
        console.error(
          "Usage: solana-wallet scanner start weather-arb <wallet>\n" +
          "  --office <code> --grid-x <n> --grid-y <n>\n" +
          "  --threshold <F> --yes-token <mint> --amount <usdc> [--dry-run]"
        )
        process.exit(1)
      }

      strategyManager.startWeatherArb({
        walletName,
        gridpointOffice: office,
        gridX: parseInt(gridX),
        gridY: parseInt(gridY),
        tempThresholdF: parseFloat(threshold),
        yesTokenMint: yesToken,
        tradeAmountUsdc: parseFloat(amount),
        minConfidence: 0.90,
        maxJupiterOdds: 0.40,
        intervalSeconds: parseInt(opt("interval") ?? "120"),
        dryRun: flag("dry-run"),
      })
      console.log(`Weather arb scanner started for wallet "${walletName}". Process will keep running.`)
      // setInterval keeps the process alive
      return
    }

    console.error(`Unknown scanner subcommand: ${scannerAction} ${scannerTarget ?? ""}`)
    usage()
    process.exit(1)
  }

  console.error(`Unknown command: ${cmd}`)
  usage()
  process.exit(1)
}

run().catch(err => {
  console.error("\nFatal error:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
