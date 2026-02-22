import { startPumpListener } from "./screener.ts"
import { runPumpfunTick } from "./agent.ts"
import { runWeatherArbTick } from "./weatherArb.ts"
import type {
  AgentConfig,
  AgentState,
  WeatherArbConfig,
  WeatherArbReading,
  StrategyStatus,
} from "./types.ts"

const createStrategyManager = () => {
  // ── Pumpfun state ──────────────────────────────────────────────────────────
  let pumpfunIntervalId: NodeJS.Timeout | null = null
  let pumpfunState: AgentState = { openPositions: [], tradeHistory: [], lastRunAt: null }
  let pumpfunLastGraduations = 0

  // ── Weather Arb state ──────────────────────────────────────────────────────
  let weatherArbIntervalId: NodeJS.Timeout | null = null
  let weatherArbConfig: WeatherArbConfig | null = null
  let weatherArbLastReading: WeatherArbReading | null = null

  // ── Pumpfun controls ───────────────────────────────────────────────────────
  const startPumpfun = (config: AgentConfig): void => {
    if (pumpfunIntervalId !== null) return  // already running
    pumpfunState = { openPositions: [], tradeHistory: [], lastRunAt: null }
    startPumpListener(() => { pumpfunLastGraduations++ })
    pumpfunIntervalId = setInterval(() => {
      runPumpfunTick(config, pumpfunState)
        .then((s) => { pumpfunState = s })
        .catch(console.error)
    }, config.intervalSeconds * 1000)
  }

  const stopPumpfun = (): void => {
    if (pumpfunIntervalId === null) return
    clearInterval(pumpfunIntervalId)
    pumpfunIntervalId = null
  }

  // ── Weather Arb controls ───────────────────────────────────────────────────
  const startWeatherArb = (config: WeatherArbConfig): void => {
    if (weatherArbIntervalId !== null) return
    weatherArbConfig = config
    const onReading = (r: WeatherArbReading) => { weatherArbLastReading = r }
    // Run once immediately, then every intervalSeconds
    runWeatherArbTick(config, onReading).catch(console.error)
    weatherArbIntervalId = setInterval(() => {
      runWeatherArbTick(config, onReading).catch(console.error)
    }, config.intervalSeconds * 1000)
  }

  const stopWeatherArb = (): void => {
    if (weatherArbIntervalId === null) return
    clearInterval(weatherArbIntervalId)
    weatherArbIntervalId = null
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  const getStatus = (): StrategyStatus => ({
    pumpfun: {
      running: pumpfunIntervalId !== null,
      lastGraduations: pumpfunLastGraduations,
      lastCheckAt: pumpfunState.lastRunAt,
    },
    weather_arb: {
      running: weatherArbIntervalId !== null,
      lastNoaaTemp: weatherArbLastReading?.noaaForecast.forecastHighF ?? null,
      lastJupiterOdds: weatherArbLastReading?.jupiterImpliedOdds ?? null,
      lastConfidence: weatherArbLastReading?.confidence ?? null,
      lastCheckAt: weatherArbLastReading
        ? new Date(weatherArbLastReading.fetchedAt).toISOString()
        : null,
      city: weatherArbConfig?.gridpointOffice ?? null,
    },
  })

  return { startPumpfun, stopPumpfun, startWeatherArb, stopWeatherArb, getStatus }
}

// Singleton — shared by plugin.ts and CLI
export const strategyManager = createStrategyManager()
