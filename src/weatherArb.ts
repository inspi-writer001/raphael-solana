import { jupiterQuote, jupiterSwap } from "./swap.ts"
import type { WeatherArbConfig, WeatherArbReading, NoaaForecast } from "./types.ts"

export const USDC_MAINNET_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

const NOAA_API = "https://api.weather.gov"

// ── NOAA Forecast ─────────────────────────────────────────────────────────────

export const fetchNoaaForecast = async (
  office: string,
  gridX: number,
  gridY: number,
): Promise<NoaaForecast> => {
  const url = `${NOAA_API}/gridpoints/${office}/${gridX},${gridY}/forecast`
  const res = await fetch(url, {
    headers: { "User-Agent": "raphael-solana/1.0" },
  })

  if (!res.ok) {
    throw new Error(`NOAA forecast failed (${res.status}): ${await res.text()}`)
  }

  const data = await res.json() as {
    properties?: {
      periods?: Array<{
        name?: string
        shortForecast?: string
        isDaytime?: boolean
        temperature?: number
        temperatureUnit?: string
      }>
    }
  }

  const periods = data.properties?.periods ?? []
  const daytimePeriod = periods.find(p => p.isDaytime === true) ?? periods[0]

  if (!daytimePeriod) {
    throw new Error("NOAA: no forecast periods returned")
  }

  // NOAA returns temperature in the unit specified by temperatureUnit (usually F)
  // If it ever returns Celsius, convert; for now assume F
  const tempF = Number(daytimePeriod.temperature ?? 0)

  return {
    forecastHighF: tempF,
    periodName: String(daytimePeriod.name ?? ""),
    shortForecast: String(daytimePeriod.shortForecast ?? ""),
    isDaytime: daytimePeriod.isDaytime ?? true,
    fetchedAt: Date.now(),
  }
}

// ── Confidence Model ──────────────────────────────────────────────────────────

export const calculateConfidence = (forecastHighF: number, thresholdF: number): number => {
  const delta = forecastHighF - thresholdF
  if (delta >= 5) return 0.95
  if (delta >= 0) return 0.70
  return 0.10
}

// ── Jupiter Implied Odds ──────────────────────────────────────────────────────

export const fetchJupiterImpliedOdds = async (
  yesTokenMint: string,
  tradeAmountUsdc: number,
): Promise<number> => {
  const quote = await jupiterQuote(
    USDC_MAINNET_MINT,
    yesTokenMint,
    tradeAmountUsdc * 1_000_000,
  )
  // Both USDC and Polymarket YES tokens use 6 decimals, so the ratio is unit-safe
  const inAmount = Number(quote.inAmount)
  const outAmount = Number(quote.outAmount)
  if (outAmount === 0) throw new Error("Jupiter: outAmount is zero")
  return inAmount / outAmount
}

// ── Combined Reading ──────────────────────────────────────────────────────────

export const buildWeatherArbReading = async (
  config: WeatherArbConfig,
): Promise<WeatherArbReading> => {
  const noaaForecast = await fetchNoaaForecast(
    config.gridpointOffice,
    config.gridX,
    config.gridY,
  )
  const confidence = calculateConfidence(noaaForecast.forecastHighF, config.tempThresholdF)
  const jupiterImpliedOdds = await fetchJupiterImpliedOdds(
    config.yesTokenMint,
    config.tradeAmountUsdc,
  )
  const edge = confidence - jupiterImpliedOdds
  const hasEdge =
    confidence >= config.minConfidence && jupiterImpliedOdds <= config.maxJupiterOdds

  return {
    noaaForecast,
    confidence,
    jupiterImpliedOdds,
    edge,
    hasEdge,
    fetchedAt: Date.now(),
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export const runWeatherArbTick = async (
  config: WeatherArbConfig,
  onReading: (reading: WeatherArbReading) => void,
): Promise<void> => {
  try {
    const reading = await buildWeatherArbReading(config)
    onReading(reading)
    console.log(
      `[weather_arb] NOAA: ${reading.noaaForecast.forecastHighF}°F | ` +
      `Confidence: ${Math.round(reading.confidence * 100)}% | ` +
      `Jupiter odds: ${Math.round(reading.jupiterImpliedOdds * 100)}% | ` +
      `Edge: ${reading.hasEdge ? "YES" : "no"}`,
    )
    if (reading.hasEdge && !config.dryRun) {
      await jupiterSwap(
        config.walletName,
        USDC_MAINNET_MINT,
        config.yesTokenMint,
        config.tradeAmountUsdc * 1_000_000,
      )
    } else if (reading.hasEdge && config.dryRun) {
      console.log(
        `[weather_arb] [dry-run] Would buy ${config.tradeAmountUsdc} USDC of YES token`,
      )
    }
  } catch (err) {
    console.error(`[weather_arb] tick error: ${err}`)
  }
}
