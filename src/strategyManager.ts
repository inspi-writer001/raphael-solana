import fs from "fs";
import path from "path";
import os from "os";
import type {
  StrategyStatus,
  WeatherArbConfig,
  WeatherArbReading,
} from "./types.ts";
import { runWeatherArbTick } from "./weatherArb.ts";

// ── Deterministic IPC paths ──────────────────────────────────────────────────
// All processes (CLI, daemon, OpenClaw gateway, subagents) MUST resolve to the
// same file regardless of $HOME, cwd, or user. Override via env var for custom
// setups (Docker, NixOS, multiple instances).

const RAPHAEL_DATA_DIR =
  process.env["RAPHAEL_DATA_DIR"] ?? path.join(os.homedir(), ".raphael");

// Ensure the directory exists on first import
try { fs.mkdirSync(RAPHAEL_DATA_DIR, { recursive: true }); } catch {}

export const STATUS_FILE = path.join(RAPHAEL_DATA_DIR, "scanner-status.json");
export const PID_FILE    = path.join(RAPHAEL_DATA_DIR, "weather-arb.pid");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Atomic write: write to .tmp then rename to avoid partial reads */
const atomicWriteJSON = (filePath: string, data: unknown): void => {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
};

/** Check if a PID is actually alive */
const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch {
    return false;
  }
};

/** Read the daemon PID file (plain integer string) and check liveness */
const isDaemonRunning = (): boolean => {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return false;
    return isPidAlive(pid);
  } catch {
    return false;
  }
};

// ── Strategy Manager ─────────────────────────────────────────────────────────

export const createStrategyManager = () => {
  let weatherArbIntervalId: NodeJS.Timeout | null = null;
  let weatherArbConfig: WeatherArbConfig | null = null;
  let weatherArbLastReading: WeatherArbReading | null = null;

  // Are we the daemon process? (set to true once startWeatherArb is called)
  let isOwnerProcess = false;

  // ── Persistence Logic ────────────────────────────────────────────────────

  const saveStatusToDisk = () => {
    const status = buildLiveStatus();
    try {
      atomicWriteJSON(STATUS_FILE, status);
    } catch (e) {
      console.error(`[strategyManager] Failed to write status file: ${e}`);
    }
  };

  const writePidFile = () => {
    try {
      fs.writeFileSync(PID_FILE, String(process.pid));
    } catch (e) {
      console.error(`[strategyManager] Failed to write PID file: ${e}`);
    }
  };

  const cleanupPidFile = () => {
    try { fs.unlinkSync(PID_FILE); } catch {}
  };

  // ── Status Logic ─────────────────────────────────────────────────────────

  /** Build status from in-process RAM (only meaningful in the daemon) */
  const buildLiveStatus = (): StrategyStatus => ({
    pumpfun: {
      running: false,
      lastGraduations: 0,
      lastCheckAt: null,
    },
    weather_arb: {
      running: weatherArbIntervalId !== null,
      city: weatherArbConfig?.gridpointOffice ?? null,
      lastNoaaTemp: weatherArbLastReading?.noaaForecast.forecastHighF ?? null,
      lastMarketOdds: weatherArbLastReading?.kalshiImpliedOdds ?? null,
      lastConfidence: weatherArbLastReading?.confidence ?? null,
      lastCheckAt: weatherArbLastReading
        ? new Date(weatherArbLastReading.fetchedAt).toISOString()
        : null,
    },
  });

  /**
   * Get scanner status.
   *
   * If this process owns the scanner (daemon), return live RAM state.
   * Otherwise, read from the shared IPC file and cross-check with the PID
   * file to detect zombie/crashed daemons.
   */
  const getStatus = (
    forceLive = false,
  ): StrategyStatus & { _stale?: boolean; _source?: string } => {
    // If we ARE the daemon, always return live RAM
    if (forceLive || isOwnerProcess) {
      return { ...buildLiveStatus(), _source: "live" };
    }

    // Cross-process: read from file
    if (fs.existsSync(STATUS_FILE)) {
      try {
        const fileData = JSON.parse(
          fs.readFileSync(STATUS_FILE, "utf-8"),
        ) as StrategyStatus;

        const stats = fs.statSync(STATUS_FILE);
        const ageMs = Date.now() - stats.mtimeMs;
        const staleThresholdMs = 10 * 60 * 1000; // 10 minutes

        // Cross-check: file says running, but is the daemon actually alive?
        if (fileData.weather_arb.running) {
          const daemonAlive = isDaemonRunning();

          if (!daemonAlive) {
            // Daemon crashed — file is lying. Clean up and report stopped.
            console.warn(
              "[strategyManager] Status file says RUNNING but daemon PID is dead. Cleaning up.",
            );
            try { fs.unlinkSync(STATUS_FILE); } catch {}
            try { fs.unlinkSync(PID_FILE); } catch {}
            return {
              ...buildLiveStatus(), // all defaults (stopped)
              _source: "dead_daemon_cleanup",
            };
          }
        }

        return {
          ...fileData,
          _stale: ageMs > staleThresholdMs,
          _source: "file",
        };
      } catch {
        // Corrupted file — fall through to defaults
      }
    }

    // No file, no daemon — return defaults
    return { ...buildLiveStatus(), _source: "default" };
  };

  // ── Scanner Logic ────────────────────────────────────────────────────────

  const startWeatherArb = (config: WeatherArbConfig) => {
    // Mark this process as the owner
    isOwnerProcess = true;
    weatherArbConfig = config;

    const onReading = (r: WeatherArbReading) => {
      weatherArbLastReading = r;
      saveStatusToDisk();
    };

    // Write PID file so status checkers can verify we're alive
    writePidFile();

    // Initial persist to show "RUNNING" immediately, then fire first tick
    saveStatusToDisk();
    runWeatherArbTick(config, onReading).catch(console.error);

    weatherArbIntervalId = setInterval(
      () => {
        runWeatherArbTick(config, onReading).catch(console.error);
      },
      (config.intervalSeconds || 120) * 1000,
    );

    // Cleanup on process exit (SIGTERM from pkill, Ctrl+C, etc.)
    const cleanup = () => {
      if (weatherArbIntervalId) {
        clearInterval(weatherArbIntervalId);
        weatherArbIntervalId = null;
      }
      saveStatusToDisk(); // weatherArbIntervalId is now null → running: false
      cleanupPidFile();
    };

    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("SIGINT",  () => { cleanup(); process.exit(0); });
    process.on("exit", cleanup);
  };

  const stopWeatherArb = () => {
    if (weatherArbIntervalId) {
      clearInterval(weatherArbIntervalId);
      weatherArbIntervalId = null;
      saveStatusToDisk();
      cleanupPidFile();
    }
  };

  return {
    startWeatherArb,
    stopWeatherArb,
    getStatus,
    // Expose paths for the CLI stop/status commands
    STATUS_FILE,
    PID_FILE,
  };
};

export const strategyManager = createStrategyManager();
