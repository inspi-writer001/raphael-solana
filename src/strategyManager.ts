import fs from "fs";
import path from "path";
import os from "os";
import type {
  StrategyStatus,
  WeatherArbConfig,
  WeatherArbReading,
} from "./types.ts";
import { runWeatherArbTick } from "./weatherArb.ts";

// Shared file for Inter-Process Communication (IPC)
const STATUS_FILE = path.join(os.homedir(), ".solana-agent-status.json");

// const STATUS_FILE = "/root/raphael-solana/.solana-agent-status.json";

export const createStrategyManager = () => {
  let weatherArbIntervalId: NodeJS.Timeout | null = null;
  let weatherArbConfig: WeatherArbConfig | null = null;
  let weatherArbLastReading: WeatherArbReading | null = null;

  // ── Persistence Logic ──────────────────────────────────────────────────────

  const saveStatusToDisk = () => {
    const status = getStatus(true); // Get current live RAM state
    try {
      fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
    } catch (e) {
      // Silent fail to avoid crashing the trading loop
    }
  };

  const getStatus = (forceLive = false): StrategyStatus => {
    // If we are Process B (the status checker), read from the shared file
    if (!forceLive && fs.existsSync(STATUS_FILE)) {
      try {
        const fileData = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
        // Check if file is stale (older than 10 mins)
        const stats = fs.statSync(STATUS_FILE);
        const ageMs = Date.now() - stats.mtimeMs;

        return {
          ...fileData,
          // Optional: mark as STALE if ageMs > 600000
        };
      } catch (e) {
        /* fallback to RAM */
      }
    }

    // Default RAM state (used by the actual scanner process)
    return {
      pumpfun: {
        running: false, // Update if you implement pumpfun loop here
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
    };
  };

  // ── Scanner Logic ─────────────────────────────────────────────────────────

  const startWeatherArb = (config: WeatherArbConfig) => {
    weatherArbConfig = config;

    const onReading = (r: WeatherArbReading) => {
      weatherArbLastReading = r;
      saveStatusToDisk();
    };

    // Initial persist to show "RUNNING" immediately, then fire first tick
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
