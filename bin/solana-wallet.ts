#!/usr/bin/env tsx
import "dotenv/config";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createWallet, listWallets } from "../src/wallet.ts";
import { getPortfolioSummary } from "../src/balance.ts";
import { transferSOL, transferSPL } from "../src/transfer.ts";
import { jupiterSwap, solToLamports, SOL_MINT } from "../src/swap.ts";
import { findHighPotentialPairs } from "../src/screener.ts";
import { strategyManager, ensureDataDir, STATUS_FILE, PID_FILE } from "../src/strategyManager.ts";
import { RAPHAEL_DATA_DIR } from "../src/environment.ts";

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

// ── Daemon helpers ───────────────────────────────────────────────────────────

/** Prefer project-local tsx binary; fall back to PATH */
const findTsx = (): string => {
  const local = path.join(path.dirname(__filename), "..", "node_modules", ".bin", "tsx");
  return fs.existsSync(local) ? local : "tsx";
};

/** Read PID from the PID file, returns null if missing/invalid */
const readDaemonPid = (): number | null => {
  try {
    const data = JSON.parse(fs.readFileSync(PID_FILE, "utf-8")) as { pid?: unknown };
    return typeof data.pid === "number" ? data.pid : null;
  } catch {
    return null;
  }
};

// ── Main ─────────────────────────────────────────────────────────────────────

const run = async () => {
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log("Usage: solana-wallet <command> [options]");
    return;
  }

  // --- Wallet/Balance/Transfer ---
  if (cmd === "wallet") {
    if (sub === "create") {
      const r = await createWallet(args[2], (opt("network") ?? "devnet") as any);
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
    // ── status ──────────────────────────────────────────────────────────────
    if (sub === "status") {
      const s = strategyManager.getStatus();
      const logPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.log");

      console.log(`\n── Status Check ────────────────────────`);
      if (s._source) {
        const staleTag = s._stale ? " ⚠ stale" : "";
        console.log(`  Source:     ${s._source}${staleTag}`);
      }
      console.log(
        `Weather Arb: ${s.weather_arb.running ? "✅ RUNNING" : "❌ STOPPED"}`,
      );
      if (s.weather_arb.running) {
        console.log(`  City:       ${s.weather_arb.city ?? "OKX"}`);
        console.log(`  Current:    ${s.weather_arb.lastNoaaTemp ?? "?"}°F`);
        console.log(
          `  Odds:       ${s.weather_arb.lastMarketOdds != null ? Math.round(s.weather_arb.lastMarketOdds * 100) + "%" : "?"}`,
        );
        if (
          s.weather_arb.lastConfidence != null &&
          s.weather_arb.lastMarketOdds != null
        ) {
          const edge = s.weather_arb.lastConfidence - s.weather_arb.lastMarketOdds;
          console.log(`  Edge:       ${Math.round(edge * 100)}%`);
        }
      }
      if (fs.existsSync(logPath)) {
        console.log(`  Log:        ${logPath}`);
      }
      return;
    }

    // ── stop ─────────────────────────────────────────────────────────────────
    if (sub === "stop") {
      const existingPid = readDaemonPid();
      if (existingPid !== null) {
        try { process.kill(existingPid, "SIGTERM"); } catch {}
      } else {
        spawn("pkill", ["-f", "__daemon_weather"]);
      }
      // Remove stale IPC files
      try { fs.unlinkSync(STATUS_FILE); } catch {}
      try { fs.unlinkSync(PID_FILE); } catch {}
      console.log(`Stopping weather-arb scanner...`);
      return;
    }

    // ── start weather-arb ────────────────────────────────────────────────────
    if (sub === "start" && args[2] === "weather-arb") {
      // Kill any existing daemon
      const existingPid = readDaemonPid();
      if (existingPid !== null) {
        try {
          process.kill(existingPid, "SIGTERM");
          await new Promise((r) => setTimeout(r, 500));
        } catch {}
      }

      // Prepare log file
      ensureDataDir();
      const logPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.log");
      const logFd = fs.openSync(logPath, "a");

      const child = spawn(
        findTsx(),
        [__filename, "__daemon_weather", ...args.slice(3)],
        {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, RAPHAEL_DATA_DIR },
        },
      );
      fs.closeSync(logFd);
      child.unref();

      console.log(`✅ Weather Arb scanner started in background for ${args[3]}.`);
      console.log(`   Log: ${logPath}`);
      process.exit(0);
    }
  }

  // --- Hidden Background Daemon Loop ---
  if (cmd === "__daemon_weather") {
    const walletName = sub;
    const office = opt("office");
    const gridX = opt("grid-x");
    const gridY = opt("grid-y");
    const threshold = opt("threshold");
    const series = opt("series");
    const amount = opt("amount");

    if (!walletName || !office || !gridX || !gridY || !threshold || !series || !amount) {
      console.error(
        "Error: __daemon_weather requires: <wallet> --office --grid-x --grid-y --threshold --series --amount",
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
      minConfidence: parseFloat(opt("min-confidence") ?? "0.9"),
      maxMarketOdds: parseFloat(opt("max-market-odds") ?? "0.4"),
      intervalSeconds: parseInt(opt("interval") ?? "120"),
      dryRun: flag("dry-run"),
    });

    // Keep process alive — signal handlers in startWeatherArb handle shutdown
    await new Promise(() => {});
  }
};

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
