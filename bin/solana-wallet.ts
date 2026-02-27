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
import { raydiumSwap, solToLamports, SOL_MINT } from "../src/swap.ts";
import { findHighPotentialPairs } from "../src/screener.ts";
import { strategyManager } from "../src/strategyManager.ts";
import { createEvmWallet, listEvmWallets } from "../src/evmWallet.ts";
import { getEvmBalance, getTokenBalance } from "../src/evmBalance.ts";

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
  evm-wallet create <name>
  evm-wallet list
  balance <wallet-name>
  transfer sol <wallet> <to-address> <amount>
  transfer spl <wallet> <to-address> <mint> <amount>
  swap <wallet> SOL <output-mint> <amount>
  find-pairs
  scanner start polymarket-weather <evm-wallet-name>
                --cities nyc,london,seoul,chicago,dallas,miami,paris,toronto,seattle
                --amount <usdc-per-trade>  [--max-position <usdc>]
                [--min-edge 0.20]          [--min-fair-value 0.40]
                [--interval <seconds>]     [--dry-run]
  scanner stop
  scanner status   (alias: status)`);
    return;
  }

  // --- Wallet / Balance / Transfer ---
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
    console.log(
      JSON.stringify(
        r,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
    return;
  }

  if (cmd === "transfer") {
    if (sub === "sol") {
      const r = await transferSOL(args[2], args[3], parseFloat(args[4]));
      console.log(JSON.stringify(r));
      return;
    }
    if (sub === "spl") {
      const r = await transferSPL(
        args[2],
        args[3],
        args[4],
        parseFloat(args[5]),
      );
      console.log(JSON.stringify(r));
      return;
    }
  }

  if (cmd === "swap") {
    const r = await raydiumSwap(
      sub,
      SOL_MINT,
      args[3],
      solToLamports(parseFloat(args[4])),
      300,
      undefined,
      1,  // direct route only for manual swaps
    );
    console.log(JSON.stringify(r));
    return;
  }

  if (cmd === "find-pairs") {
    const r = await findHighPotentialPairs();
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  // --- EVM Wallet ---
  if (cmd === "evm-wallet") {
    if (sub === "create") {
      const r = await createEvmWallet(args[2]);
      console.log(JSON.stringify(r));
      return;
    }
    if (sub === "list") {
      const r = await listEvmWallets();
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (sub === "balance") {
      const walletName = args[2];
      if (!walletName) {
        console.error("Usage: evm-wallet balance <wallet-name> [--token <address>]");
        process.exit(1);
      }
      const tokenAddr = opt("token");
      
      if (tokenAddr) {
        const r = await getTokenBalance(walletName, tokenAddr);
        console.log(JSON.stringify(r, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
      } else {
        const r = await getEvmBalance(walletName);
        console.log(JSON.stringify(r, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
      }
      return;
    }
  }

  // --- Scanner Management ---
  if (cmd === "scanner") {
    // ── start polymarket-weather ──────────────────────────────────────────────
    if (sub === "start" && args[2] === "polymarket-weather") {
      const walletName = args[3];
      const amount = opt("amount");

      if (!walletName || !amount) {
        console.error("Usage: scanner start polymarket-weather <evm-wallet> --amount <usdc> [--cities nyc,london,...] [--dry-run]");
        process.exit(1);
      }

      // Kill any existing daemon
      const existingPid = readDaemonPid();
      if (existingPid !== null && isPidAlive(existingPid)) {
        console.log(`Stopping existing daemon (PID ${existingPid})...`);
        process.kill(existingPid, "SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
      }

      try { fs.mkdirSync(RAPHAEL_DATA_DIR, { recursive: true }); } catch {}
      const logPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.log");
      const logFd = fs.openSync(logPath, "a");

      const child = spawn(
        process.execPath,
        ["--experimental-transform-types", __filename, "__daemon_weather", walletName, ...args.slice(4)],
        { detached: true, stdio: ["ignore", logFd, logFd], env: { ...process.env, RAPHAEL_DATA_DIR } },
      );
      fs.closeSync(logFd);
      child.unref();

      const cities = (opt("cities") ?? "nyc,london,seoul,chicago,dallas,miami,paris,toronto,seattle").split(",");
      console.log(`✅ Polymarket Weather Arb started in background.`);
      console.log(`   Wallet:      ${walletName}`);
      console.log(`   Cities:      ${cities.join(", ")}`);
      console.log(`   Amount:      $${amount} USDC per trade`);
      console.log(`   Max pos:     $${opt("max-position") ?? "10"} USDC per bracket`);
      console.log(`   Min edge:    ${opt("min-edge") ?? "0.20"}`);
      console.log(`   Dry-run:     ${flag("dry-run")}`);
      console.log(`   Log:         ${logPath}`);
      console.log(`   PID:         ${child.pid}`);
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
      try { fs.unlinkSync(strategyManager.STATUS_FILE); } catch {}
      try { fs.unlinkSync(strategyManager.PID_FILE); } catch {}
      console.log("Scanner stopped.");
      return;
    }

    if (sub !== "status") {
      console.log("Unknown scanner subcommand. Use: start polymarket-weather | stop | status");
      return;
    }
  }

  // --- Status ---
  if (cmd === "status" || (cmd === "scanner" && sub === "status")) {
    const s = strategyManager.getStatus();
    const logPath = path.join(RAPHAEL_DATA_DIR, "weather-arb.log");
    const pid = readDaemonPid();

    console.log(`\n── Status Check ────────────────────────`);
    console.log(`Polymarket Weather Arb: ${s.weather_arb.running ? "✅ RUNNING" : "❌ STOPPED"}`);
    if (s.weather_arb.running) {
      console.log(`  Cities:     ${s.weather_arb.cities.join(", ") || "?"}`);
      console.log(`  Last check: ${s.weather_arb.lastCheckAt ?? "never"}`);
      for (const r of s.weather_arb.lastReadings) {
        const edgeStr = r.bestEdge != null ? ` edge=${Math.round(r.bestEdge * 100)}%` : ""
        const bracketStr = r.targetBracket ? ` bracket="${r.targetBracket}"` : ""
        const skipStr = r.skippedReason ? ` (${r.skippedReason})` : ""
        console.log(`  ${r.city.padEnd(8)}: ${r.forecastHighF}°F${bracketStr}${edgeStr}${skipStr}`)
      }
    }
    if (pid !== null) console.log(`  PID:        ${pid} (${isPidAlive(pid) ? "alive" : "dead"})`);
    if (fs.existsSync(logPath)) console.log(`  Log:        ${logPath}`);
    if (s._source) console.log(`  Source:     ${s._source}`);
    if (s._stale)  console.log(`  ⚠  Status data is stale (>10 min old)`);
    return;
  }

  // --- Hidden Background Daemon Loop ---
  if (cmd === "__daemon_weather") {
    const walletName = sub;
    const amount = opt("amount");
    if (!walletName || !amount) {
      console.error("[daemon] Missing required parameters. Exiting.");
      process.exit(1);
    }

    const cities = (opt("cities") ?? "nyc,london,seoul,chicago,dallas,miami,paris,toronto,seattle").split(",");
    console.log(`[daemon] Starting Polymarket Weather Arb at ${new Date().toISOString()}`);
    console.log(`[daemon] wallet=${walletName} cities=${cities.join(",")} amount=${amount} dry-run=${flag("dry-run")}`);

    strategyManager.startWeatherArb({
      walletName,
      cities,
      tradeAmountUsdc:  parseFloat(amount),
      maxPositionUsdc:  parseFloat(opt("max-position") ?? "10"),
      minEdge:          parseFloat(opt("min-edge")       ?? "0.20"),
      minFairValue:     parseFloat(opt("min-fair-value") ?? "0.40"),
      intervalSeconds:  parseInt(opt("interval")         ?? "120"),
      dryRun:           flag("dry-run"),
    });

    await new Promise(() => {});
  }

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
