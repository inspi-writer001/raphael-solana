import fs from "fs";
import path from "path";
import type {
  StrategyStatus,
  WeatherArbConfig,
  WeatherArbReading,
} from "./types.ts";
import { runWeatherArbTick } from "./weatherArb.ts";
import { RAPHAEL_DATA_DIR } from "./environment.ts";

// IPC file paths — all under RAPHAEL_DATA_DIR so daemon and CLI agree
export const STATUS_FILE = path.join(RAPHAEL_DATA_DIR, "scanner-status.json");
export const PID_FILE = path.join(RAPHAEL_DATA_DIR, "weather-arb.pid");

// ── Module-level helpers ────────────────────────────────────────────────────

export const ensureDataDir = () =>
  fs.mkdirSync(RAPHAEL_DATA_DIR, { recursive: true });

const atomicWriteJSON = (filePath: string, data: unknown) => {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isDaemonRunning = (): boolean => {
  try {
    const data = JSON.parse(fs.readFileSync(PID_FILE, "utf-8")) as { pid?: unknown };
    return typeof data.pid === "number" && isPidAlive(data.pid);
  } catch {
    return false;
  }
};

// ── Factory ─────────────────────────────────────────────────────────────────

export const createStrategyManager = () => {
  let weatherArbIntervalId: NodeJS.Timeout | null = null;
  let weatherArbConfig: WeatherArbConfig | null = null;
  let weatherArbLastReading: WeatherArbReading | null = null;
  let isOwnerProcess = false;

  // ── Live RAM state ──────────────────────────────────────────────────────

  const getLiveStatus = (): StrategyStatus => ({
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
    _source: "live",
  });

  // ── Persistence ─────────────────────────────────────────────────────────

  const saveStatusToDisk = () => {
    try {
      ensureDataDir();
      atomicWriteJSON(STATUS_FILE, getLiveStatus());
    } catch {
      // Silent fail — never crash the trading loop
    }
  };

  // ── getStatus: IPC-aware ─────────────────────────────────────────────────

  const getStatus = (): StrategyStatus => {
    // Daemon process returns live RAM state directly
    if (isOwnerProcess) {
      return getLiveStatus();
    }

    // CLI process reads from the shared status file
    if (fs.existsSync(STATUS_FILE)) {
      try {
        const fileData = JSON.parse(
          fs.readFileSync(STATUS_FILE, "utf-8"),
        ) as StrategyStatus;

        // File says running but daemon is gone → stale, clean up
        if (fileData.weather_arb.running && !isDaemonRunning()) {
          try { fs.unlinkSync(STATUS_FILE); } catch {}
          try { fs.unlinkSync(PID_FILE); } catch {}
          return {
            pumpfun: { running: false, lastGraduations: 0, lastCheckAt: null },
            weather_arb: {
              running: false,
              city: null,
              lastNoaaTemp: null,
              lastMarketOdds: null,
              lastConfidence: null,
              lastCheckAt: null,
            },
            _source: "file",
            _stale: true,
          };
        }

        return { ...fileData, _source: "file" };
      } catch {
        // fall through to default
      }
    }

    // No file — daemon has never started
    return {
      pumpfun: { running: false, lastGraduations: 0, lastCheckAt: null },
      weather_arb: {
        running: false,
        city: null,
        lastNoaaTemp: null,
        lastMarketOdds: null,
        lastConfidence: null,
        lastCheckAt: null,
      },
      _source: "default",
    };
  };

  // ── Scanner Logic ────────────────────────────────────────────────────────

  const startWeatherArb = (config: WeatherArbConfig) => {
    isOwnerProcess = true;
    ensureDataDir();
    atomicWriteJSON(PID_FILE, { pid: process.pid });

    weatherArbConfig = config;

    const cleanup = () => {
      if (weatherArbIntervalId) {
        clearInterval(weatherArbIntervalId);
        weatherArbIntervalId = null;
      }
      try { fs.unlinkSync(PID_FILE); } catch {}
      // weatherArbIntervalId is now null → getLiveStatus().weather_arb.running = false
      try { atomicWriteJSON(STATUS_FILE, getLiveStatus()); } catch {}
    };

    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("exit", cleanup);

    const onReading = (r: WeatherArbReading) => {
      weatherArbLastReading = r;
      saveStatusToDisk();
    };

    // Persist "RUNNING" immediately, then fire the first tick
    saveStatusToDisk();
    runWeatherArbTick(config, onReading).catch(console.error);

    weatherArbIntervalId = setInterval(
      () => {
        runWeatherArbTick(config, onReading).catch(console.error);
      },
      (config.intervalSeconds || 120) * 1000,
    );
  };

  const stopWeatherArb = () => {
    if (weatherArbIntervalId) {
      clearInterval(weatherArbIntervalId);
      weatherArbIntervalId = null;
      saveStatusToDisk();
    }
  };

  return {
    startWeatherArb,
    stopWeatherArb,
    getStatus,
  };
};

export const strategyManager = createStrategyManager();
