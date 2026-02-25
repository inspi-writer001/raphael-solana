import { strategyManager } from "./strategyManager.ts"
import { createEvmWallet, listEvmWallets, getEvmAddress } from "./evmWallet.ts"
import { getUsdcBalance } from "./polymarketClob.ts"

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
  // ── create_evm_wallet ──────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "create_evm_wallet",
      description:
        "Create a new EVM (Polygon/secp256k1) wallet for Polymarket trading. Returns the wallet name and Polygon address. The user must bridge USDC to this address before live trading.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Wallet name, e.g. \"polymarket1\"" },
        },
        required: ["name"],
      },
      execute: async (_id, params) => {
        try {
          const { name } = params as { name: string }
          const info = await createEvmWallet(name)
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `EVM wallet "${info.name}" created.`,
                  `  Polygon address: ${info.address}`,
                  `  Created at:      ${info.createdAt}`,
                  ``,
                  `Send USDC (Polygon PoS) to: ${info.address}`,
                  `Then call check_usdc_balance to verify arrival before starting the scanner.`,
                ].join("\n"),
              },
            ],
          }
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error creating EVM wallet: ${err instanceof Error ? err.message : String(err)}` }],
          }
        }
      },
    },
    { optional: true },
  )

  // ── list_evm_wallets ───────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "list_evm_wallets",
      description: "List all EVM (Polygon) wallets. Shows names and Polygon addresses.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        try {
          const wallets = await listEvmWallets()
          if (wallets.length === 0) {
            return { content: [{ type: "text" as const, text: "No EVM wallets found. Use create_evm_wallet to create one." }] }
          }
          const lines = wallets.map(w => `  ${w.name.padEnd(16)}: ${w.address}  (created ${w.createdAt})`)
          return { content: [{ type: "text" as const, text: `EVM wallets:\n${lines.join("\n")}` }] }
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error listing EVM wallets: ${err instanceof Error ? err.message : String(err)}` }],
          }
        }
      },
    },
    { optional: true },
  )

  // ── check_usdc_balance ─────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "check_usdc_balance",
      description:
        "Check the USDC.e balance on Polygon for a named EVM wallet. Use this to confirm funds have arrived before starting the live scanner.",
      parameters: {
        type: "object",
        properties: {
          wallet_name: { type: "string", description: "EVM wallet name" },
        },
        required: ["wallet_name"],
      },
      execute: async (_id, params) => {
        try {
          const { wallet_name } = params as { wallet_name: string }
          const address = await getEvmAddress(wallet_name)
          const balance = await getUsdcBalance(address)
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `USDC balance for "${wallet_name}":`,
                  `  Address: ${address}`,
                  `  Balance: $${balance.toFixed(2)} USDC`,
                  balance < 5
                    ? `  ⚠ Balance is below the $5 minimum trade amount.`
                    : `  ✅ Ready to trade.`,
                ].join("\n"),
              },
            ],
          }
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error checking USDC balance: ${err instanceof Error ? err.message : String(err)}` }],
          }
        }
      },
    },
    { optional: true },
  )

  // ── start_weather_arb ──────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "start_weather_arb",
      description:
        "Start the Polymarket weather arbitrage scanner. Polls Open-Meteo forecasts and buys underpriced YES brackets on Polymarket weather markets using an EVM (Polygon) wallet.",
      parameters: {
        type: "object",
        properties: {
          wallet_name: { type: "string", description: "EVM wallet name (Polygon/secp256k1)" },
          cities: {
            type: "array",
            items: { type: "string" },
            description: "City keys to scan, e.g. [\"nyc\",\"london\",\"seoul\"]",
          },
          trade_amount_usdc: {
            type: "number",
            description: "USDC to spend per trade (min $5, e.g. 5)",
          },
          max_position_usdc: {
            type: "number",
            description: "Hard cap USDC per bracket (default 10)",
          },
          min_edge: {
            type: "number",
            description: "Minimum edge (fairValue − askPrice) to trigger trade (default 0.20)",
          },
          min_fair_value: {
            type: "number",
            description: "Minimum fair probability to consider trading (default 0.40)",
          },
          interval_seconds: {
            type: "number",
            description: "Poll interval in seconds (default 120)",
          },
          dry_run: { type: "boolean", default: true },
        },
        required: ["wallet_name", "trade_amount_usdc"],
      },
      execute: async (_id, params) => {
        try {
          const p = params as {
            wallet_name: string
            cities?: string[]
            trade_amount_usdc: number
            max_position_usdc?: number
            min_edge?: number
            min_fair_value?: number
            interval_seconds?: number
            dry_run?: boolean
          }

          if (strategyManager.getStatus().weather_arb.running) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Weather arb scanner is already running. Use stop_weather_arb first.",
                },
              ],
            }
          }

          const config = {
            walletName:       p.wallet_name,
            cities:           p.cities ?? ["nyc","london","seoul","chicago","dallas","miami","paris","toronto","seattle"],
            tradeAmountUsdc:  p.trade_amount_usdc,
            maxPositionUsdc:  p.max_position_usdc  ?? 10,
            minEdge:          p.min_edge            ?? 0.20,
            minFairValue:     p.min_fair_value      ?? 0.40,
            intervalSeconds:  p.interval_seconds    ?? 120,
            dryRun:           p.dry_run             ?? true,
          }

          strategyManager.startWeatherArb(config)

          return {
            content: [
              {
                type: "text" as const,
                text: [
                  "Polymarket weather arb scanner started.",
                  `  Wallet:       ${config.walletName}`,
                  `  Cities:       ${config.cities.join(", ")}`,
                  `  Amount:       $${config.tradeAmountUsdc} USDC`,
                  `  Max pos:      $${config.maxPositionUsdc} USDC`,
                  `  Min edge:     ${Math.round(config.minEdge * 100)}%`,
                  `  Min fair val: ${Math.round(config.minFairValue * 100)}%`,
                  `  Interval:     ${config.intervalSeconds}s`,
                  `  Dry run:      ${config.dryRun}`,
                ].join("\n"),
              },
            ],
          }
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error starting weather arb: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          }
        }
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
        try {
          strategyManager.stopWeatherArb()
          return { content: [{ type: "text" as const, text: "Weather arb scanner stopped." }] }
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error stopping weather arb: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          }
        }
      },
    },
    { optional: true },
  )

  // ── get_strategy_status ────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "get_strategy_status",
      description:
        "Returns formatted status of both the pumpfun and Polymarket weather_arb scanners including latest per-city readings.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const s = strategyManager.getStatus()

        const sourceLine =
          s._source
            ? `  Source:           ${s._source}${s._stale ? " ⚠ stale" : ""}`
            : null

        const cityLines = s.weather_arb.lastReadings.map((r) => {
          const edgeStr   = r.bestEdge   != null ? ` edge=${Math.round(r.bestEdge * 100)}%` : ""
          const bracketStr = r.targetBracket ? ` bracket="${r.targetBracket}"` : ""
          const skipStr   = r.skippedReason ? ` (${r.skippedReason})` : ""
          return `    ${r.city.padEnd(8)}: ${r.forecastHighF}°F${bracketStr}${edgeStr}${skipStr}`
        })

        const lines = [
          `── Pumpfun Scanner ─────────────────────`,
          `  Running:          ${s.pumpfun.running}`,
          `  Graduations seen: ${s.pumpfun.lastGraduations}`,
          `  Last check:       ${s.pumpfun.lastCheckAt ?? "never"}`,
          ``,
          `── Weather Arb Scanner ──────────────────`,
          ...(sourceLine ? [sourceLine] : []),
          `  Running:          ${s.weather_arb.running}`,
          `  Cities:           ${s.weather_arb.cities.join(", ") || "not configured"}`,
          `  Last check:       ${s.weather_arb.lastCheckAt ?? "never"}`,
          ...cityLines,
        ]
        return { content: [{ type: "text" as const, text: lines.join("\n") }] }
      },
    },
    { optional: true },
  )
}
