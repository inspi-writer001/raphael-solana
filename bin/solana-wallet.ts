#!/usr/bin/env tsx
import "dotenv/config";
import { createWallet, listWallets } from "../src/wallet.ts";
import { getPortfolioSummary } from "../src/balance.ts";
import { transferSOL, transferSPL } from "../src/transfer.ts";
import { jupiterSwap, solToLamports, SOL_MINT } from "../src/swap.ts";
import { findHighPotentialPairs, getBufferStats } from "../src/screener.ts";
import { threeXStrategy } from "../src/strategy.ts";
import { runAgentLoop } from "../src/agent.ts";
import { strategyManager } from "../src/strategyManager.ts";

// ── Arg helpers ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

const flag = (name: string): boolean => args.includes(`--${name}`);

const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const jsonMode = flag("json");

const out = (data: unknown): void => {
  if (jsonMode) {
    console.log(
      JSON.stringify(
        data,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
  } else {
    console.log(data);
  }
};

// ── Usage ─────────────────────────────────────────────────────────────────────

const usage = () =>
  console.log(`
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
                --threshold <F> --series <ticker> --amount <usdc>
                [--interval 120] [--dry-run]
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

Setup:
  pnpm install
  pnpm setup    # generates MASTER_ENCRYPTED + MASTER_SALT
`);

// ── Command router ────────────────────────────────────────────────────────────

const run = async () => {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }

  // ── wallet create ────────────────────────────────────────────────────────
  if (cmd === "wallet" && sub === "create") {
    const name = args[2];
    if (!name) {
      console.error(
        "Error: wallet name required\nUsage: solana-wallet wallet create <name>",
      );
      process.exit(1);
    }
    const network = (opt("network") ?? "devnet") as "devnet" | "mainnet-beta";
    const result = await createWallet(name, network);
    if (jsonMode) {
      out(result);
      return;
    }
    console.log(`\n✅ Wallet created: ${result.publicKey} (${result.network})`);
    return;
  }

  // ── wallet list ──────────────────────────────────────────────────────────
  if (cmd === "wallet" && sub === "list") {
    const wallets = await listWallets();
    if (jsonMode) {
      out(wallets);
      return;
    }
    console.log(`\n${"NAME".padEnd(20)} ${"PUBLIC KEY".padEnd(46)} NETWORK`);
    wallets.forEach((w) =>
      console.log(
        `${w.name.padEnd(20)} ${w.publicKey.padEnd(46)} ${w.network}`,
      ),
    );
    return;
  }

  // ── balance ──────────────────────────────────────────────────────────────
  if (cmd === "balance") {
    if (!sub) {
      console.error("Usage: solana-wallet balance <wallet-name>");
      process.exit(1);
    }
    const result = await getPortfolioSummary(sub);
    if (jsonMode) {
      out(result);
      return;
    }
    console.log(
      `\nSOL: ${result.solBalance.toFixed(6)} | Tokens: ${result.tokens.length}`,
    );
    return;
  }

  // ── transfer ─────────────────────────────────────────────────────────────
  if (cmd === "transfer") {
    const [, , from, to, amountStr] = args;
    if (sub === "sol") {
      const result = await transferSOL(from, to, parseFloat(amountStr));
      out(result);
    } else if (sub === "spl") {
      const mint = args[4];
      const amt = args[5];
      const result = await transferSPL(from, to, mint, parseFloat(amt));
      out(result);
    }
    return;
  }

  // ── swap ─────────────────────────────────────────────────────────────────
  if (cmd === "swap") {
    const [, walletName, inputRaw, outputRaw, amountStr] = args;
    const inputMint = inputRaw.toUpperCase() === "SOL" ? SOL_MINT : inputRaw;
    const outputMint = outputRaw.toUpperCase() === "SOL" ? SOL_MINT : outputRaw;
    const result = await jupiterSwap(
      walletName,
      inputMint,
      outputMint,
      solToLamports(parseFloat(amountStr)),
    );
    out(result);
    return;
  }

  // ── find-pairs ───────────────────────────────────────────────────────────
  if (cmd === "find-pairs") {
    const minScore = parseInt(opt("min-score") ?? "60");
    const pairs = await findHighPotentialPairs(minScore);
    out(pairs);
    return;
  }

  // ── trade / agent (legacy loops) ─────────────────────────────────────────
  if (cmd === "trade") {
    const decision = await threeXStrategy(
      (await getPortfolioSummary(sub)).solBalance,
      parseFloat(opt("max-risk") ?? "5"),
    );
    out(decision);
    return;
  }

  if (cmd === "agent") {
    await runAgentLoop({
      walletName: sub,
      intervalSeconds: parseInt(opt("interval") ?? "300"),
      strategy: "3x",
      maxRiskPercent: parseFloat(opt("max-risk") ?? "5"),
      dryRun: flag("dry-run"),
    });
    return;
  }

  // ── scanner (Background Manager Integration) ──────────────────────────────
  if (cmd === "scanner") {
    if (sub === "status") {
      const s = strategyManager.getStatus();
      console.log(`\n── Status Check: ${new Date().toISOString()} ──`);
      console.log(`\n[Pumpfun Scanner]`);
      console.log(
        `  Status:           ${s.pumpfun.running ? "RUNNING" : "STOPPED"}`,
      );
      console.log(`  Graduations:      ${s.pumpfun.lastGraduations}`);
      console.log(`  Last Check:       ${s.pumpfun.lastCheckAt ?? "never"}`);

      console.log(`\n[Weather Arb Scanner]`);
      console.log(
        `  Status:           ${s.weather_arb.running ? "RUNNING" : "STOPPED"}`,
      );
      console.log(`  City/Office:      ${s.weather_arb.city ?? "N/A"}`);
      console.log(
        `  Current NOAA:     ${s.weather_arb.lastNoaaTemp != null ? `${s.weather_arb.lastNoaaTemp}°F` : "pending"}`,
      );
      console.log(
        `  Market Odds:      ${s.weather_arb.lastMarketOdds != null ? `${Math.round(s.weather_arb.lastMarketOdds * 100)}%` : "pending"}`,
      );
      console.log(
        `  Confidence:       ${s.weather_arb.lastConfidence != null ? `${Math.round(s.weather_arb.lastConfidence * 100)}%` : "pending"}`,
      );
      console.log(
        `  Last Check:       ${s.weather_arb.lastCheckAt ?? "never"}`,
      );
      return;
    }

    const action = sub;
    const target = args[2];

    if (action === "stop") {
      if (target === "pumpfun") {
        strategyManager.stopPumpfun();
        console.log("Pumpfun scanner signal: STOPPED");
      } else if (target === "weather-arb") {
        strategyManager.stopWeatherArb();
        console.log("Weather arb scanner signal: STOPPED");
      }
      return;
    }

    if (action === "start") {
      const walletName = args[3];
      if (target === "pumpfun") {
        strategyManager.startPumpfun({
          walletName,
          intervalSeconds: parseInt(opt("interval") ?? "300"),
          strategy: "3x",
          maxRiskPercent: parseFloat(opt("max-risk") ?? "5"),
          dryRun: flag("dry-run"),
        });
        console.log(`Started Pumpfun scanner for ${walletName}`);
      } else if (target === "weather-arb") {
        const office = opt("office");
        const gridX = opt("grid-x");
        const gridY = opt("grid-y");
        const threshold = opt("threshold");
        const series = opt("series");
        const amount = opt("amount");

        if (
          !walletName ||
          !office ||
          !gridX ||
          !gridY ||
          !threshold ||
          !series ||
          !amount
        ) {
          console.error(
            "Error: Missing required parameters for weather-arb scanner.",
          );
          process.exit(1);
        }

        strategyManager.startWeatherArb({
          walletName,
          gridpointOffice: office,
          gridX: parseInt(gridX),
          gridY: parseInt(gridY),
          tempThresholdF: parseFloat(threshold),
          kalshiSeriesTicker: series,
          tradeAmountUsdc: parseFloat(amount),
          minConfidence: 0.9,
          maxMarketOdds: 0.4,
          intervalSeconds: parseInt(opt("interval") ?? "120"),
          dryRun: flag("dry-run"),
        });
        console.log(
          `Started Weather Arb (Kalshi/DFlow) scanner for ${walletName}`,
        );
      }
      return;
    }
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
};

run().catch((err) => {
  console.error(
    "\nFatal error:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
