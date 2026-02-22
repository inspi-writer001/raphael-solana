#!/usr/bin/env tsx
import "dotenv/config";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createWallet, listWallets } from "../src/wallet.ts";
import { getPortfolioSummary } from "../src/balance.ts";
import { transferSOL, transferSPL } from "../src/transfer.ts";
import { jupiterSwap, solToLamports, SOL_MINT } from "../src/swap.ts";
import { findHighPotentialPairs } from "../src/screener.ts";
import { strategyManager } from "../src/strategyManager.ts";

// ESM equivalent of __filename to fix the crash
const __filename = fileURLToPath(import.meta.url);

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

const flag = (name: string): boolean => args.includes(`--${name}`);

const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const run = async () => {
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log("Usage: solana-wallet <command> [options]");
    return;
  }

  // --- Wallet/Balance/Transfer (Original Logic) ---
  if (cmd === "wallet") {
    if (sub === "create") {
      const r = await createWallet(
        args[2],
        (opt("network") ?? "devnet") as any,
      );
      console.log(JSON.stringify(r));
      return;
    }
    if (sub === "list") {
      const r = await listWallets();
      console.log(JSON.stringify(r));
      return;
    }
  }

  if (cmd === "balance") {
    const r = await getPortfolioSummary(sub);
    console.log(JSON.stringify(r));
    return;
  }

  // --- Scanner Management ---
  if (cmd === "scanner") {
    if (sub === "status") {
      const s = strategyManager.getStatus();
      console.log(`\n── Status Check ────────────────────────`);
      console.log(
        `Weather Arb: ${s.weather_arb.running ? "✅ RUNNING" : "❌ STOPPED"}`,
      );
      if (s.weather_arb.running) {
        console.log(`  City:       ${s.weather_arb.city ?? "OKX"}`);
        console.log(`  Current:    ${s.weather_arb.lastNoaaTemp ?? "?"}°F`);
        console.log(
          `  Odds:       ${s.weather_arb.lastMarketOdds ? Math.round(s.weather_arb.lastMarketOdds * 100) + "%" : "?"}`,
        );
      }
      return;
    }

    if (sub === "stop") {
      spawn("pkill", ["-f", "__daemon_weather"]);
      console.log(`Stopping weather-arb scanner...`);
      return;
    }

    if (sub === "start" && args[2] === "weather-arb") {
      // THE FIX: Use tsx directly on this file via the ESM-safe __filename
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
        `✅ Weather Arb scanner started in background for ${args[3]}.`,
      );
      process.exit(0);
    }
  }

  // --- The Hidden Background Loop ---
  if (cmd === "__daemon_weather") {
    // Ensure we are using the correct param names for strategyManager
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

    // This keeps the process alive forever
    await new Promise(() => {});
  }
};

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
