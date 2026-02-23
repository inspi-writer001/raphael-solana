#!/usr/bin/env tsx
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createWallet, listWallets } from "../src/wallet.ts";
import { getPortfolioSummary } from "../src/balance.ts";
import { transferSOL, transferSPL } from "../src/transfer.ts";
import { jupiterSwap, solToLamports, SOL_MINT } from "../src/swap.ts";
import { findHighPotentialPairs } from "../src/screener.ts";
import { strategyManager } from "../src/strategyManager.ts";

const __filename = fileURLToPath(import.meta.url);

// Resolve RAPHAEL_DATA_DIR consistently — same env var the daemon reads.
// Defined locally so this file doesn't import environment.ts (avoids cycles
// and makes the bin file self-contained for OpenClaw exec calls).
const RAPHAEL_DATA_DIR =
  process.env["RAPHAEL_DATA_DIR"] ?? path.join(os.homedir(), ".raphael");

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

const flag = (name: string): boolean => args.includes(`--${name}`);

const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

// ── Daemon helpers ───────────────────────────────────────────────────────────

/** Read daemon PID from plain-string PID file */
const readDaemonPid = (): number | null => {
  try {
    const pidPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.pid");
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ── Main ─────────────────────────────────────────────────────────────────────

const run = async () => {
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(`Usage: solana-wallet <command> [options]

Commands:
  wallet create <name> [--network devnet|mainnet-beta]
  wallet list
  balance <wallet-name>
  transfer sol <wallet> <to-address> <amount>
  transfer spl <wallet> <to-address> <mint> <amount>
  swap <wallet> SOL <output-mint> <amount>
  find-pairs
  trade <wallet> --strategy 3x [--dry-run]
  scanner start weather-arb <wallet> --office <code> --grid-x <n> --grid-y <n>
                            --threshold <f> --series <ticker> --amount <n> [--dry-run]
  scanner stop
  scanner status   (alias: status)
  agent <wallet> --interval <s> [--dry-run]`);
    return;
  }

  // --- Wallet / Balance / Transfer ---
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

  if (cmd === "transfer") {
    if (sub === "sol") {
      const r = await transferSOL(args[2], args[3], parseFloat(args[4]));
      console.log(JSON.stringify(r));
      return;
    }
    if (sub === "spl") {
      const r = await transferSPL(args[2], args[3], args[4], parseFloat(args[5]));
      console.log(JSON.stringify(r));
      return;
    }
  }

  if (cmd === "swap") {
    const r = await jupiterSwap(
      sub,
      SOL_MINT,
      args[3],
      solToLamports(parseFloat(args[4])),
    );
    console.log(JSON.stringify(r));
    return;
  }

  if (cmd === "find-pairs") {
    const r = await findHighPotentialPairs();
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  // --- Scanner Management ---
  if (cmd === "scanner") {
    // ── start weather-arb ────────────────────────────────────────────────────
    if (sub === "start" && args[2] === "weather-arb") {
      const walletName = args[3];
      const office    = opt("office");
      const gridX     = opt("grid-x");
      const gridY     = opt("grid-y");
      const threshold = opt("threshold");
      const series    = opt("series");
      const amount    = opt("amount");

      if (!walletName || !office || !gridX || !gridY || !threshold || !series || !amount) {
        console.error("Missing required params. Usage:");
        console.error(
          "  scanner start weather-arb <wallet> --office OKX --grid-x 33 --grid-y 35 --threshold 50 --series KXHIGHNY --amount 10 [--dry-run]",
        );
        process.exit(1);
      }

      // Kill any existing daemon
      const existingPid = readDaemonPid();
      if (existingPid !== null && isPidAlive(existingPid)) {
        console.log(`Stopping existing daemon (PID ${existingPid})...`);
        process.kill(existingPid, "SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
      }

      // Prepare log file
      try { fs.mkdirSync(RAPHAEL_DATA_DIR, { recursive: true }); } catch {}
      const logPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.log");
      const logFd   = fs.openSync(logPath, "a");

      const child = spawn(
        process.execPath,
        [
          "--experimental-transform-types",
          __filename,
          "__daemon_weather",
          walletName,
          ...args.slice(4),
        ],
        {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, RAPHAEL_DATA_DIR },
        },
      );
      fs.closeSync(logFd);
      child.unref();

      console.log(`✅ Weather Arb scanner started in background.`);
      console.log(`   Wallet:    ${walletName}`);
      console.log(`   Office:    ${office} (${gridX},${gridY})`);
      console.log(`   Threshold: ${threshold}°F`);
      console.log(`   Series:    ${series}`);
      console.log(`   Amount:    ${amount} USDC`);
      console.log(`   Dry-run:   ${flag("dry-run")}`);
      console.log(`   Log:       ${logPath}`);
      console.log(`   PID:       ${child.pid}`);
      process.exit(0);
    }

    // ── stop ─────────────────────────────────────────────────────────────────
    if (sub === "stop") {
      const pid = readDaemonPid();
      if (pid !== null && isPidAlive(pid)) {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to daemon (PID ${pid}).`);
      } else {
        spawn("pkill", ["-f", "__daemon_weather"]);
        console.log("No live PID found. Sent pkill -f __daemon_weather.");
      }
      // Remove stale IPC files
      try { fs.unlinkSync(strategyManager.STATUS_FILE); } catch {}
      try { fs.unlinkSync(strategyManager.PID_FILE); } catch {}
      console.log("Scanner stopped.");
      return;
    }

    // ── status (fall through) ─────────────────────────────────────────────
    if (sub !== "status") {
      console.log("Unknown scanner subcommand. Use: start weather-arb | stop | status");
      return;
    }
  }

  // --- Status (both `scanner status` and `status`) ---
  if (cmd === "status" || (cmd === "scanner" && sub === "status")) {
    const s = strategyManager.getStatus();
    const logPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.log");
    const pid     = readDaemonPid();

    console.log(`\n── Status Check ────────────────────────`);
    console.log(
      `Weather Arb: ${s.weather_arb.running ? "✅ RUNNING" : "❌ STOPPED"}`,
    );
    if (s.weather_arb.running) {
      console.log(`  City:       ${s.weather_arb.city ?? "?"}`);
      console.log(`  Temp:       ${s.weather_arb.lastNoaaTemp ?? "?"}°F`);
      console.log(
        `  Confidence: ${s.weather_arb.lastConfidence != null ? Math.round(s.weather_arb.lastConfidence * 100) + "%" : "?"}`,
      );
      console.log(
        `  Mkt Odds:   ${s.weather_arb.lastMarketOdds != null ? Math.round(s.weather_arb.lastMarketOdds * 100) + "%" : "?"}`,
      );
      if (s.weather_arb.lastConfidence != null && s.weather_arb.lastMarketOdds != null) {
        const edge = s.weather_arb.lastConfidence - s.weather_arb.lastMarketOdds;
        console.log(`  Edge:       ${Math.round(edge * 100)}%`);
      }
      console.log(`  Last check: ${s.weather_arb.lastCheckAt ?? "never"}`);
    }
    if (pid !== null) {
      console.log(`  PID:        ${pid} (${isPidAlive(pid) ? "alive" : "dead"})`);
    }
    if (fs.existsSync(logPath)) {
      console.log(`  Log:        ${logPath}`);
    }
    if (s._source) console.log(`  Source:     ${s._source}`);
    if (s._stale)  console.log(`  ⚠  Status data is stale (>10 min old)`);
    return;
  }

  // --- Hidden Background Daemon Loop ---
  if (cmd === "__daemon_weather") {
    const walletName = sub;
    const office    = opt("office");
    const gridX     = opt("grid-x");
    const gridY     = opt("grid-y");
    const threshold = opt("threshold");
    const series    = opt("series");
    const amount    = opt("amount");

    if (!walletName || !office || !gridX || !gridY || !threshold || !series || !amount) {
      console.error("[daemon] Missing required parameters. Exiting.");
      process.exit(1);
    }

    console.log(`[daemon] Starting weather arb scanner at ${new Date().toISOString()}`);
    console.log(
      `[daemon] Config: wallet=${walletName} office=${office} grid=${gridX},${gridY} threshold=${threshold}°F series=${series} amount=${amount} dry-run=${flag("dry-run")}`,
    );

    strategyManager.startWeatherArb({
      walletName,
      gridpointOffice: office,
      gridX: parseInt(gridX),
      gridY: parseInt(gridY),
      tempThresholdF: parseFloat(threshold),
      kalshiSeriesTicker: series,
      tradeAmountUsdc: parseFloat(amount),
      minConfidence: parseFloat(opt("min-confidence") ?? "0.9"),
      maxMarketOdds: parseFloat(opt("max-odds") ?? "0.4"),
      intervalSeconds: parseInt(opt("interval") ?? "120"),
      dryRun: flag("dry-run"),
    });

    // Keep alive — signal handlers in startWeatherArb handle shutdown
    await new Promise(() => {});
  }

  // --- Stubs (not yet implemented in this version) ---
  if (cmd === "agent" || cmd === "trade") {
    console.log(`${cmd} command not yet implemented in this version.`);
    return;
  }

  if (cmd !== "scanner" && cmd !== "status") {
    console.log(`Unknown command: ${cmd}. Run with --help for usage.`);
  }
};

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
