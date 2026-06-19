<div align="center">

# NIGHTWATCHER V2

**A multi-agent autonomous trading system built on Alpaca.**

`TypeScript` &nbsp;·&nbsp; `Cloudflare Workers` &nbsp;·&nbsp; `MCP` &nbsp;·&nbsp; `Alpaca` &nbsp;·&nbsp; `D1`

*Companion repository for the Alpaca Markets blog article:*
**"Building NightWatcher V2 — A Multi-Agent Trading System with Alpaca"**

</div>

---

## What It Does

NightWatcher V2 is an autonomous, multi-agent trading system that:

1. **Scans for signals** — StockTwits sentiment, SEC filings, price momentum, options flow
2. **Validates with LLMs** — runs catalysts through Gemini/OpenAI to filter noise
3. **Routes through a policy engine** — risk checks, position sizing, HMAC approval tokens
4. **Executes via Alpaca** — market/limit orders, options (single-leg + multi-leg), live fills

The entire backend runs on a single Cloudflare Worker with D1 (SQLite) for state, KV for caching, and MCP for LLM-agent tooling.

---

## Architecture

```
Signal Sources          Policy Engine           Execution
─────────────           ─────────────           ─────────
StockTwits  ──┐         ┌─ Risk checks          Alpaca API
SEC EDGAR   ──┤ agent   │  Position sizing  ──► Orders
Price/ORB   ──┤ .mjs ──►│  Approval token       Options
Options     ──┘         └─ Audit log to D1      Fills → D1
```

### Agent (`agent.mjs`)
The orchestrator. Runs strategies, gathers signals, calls the MCP tool server, and submits orders through the policy gate.

### MCP Tool Server (`src/index.ts`)
~50 tools exposed over Model Context Protocol:
- `order-preview` / `order-submit` — two-step atomic execution
- `positions` / `portfolio` — live Alpaca account state
- `prices-bars` / `prices-quote` — market data
- `signal-submit` — ingest external alpha signals
- `policy-get` / `policy-update` — live risk parameter management
- `options-*` — full options strategy toolkit

### Strategies (`strategies/`)
| Strategy | Description |
|---|---|
| `orb` | Opening Range Breakout — ADR%, NR50, regime-gated |
| `momentum-breakout` | Multi-timeframe momentum with Alpaca bars |
| `options-momentum` | Directional options on momentum signals |
| `gap-and-go` | Gap scanner with LLM catalyst confirmation |
| `mean-reversion` | VWAP-anchored mean reversion |
| `vwap-reversion` | Intraday VWAP deviation plays |

### ORB Strategy (Deep Dive)
The ORB strategy uses three gated filters:
1. **ADR% gate** — skip if 20-day avg daily range < 1.2% (dead zone)
2. **NR50 gate** — only enter when today's range is in the bottom 50% of 20-day history (coiled spring)
3. **Regime gate** — skip all entries in bearish macro regime

Risk-anchored position sizing: `shares = risk_per_trade_usd / stop_distance`

---

## Quick Start

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com) (free tier works)
- [Alpaca paper trading account](https://app.alpaca.markets/paper/dashboard/overview)
- Node.js 20+, `wrangler` CLI

### 1. Clone & Install
```bash
git clone https://github.com/LNSTT369/NightWatcher-V2.git
cd NightWatcher-V2
npm install
```

### 2. Configure Secrets
```bash
cp .dev.vars.example .dev.vars
# Fill in your Alpaca API key/secret, OpenAI key
```

### 3. Deploy to Cloudflare
```bash
wrangler deploy
wrangler d1 execute nightwatcher-db --file migrations/0001_initial_schema.sql
# Run all migrations in order
```

### 4. Run the Agent
```bash
node agent.mjs
```

The agent will connect to your deployed Worker via MCP, scan for signals at market open, validate with LLMs, and execute through the policy gate.

---

## Configuration

**`agent-config.example.json`** — rename to `agent-config.json` and set:
```json
{
  "worker_url": "https://your-worker.workers.dev",
  "strategies": ["orb", "momentum-breakout"],
  "paper": true
}
```

**`wrangler.toml`** — update `name`, `database_id` after creating your D1 database.

---

## Policy Engine

Every order goes through a mandatory two-step flow:

```
agent calls order-preview
  └─► policy checks: max_position_size, max_daily_loss, allowed_strategies
  └─► if approved: returns HMAC token (valid 60s)

agent calls order-submit with token
  └─► token verified, order sent to Alpaca
  └─► fill recorded to D1
```

Update policy live without redeploying:
```bash
# via MCP tool or direct API
POST /api/policy { "max_position_size": 1000, "max_daily_loss": 500 }
```

---

## Dashboard

A Brutalist Monochrome UI (React + Vite) in `dashboard/` shows live positions, fills, signals, and regime state.

```bash
cd dashboard && npm install && npm run dev
# Configure VITE_WORKER_URL in dashboard/.env.local
```

---

## Database Migrations

Apply in order:
```
migrations/0001_initial_schema.sql   # core tables
migrations/0002_memory_tables.sql    # agent memory
migrations/0003_events_tables.sql    # event log
migrations/0004_alpha_signals.sql    # signal storage
migrations/0005_execution_fills.sql  # fill audit
migrations/0006_regime.sql           # regime state
migrations/0007_risk_metrics.sql     # risk metrics
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (edge, globally distributed) |
| Database | Cloudflare D1 (SQLite) |
| Cache | Cloudflare KV |
| Agent protocol | Model Context Protocol (MCP) |
| LLM | Gemini 2.0 Flash / OpenAI GPT-4o |
| Brokerage | Alpaca Markets (paper + live) |
| Dashboard | React + Vite + Cloudflare Pages |

---

## Article

Read the full technical breakdown on the [Alpaca Markets Blog](#).

Built by [Chiranjeev Shah](https://github.com/LNSTT369).
