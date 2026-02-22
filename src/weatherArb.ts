import { jupiterSwap } from "./swap.ts"
import type { WeatherArbConfig, WeatherArbReading, NoaaForecast } from "./types.ts"

export const USDC_MAINNET_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

const NOAA_API  = "https://api.weather.gov"
const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"
const DFLOW_API  = "https://prediction-markets-api.dflow.net/api/v1"

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

// ── Kalshi Oracle ─────────────────────────────────────────────────────────────

type KalshiMarket = {
  ticker: string
  yes_ask_dollars: string   // "0.4200" — price to buy YES (0–1 decimal)
  status: string
}

const fetchKalshiMarkets = async (seriesTicker: string): Promise<KalshiMarket[]> => {
  const url = `${KALSHI_API}/markets?series_ticker=${seriesTicker}&status=open`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) {
    throw new Error(`Kalshi markets failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as { markets?: KalshiMarket[] }
  return data.markets ?? []
}

// e.g. "KXHIGHNY-26FEB22-B50.5" → 50  (lowerBound = mid - 0.5)
const parseBracketLowerBound = (ticker: string): number | null => {
  const match = ticker.match(/-B(\d+\.?\d*)$/)
  if (!match) return null
  return parseFloat(match[1]) - 0.5
}

// P(high ≥ threshold) = Σ yes_ask_dollars for brackets where lowerBound ≥ threshold
const sumBracketProbabilities = (markets: KalshiMarket[], thresholdF: number): number => {
  let sum = 0
  for (const m of markets) {
    const lb = parseBracketLowerBound(m.ticker)
    if (lb !== null && lb >= thresholdF) {
      sum += parseFloat(m.yes_ask_dollars)
    }
  }
  return Math.min(1, Math.max(0, sum))
}

// Find the bracket ticker whose lowerBound === thresholdF exactly
const findThresholdBracketTicker = (markets: KalshiMarket[], thresholdF: number): string | null => {
  const hit = markets.find(m => parseBracketLowerBound(m.ticker) === thresholdF)
  return hit?.ticker ?? null
}

export const fetchKalshiImpliedOdds = async (
  seriesTicker: string,
  thresholdF: number,
): Promise<{ impliedOdds: number; thresholdBracketTicker: string | null }> => {
  const markets = await fetchKalshiMarkets(seriesTicker)
  const impliedOdds = sumBracketProbabilities(markets, thresholdF)
  const thresholdBracketTicker = findThresholdBracketTicker(markets, thresholdF)
  return { impliedOdds, thresholdBracketTicker }
}

// ── DFlow Mint Resolution ─────────────────────────────────────────────────────

export const fetchDFlowYesMint = async (
  kalshiMarketTicker: string,
  dflowApiKey?: string,
): Promise<string> => {
  const series = kalshiMarketTicker.split("-")[0]
  const url = `${DFLOW_API}/markets?seriesTickers=${series}&status=active`
  const headers: Record<string, string> = { Accept: "application/json" }
  if (dflowApiKey) headers["x-api-key"] = dflowApiKey
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`DFlow markets failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json()
  // Log raw shape on first call to assist field discovery
  console.debug("[weather_arb] DFlow raw response:", JSON.stringify(data).slice(0, 400))

  // Try common field paths for the YES-outcome SPL mint
  const markets: unknown[] = Array.isArray(data) ? data : (data as Record<string, unknown>).markets as unknown[] ?? []
  for (const m of markets) {
    const mObj = m as Record<string, unknown>
    if (typeof mObj["ticker"] === "string" && mObj["ticker"] !== kalshiMarketTicker) continue
    // Try known field paths
    const mint =
      (mObj["yesMint"] as string | undefined) ??
      ((mObj["yesOutcome"] as Record<string, unknown> | undefined)?.["mint"] as string | undefined) ??
      ((Array.isArray(mObj["outcomes"]) ? (mObj["outcomes"] as Record<string, unknown>[])[0]?.["mint"] : undefined) as string | undefined)
    if (!mint || typeof mint !== "string") {
      throw new Error(`DFlow: no mint field found for ${kalshiMarketTicker}. Raw: ${JSON.stringify(m).slice(0, 200)}`)
    }
    return mint
  }
  throw new Error(`DFlow: market ${kalshiMarketTicker} not found in response`)
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

  const { impliedOdds: kalshiImpliedOdds, thresholdBracketTicker } =
    await fetchKalshiImpliedOdds(config.kalshiSeriesTicker, config.tempThresholdF)

  let resolvedYesMint: string | null = null
  if (thresholdBracketTicker) {
    resolvedYesMint = await fetchDFlowYesMint(thresholdBracketTicker, process.env["DFLOW_API_KEY"])
      .catch(err => { console.warn(`[weather_arb] DFlow mint resolution failed: ${err}`); return null })
  }

  const edge = confidence - kalshiImpliedOdds
  const hasEdge =
    confidence >= config.minConfidence && kalshiImpliedOdds <= config.maxMarketOdds

  return {
    noaaForecast,
    confidence,
    kalshiImpliedOdds,
    edge,
    hasEdge,
    thresholdBracketTicker,
    resolvedYesMint,
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
      `Kalshi odds: ${Math.round(reading.kalshiImpliedOdds * 100)}% | ` +
      `Edge: ${reading.hasEdge ? "YES" : "no"}`,
    )
    if (reading.hasEdge && !config.dryRun && reading.resolvedYesMint) {
      await jupiterSwap(
        config.walletName,
        USDC_MAINNET_MINT,
        reading.resolvedYesMint,
        config.tradeAmountUsdc * 1_000_000,
      )
    } else if (reading.hasEdge && config.dryRun) {
      console.log(
        `[weather_arb] [dry-run] Would buy ${config.tradeAmountUsdc} USDC → ${reading.thresholdBracketTicker ?? "YES token"}`,
      )
    }
  } catch (err) {
    console.error(`[weather_arb] tick error: ${err}`)
  }
}
