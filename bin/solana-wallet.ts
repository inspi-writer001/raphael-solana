#!/usr/bin/env tsx
import "dotenv/config";
import { spawn } from "child_process";
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
  scanner start weather-arb <wallet>
                --office <code> --grid-x <n> --grid-y <n>
                --threshold <F> --series <ticker> --amount <usdc>
                [--interval 120] [--dry-run]
  scanner stop  <pumpfun|weather-arb>
  scanner status

Internal:
  __daemon_weather <args> (Used to background the process for Zumari)
`);

// ── Command router ────────────────────────────────────────────────────────────

const run = async () => {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }

  // ── wallet / balance / transfer / swap / find-pairs / trade (Keep original logic) ──
  if (cmd === "wallet" && sub === "create") {
    const name = args[2];
    if (!name) {
      console.error("Error: wallet name required");
      process.exit(1);
    }
    const network = (opt("network") ?? "devnet") as "devnet" | "mainnet-beta";
    const result = await createWallet(name, network);
    out(result);
    return;
  }

  if (cmd === "wallet" && sub === "list") {
    const wallets = await listWallets();
    out(wallets);
    return;
  }

  if (cmd === "balance") {
    if (!sub) {
      console.error("Usage: solana-wallet balance <wallet-name>");
      process.exit(1);
    }
    out(await getPortfolioSummary(sub));
    return;
  }

  if (cmd === "transfer") {
    const [, , from, to, amountStr] = args;
    if (sub === "sol") {
      out(await transferSOL(from, to, parseFloat(amountStr)));
    } else if (sub === "spl") {
      out(await transferSPL(from, to, args[4], parseFloat(args[5])));
    }
    return;
  }

  if (cmd === "swap") {
    const [, walletName, inputRaw, outputRaw, amountStr] = args;
    const inputMint = inputRaw.toUpperCase() === "SOL" ? SOL_MINT : inputRaw;
    const outputMint = outputRaw.toUpperCase() === "SOL" ? SOL_MINT : outputRaw;
    out(
      await jupiterSwap(
        walletName,
        inputMint,
        outputMint,
        solToLamports(parseFloat(amountStr)),
      ),
    );
    return;
  }

  if (cmd === "find-pairs") {
    out(await findHighPotentialPairs(parseInt(opt("min-score") ?? "60")));
    return;
  }

  // ── scanner (Upgraded for Background Execution) ──────────────────────────

  if (cmd === "scanner") {
    if (sub === "status") {
      const s = strategyManager.getStatus();
      if (jsonMode) {
        out(s);
        return;
      }
      console.log(`\n── Status Check: ${new Date().toISOString()} ──`);
      console.log(
        `\n[Pumpfun Scanner]  Status: ${s.pumpfun.running ? "RUNNING" : "STOPPED"}`,
      );
      console.log(
        `[Weather Arb Scanner] Status: ${s.weather_arb.running ? "RUNNING" : "STOPPED"}`,
      );
      if (s.weather_arb.running) {
        console.log(
          `  Current NOAA: ${s.weather_arb.lastNoaaTemp ?? "?"}°F | Market: ${s.weather_arb.lastMarketOdds ? (s.weather_arb.lastMarketOdds * 100).toFixed(0) + "%" : "?"}`,
        );
      }
      return;
    }

    if (sub === "stop") {
      const target = args[2] === "weather-arb" ? "__daemon_weather" : "pumpfun";
      spawn("pkill", ["-f", target]);
      console.log(`Stopping ${args[2]} scanner...`);
      return;
    }

    if (sub === "start") {
      const target = args[2];
      const walletName = args[3];
      if (target === "weather-arb") {
        // DETACHED SPAWN: This starts the background loop and lets the CLI exit for Zumari
        const child = spawn(
          "tsx",
          [__filename, "__daemon_weather", ...args.slice(3)],
          {
            detached: true,
            stdio: "ignore",
          },
        );
        child.unref();
        console.log(
          `✅ Weather Arb scanner started in background for ${walletName}.`,
        );
        process.exit(0);
      }
    }
  }

  // ── Internal Daemon (The actual loop runner) ──────────────────────────────

  if (cmd === "__daemon_weather") {
    strategyManager.startWeatherArb({
      walletName: sub,
      gridpointOffice: opt("office")!,
      gridX: parseInt(opt("grid-x")!),
      gridY: parseInt(opt("grid-y")!),
      tempThresholdF: parseFloat(opt("threshold")!),
      kalshiSeriesTicker: opt("series")!,
      tradeAmountUsdc: parseFloat(opt("amount")!),
      minConfidence: 0.9,
      maxMarketOdds: 0.4,
      intervalSeconds: parseInt(opt("interval") ?? "120"),
      dryRun: flag("dry-run"),
    });
    // Keep internal process alive
    setInterval(() => {}, 1000 * 60 * 60);
  }
};

run().catch((err) => {
  console.error(
    "\nFatal error:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
