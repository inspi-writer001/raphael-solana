import { strategyManager } from "./strategyManager.ts"

type OpenClawTool = {
  name: string
  description: string
  parameters: object
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>
}

type OpenClawAPI = {
  registerTool(tool: OpenClawTool, opts?: { optional?: boolean }): void
}

export default function register(api: OpenClawAPI): void {
  // ── start_weather_arb ──────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "start_weather_arb",
      description:
        "Start the Kalshi weather arbitrage scanner. Polls NOAA every 2 min and buys YES tokens via Jupiter when Kalshi bracket-sum probability is below confidence threshold.",
      parameters: {
        type: "object",
        properties: {
          wallet_name: { type: "string", description: "Managed wallet name" },
          target_city_coordinates: {
            type: "object",
            description: "NOAA grid coordinates",
            properties: {
              office: { type: "string", description: "NOAA office code e.g. OKX" },
              grid_x: { type: "number" },
              grid_y: { type: "number" },
            },
            required: ["office", "grid_x", "grid_y"],
          },
          temp_threshold_f: {
            type: "number",
            description: "Temperature threshold in Fahrenheit",
          },
          kalshi_series_ticker: {
            type: "string",
            description: "Kalshi series ticker for the city weather market, e.g. KXHIGHNY (NYC high), KXHIGHCHI (Chicago high), KXHIGHLA (LA high)",
          },
          trade_amount: {
            type: "number",
            description: "USDC to spend per trade (e.g. 10)",
          },
          dry_run: { type: "boolean", default: true },
        },
        required: [
          "wallet_name",
          "target_city_coordinates",
          "temp_threshold_f",
          "kalshi_series_ticker",
          "trade_amount",
        ],
      },
      execute: async (_id, params) => {
        const p = params as {
          wallet_name: string
          target_city_coordinates: { office: string; grid_x: number; grid_y: number }
          temp_threshold_f: number
          kalshi_series_ticker: string
          trade_amount: number
          dry_run?: boolean
        }
        strategyManager.startWeatherArb({
          walletName: p.wallet_name,
          gridpointOffice: p.target_city_coordinates.office,
          gridX: p.target_city_coordinates.grid_x,
          gridY: p.target_city_coordinates.grid_y,
          tempThresholdF: p.temp_threshold_f,
          kalshiSeriesTicker: p.kalshi_series_ticker,
          tradeAmountUsdc: p.trade_amount,
          minConfidence: 0.90,
          maxMarketOdds: 0.40,
          intervalSeconds: 120,
          dryRun: p.dry_run ?? true,
        })
        return { content: [{ type: "text" as const, text: "Weather arb scanner started." }] }
      },
    },
    { optional: true },
  )

  // ── stop_weather_arb ───────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "stop_weather_arb",
      description: "Stop the Polymarket weather arbitrage scanner.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        strategyManager.stopWeatherArb()
        return { content: [{ type: "text" as const, text: "Weather arb scanner stopped." }] }
      },
    },
    { optional: true },
  )

  // ── get_strategy_status ────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "get_strategy_status",
      description:
        "Returns formatted status of both the pumpfun and weather_arb scanners including latest readings.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const s = strategyManager.getStatus()
        const lines = [
          `── Pumpfun Scanner ─────────────────────`,
          `  Running:          ${s.pumpfun.running}`,
          `  Graduations seen: ${s.pumpfun.lastGraduations}`,
          `  Last check:       ${s.pumpfun.lastCheckAt ?? "never"}`,
          ``,
          `── Weather Arb Scanner ──────────────────`,
          `  Running:          ${s.weather_arb.running}`,
          `  City (office):    ${s.weather_arb.city ?? "not configured"}`,
          `  NOAA forecast:    ${s.weather_arb.lastNoaaTemp != null ? `${s.weather_arb.lastNoaaTemp}°F` : "pending"}`,
          `  Confidence:       ${s.weather_arb.lastConfidence != null ? `${Math.round(s.weather_arb.lastConfidence * 100)}%` : "pending"}`,
          `  Market odds:      ${s.weather_arb.lastMarketOdds != null ? `${Math.round(s.weather_arb.lastMarketOdds * 100)}%` : "pending"}`,
          `  Last check:       ${s.weather_arb.lastCheckAt ?? "never"}`,
        ]
        return { content: [{ type: "text" as const, text: lines.join("\n") }] }
      },
    },
    { optional: true },
  )
}
