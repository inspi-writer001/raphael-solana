#!/usr/bin/env tsx
import "dotenv/config";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createWallet, listWallets } from "../src/wallet.ts";
import { getPortfolioSummary } from "../src/balance.ts";
import { transferSOL, transferSPL } from "../src/transfer.ts";
import { jupiterSwap, solToLamports, SOL_MINT } from "../src/swap.ts";
import { findHighPotentialPairs } from "../src/screener.ts";
import { threeXStrategy } from "../src/strategy.ts";
import { strategyManager } from "../src/strategyManager.ts";

// ESM equivalent of __filename
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

  // --- Keep your existing wallet/balance/transfer logic here ---
  if (cmd === "wallet") {
    if (sub === "create")
      out(await createWallet(args[2], opt("network") as any));
    if (sub === "list") out(await listWallets());
    return;
  }
  if (cmd === "balance") {
    out(await getPortfolioSummary(sub));
    return;
  }

  // --- SCANNER MANAGEMENT ---
  if (cmd === "scanner") {
    if (sub === "status") {
      const s = strategyManager.getStatus();
      console.log(`\n── Status Check ────────────────────────`);
      console.log(
        `Weather Arb: ${s.weather_arb.running ? "✅ RUNNING" : "❌ STOPPED"}`,
      );
      if (s.weather_arb.running) {
        console.log(`  City:       ${s.weather_arb.city}`);
        console.log(`  Current:    ${s.weather_arb.lastNoaaTemp ?? "?"}°F`);
        console.log(
          `  Market:     ${s.weather_arb.lastMarketOdds ? (s.weather_arb.lastMarketOdds * 100).toFixed(0) + "%" : "?"}`,
        );
      }
      return;
    }

    if (sub === "stop") {
      spawn("pkill", ["-f", "__daemon_weather"]);
      console.log("Stop signal sent.");
      return;
    }

    if (sub === "start" && args[2] === "weather-arb") {
      // THE FIX: Spawn using the ESM-safe path
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

  // --- THE HIDDEN DAEMON ---
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

const out = (data: unknown) =>
  console.log(
    JSON.stringify(
      data,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );

run().catch(console.error);
