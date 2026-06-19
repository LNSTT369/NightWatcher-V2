#!/usr/bin/env node
/**
 * NightWatcher V2 — Article Terminal Demo
 * Simulates the full agent boot + signal pipeline for screenshot purposes.
 * Run: node scripts/demo-terminal.mjs
 */

const RESET  = '\x1b[0m'
const DIM    = '\x1b[2m'
const BOLD   = '\x1b[1m'
const CYAN   = '\x1b[36m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const MAGENTA= '\x1b[35m'
const WHITE  = '\x1b[97m'
const GRAY   = '\x1b[90m'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function ts() {
  return GRAY + new Date().toISOString().replace('T', ' ').slice(0, 23) + RESET
}

function log(tag, color, msg) {
  console.log(`${ts()}  ${color}${BOLD}[${tag}]${RESET}  ${msg}`)
}

function dim(msg) {
  console.log(`${GRAY}${msg}${RESET}`)
}

function rule(char = '─') {
  console.log(GRAY + char.repeat(78) + RESET)
}

async function run() {
  console.clear()

  // ── Header ──────────────────────────────────────────────────────────────────
  console.log('')
  console.log(CYAN + BOLD + '  ███╗   ██╗██╗ ██████╗ ██╗  ██╗████████╗██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗███████╗██████╗ ' + RESET)
  console.log(CYAN +        '  ████╗  ██║██║██╔════╝ ██║  ██║╚══██╔══╝██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║██╔════╝██╔══██╗' + RESET)
  console.log(CYAN +        '  ██╔██╗ ██║██║██║  ███╗███████║   ██║   ██║ █╗ ██║███████║   ██║   ██║     ███████║█████╗  ██████╔╝' + RESET)
  console.log(CYAN +        '  ██║╚██╗██║██║██║   ██║██╔══██║   ██║   ██║███╗██║██╔══██║   ██║   ██║     ██╔══██║██╔══╝  ██╔══██╗' + RESET)
  console.log(CYAN +        '  ██║ ╚████║██║╚██████╔╝██║  ██║   ██║   ╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║███████╗██║  ██║' + RESET)
  console.log(CYAN +        '  ╚═╝  ╚═══╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝' + RESET)
  console.log('')
  console.log(WHITE + BOLD + '                     V2  ·  Multi-Agent Trading System  ·  Alpaca + MCP' + RESET)
  console.log(GRAY  +        '                         Cloudflare Workers · D1 · Gemini 2.0 Flash' + RESET)
  console.log('')
  rule('═')
  console.log('')
  await sleep(400)

  // ── MCP Server boot ─────────────────────────────────────────────────────────
  log('MCP', CYAN, `Starting NightWatcher MCP server on ${WHITE}wss://nightwatcher.workers.dev/mcp${RESET}`)
  await sleep(300)
  log('MCP', CYAN, `Registering ${WHITE}47 tools${RESET} across 6 namespaces`)
  await sleep(200)
  dim('          order-preview  order-submit  positions  portfolio')
  dim('          prices-bars  prices-quote  options-*  signal-submit')
  dim('          policy-get  policy-update  regime-detect  risk-*')
  await sleep(300)
  log('MCP', GREEN, `✓ Tool manifest published  ${GRAY}[47 tools / 6 namespaces]`)
  await sleep(250)
  log('MCP', CYAN, `Connecting to Cloudflare D1  ${GRAY}nightwatcher-db`)
  await sleep(400)
  log('MCP', GREEN, `✓ D1 connected  ${GRAY}[migrations 0001–0007 verified]`)
  await sleep(200)
  log('MCP', GREEN, `✓ KV cache online  ${GRAY}[TTL: 300s regime · 60s signals]`)
  await sleep(200)
  log('MCP', GREEN, `✓ Policy engine loaded  ${GRAY}[max_position=$1,000 · max_daily_loss=$500]`)
  console.log('')
  await sleep(300)

  // ── Regime detection ────────────────────────────────────────────────────────
  rule()
  log('REGIME', MAGENTA, 'Running market regime detection  (SPY, ADX, ATR, realized vol)')
  await sleep(500)
  log('REGIME', MAGENTA, `Fetching SPY 20D bars from Alpaca…`)
  await sleep(600)
  log('REGIME', MAGENTA, `ADX: ${WHITE}34.2${RESET}  ATR%: ${WHITE}1.87%${RESET}  SPY 20D: ${GREEN}+4.31%${RESET}  RVOL: ${WHITE}18.4%${RESET}`)
  await sleep(300)
  log('REGIME', GREEN, `✓ Regime classified: ${BOLD}${GREEN}TRENDING BULL${RESET}  confidence: ${WHITE}82%${RESET}  size_mult: ${GREEN}1.15×${RESET}`)
  await sleep(200)
  log('REGIME', CYAN, `  → Writing to KV cache  ${GRAY}[key: regime:latest · TTL: 300s]`)
  console.log('')
  await sleep(300)

  // ── Signal scanning ─────────────────────────────────────────────────────────
  rule()
  log('SCANNER', YELLOW, 'Scanning signal sources…')
  await sleep(400)

  log('STOCKTWITS', CYAN, `Fetching trending tickers  ${GRAY}[watchlist: NVDA TSLA AMZN COIN PLTR HOOD]`)
  await sleep(700)
  log('STOCKTWITS', CYAN, `NVDA  — 847 mentions · sentiment: ${GREEN}+0.71${RESET} · bullish ratio: ${WHITE}68%${RESET}`)
  await sleep(150)
  log('STOCKTWITS', CYAN, `TSLA  — 1,203 mentions · sentiment: ${GREEN}+0.52${RESET} · bullish ratio: ${WHITE}61%${RESET}`)
  await sleep(150)
  log('STOCKTWITS', CYAN, `COIN  — 412 mentions · sentiment: ${GREEN}+0.44${RESET} · bullish ratio: ${WHITE}58%${RESET}`)
  await sleep(150)
  log('STOCKTWITS', GRAY, `PLTR  — 289 mentions · sentiment: ${YELLOW}+0.12${RESET} · bullish ratio: ${WHITE}51%${RESET}  ${GRAY}[below threshold]`)
  await sleep(200)
  log('SCANNER', GREEN, `✓ 3 high-confidence signals queued for LLM validation`)
  console.log('')
  await sleep(300)

  // ── ORB scan ─────────────────────────────────────────────────────────────────
  rule()
  log('ORB', YELLOW, 'Opening Range Breakout scan  (10:30 AM ET window)')
  await sleep(400)
  log('ORB', YELLOW, `Applying ADR% gate  ${GRAY}[threshold: 1.2%]`)
  await sleep(300)
  log('ORB', YELLOW, `NVDA  ADR%: ${WHITE}3.41%${RESET}  ✓ pass  NR50: ${WHITE}bottom 23rd pctl${RESET}  ✓ coiled`)
  await sleep(150)
  log('ORB', YELLOW, `TSLA  ADR%: ${WHITE}4.12%${RESET}  ✓ pass  NR50: ${WHITE}bottom 41st pctl${RESET}  ✓ coiled`)
  await sleep(150)
  log('ORB', GRAY,   `AMD   ADR%: ${WHITE}0.89%${RESET}  ✗ skip  ${GRAY}[ADR below 1.2% dead zone]`)
  await sleep(200)
  log('ORB', GREEN, `✓ 2 ORB candidates qualify for execution  ${GRAY}[regime gate: PASS]`)
  console.log('')
  await sleep(300)

  // ── LLM Research ─────────────────────────────────────────────────────────────
  rule()
  log('LLM', MAGENTA, `Catalyst validation via Gemini 2.0 Flash  ${GRAY}[provider: google]`)
  await sleep(300)

  log('LLM', MAGENTA, `→ NVDA  composing research prompt  ${GRAY}[sentiment + technicals + regime context]`)
  await sleep(800)
  log('LLM', MAGENTA, `  Response (312 tokens in / 89 out · $0.000041):`)
  await sleep(200)
  dim(`  ┌─────────────────────────────────────────────────────────────────────`)
  dim(`  │ NVDA shows strong institutional accumulation. The 10:30 ORB break at`)
  dim(`  │ $142.80 aligns with a coiled NR50 setup and bullish regime. Catalyst:`)
  dim(`  │ Blackwell GPU demand commentary at GTC. Confidence: HIGH. Direction:`)
  dim(`  │ LONG. Suggested size multiplier: 1.1× (regime-adjusted).`)
  dim(`  └─────────────────────────────────────────────────────────────────────`)
  await sleep(400)
  log('LLM', GREEN, `  ✓ NVDA  validated  ${GRAY}confidence: 0.87  direction: LONG  urgency: high`)
  console.log('')
  await sleep(300)

  log('LLM', MAGENTA, `→ TSLA  composing research prompt`)
  await sleep(700)
  log('LLM', MAGENTA, `  Response (298 tokens in / 76 out · $0.000038):`)
  await sleep(200)
  dim(`  ┌─────────────────────────────────────────────────────────────────────`)
  dim(`  │ TSLA breakout above $248 ORB high with volume confirmation. Sentiment`)
  dim(`  │ spike (1,203 mentions) may be FSD delivery narrative. Setup is valid`)
  dim(`  │ but momentum is extended. Reduce size to 0.8× — elevated noise risk.`)
  dim(`  └─────────────────────────────────────────────────────────────────────`)
  await sleep(400)
  log('LLM', YELLOW, `  ✓ TSLA  validated  ${GRAY}confidence: 0.71  direction: LONG  urgency: medium`)
  console.log('')
  await sleep(300)

  log('LLM', CYAN, `LLM cost session total: ${WHITE}$0.000079${RESET}  calls: ${WHITE}2${RESET}  tokens: ${WHITE}1,550${RESET}`)
  console.log('')
  await sleep(400)

  // ── Approval tokens ───────────────────────────────────────────────────────────
  rule()
  log('POLICY', YELLOW, 'Requesting order approval tokens via policy engine…')
  await sleep(300)

  log('POLICY', YELLOW, `→ order-preview  NVDA  BUY 7 shares @ market  est. $999.60`)
  await sleep(500)
  log('POLICY', YELLOW, `  Policy checks:`)
  await sleep(150)
  dim(`    max_position_size:  $999.60 ≤ $1,000.00   ✓`)
  dim(`    max_daily_loss:     $0.00 of $500.00 used  ✓`)
  dim(`    allowed_strategies: orb                    ✓`)
  dim(`    regime_gate:        TRENDING BULL → PASS   ✓`)
  dim(`    NR50_filter:        23rd pctl → coiled     ✓`)
  await sleep(400)
  log('POLICY', GREEN, `  ✓ Token issued  ${GRAY}[hmac: a3f8c2…d91b · expires: 60s]`)
  console.log('')
  await sleep(300)

  log('POLICY', YELLOW, `→ order-preview  TSLA  BUY 4 shares @ market  est. $993.20`)
  await sleep(500)
  log('POLICY', YELLOW, `  Policy checks:`)
  await sleep(150)
  dim(`    max_position_size:  $993.20 ≤ $1,000.00   ✓`)
  dim(`    max_daily_loss:     $0.00 of $500.00 used  ✓`)
  dim(`    size_override:      0.8× applied (LLM rec) ✓`)
  await sleep(400)
  log('POLICY', GREEN, `  ✓ Token issued  ${GRAY}[hmac: 7c14e9…f203 · expires: 60s]`)
  console.log('')
  await sleep(400)

  // ── Execution ─────────────────────────────────────────────────────────────────
  rule()
  log('EXECUTOR', GREEN, 'Submitting orders to Alpaca (paper trading)…')
  await sleep(400)

  log('EXECUTOR', GREEN, `→ order-submit  NVDA  ${GRAY}[token: a3f8c2…d91b]`)
  await sleep(600)
  log('EXECUTOR', GREEN, `  ✓ Order filled  ${WHITE}7 × NVDA @ $142.94${RESET}  total: ${WHITE}$1,000.58${RESET}  fill: ${WHITE}14:31:02.441 ET${RESET}`)
  log('EXECUTOR', CYAN,  `  → Fill written to D1  ${GRAY}[table: execution_fills · id: fill_1a2b3c]`)
  await sleep(200)
  log('EXECUTOR', CYAN,  `  → Signal archived    ${GRAY}[table: alpha_signals · status: executed]`)
  console.log('')
  await sleep(300)

  log('EXECUTOR', GREEN, `→ order-submit  TSLA  ${GRAY}[token: 7c14e9…f203]`)
  await sleep(600)
  log('EXECUTOR', GREEN, `  ✓ Order filled  ${WHITE}4 × TSLA @ $248.31${RESET}  total: ${WHITE}$993.24${RESET}  fill: ${WHITE}14:31:03.887 ET${RESET}`)
  log('EXECUTOR', CYAN,  `  → Fill written to D1  ${GRAY}[table: execution_fills · id: fill_4d5e6f]`)
  log('EXECUTOR', CYAN,  `  → Signal archived    ${GRAY}[table: alpha_signals · status: executed]`)
  console.log('')
  await sleep(400)

  // ── Portfolio snapshot ────────────────────────────────────────────────────────
  rule()
  log('PORTFOLIO', WHITE, 'Account snapshot post-execution:')
  await sleep(300)
  dim(`  Equity        $101,247.88`)
  dim(`  Cash          $99,254.18`)
  dim(`  Buying Power  $198,508.36`)
  dim(`  Open P&L      −$3.40  (NVDA −$0.98  TSLA −$2.42)`)
  dim(`  Positions     2 open  (2/5 slots)`)
  dim(`  Daily P&L     $0.00  (fills just executed)`)
  console.log('')
  await sleep(300)

  // ── Monitoring ────────────────────────────────────────────────────────────────
  rule()
  log('MONITOR', CYAN, `Agent entering monitoring loop  ${GRAY}[poll: 30s · exit scan: 5min]`)
  await sleep(200)
  log('MONITOR', CYAN, `Stop-loss guards active:  NVDA @ $137.62  TSLA @ $242.18`)
  await sleep(200)
  log('MONITOR', CYAN, `Profit targets active:    NVDA @ $157.23 (2R)  TSLA @ $273.14 (3R)`)
  await sleep(200)
  log('MONITOR', GREEN, `✓ NightWatcher V2 running  —  dashboard: ${WHITE}http://localhost:3005${RESET}`)
  console.log('')
  rule('═')
  console.log('')

  // ── Subsequent log stream ────────────────────────────────────────────────────
  const streamLogs = [
    [CYAN,   'MONITOR',   'NVDA +$14.28 (+1.41%) · hold: 4m32s · sentiment stable'],
    [CYAN,   'MONITOR',   'TSLA −$6.88 (−0.69%) · hold: 4m33s · noise flag: elevated'],
    [YELLOW, 'STOCKTWITS','New spike: COIN +312 mentions in 10min window  → queuing scan'],
    [MAGENTA,'LLM',       'COIN catalyst check  (189 tok · $0.000023)  → confidence: 0.61  HOLD'],
    [CYAN,   'MONITOR',   'NVDA +$29.40 (+2.91%) · approaching 2R target ($157.23)'],
    [GREEN,  'EXECUTOR',  'NVDA exit triggered  → BUY-to-CLOSE  7 × $147.14  P&L: +$29.40 (+2.9%)'],
    [CYAN,   'MONITOR',   'TSLA −$9.24 (−0.93%) · staleness score: 0.72 · monitoring'],
    [YELLOW, 'POLICY',    'TSLA trailing stop adjusted: $243.86 → protecting partial gains'],
    [CYAN,   'MONITOR',   `Market close approaching  ${GRAY}[15:55 ET · 5min warning]`],
    [YELLOW, 'EXECUTOR',  'EOD flatten: closing TSLA position  4 × $246.09  P&L: −$8.88 (−0.89%)'],
    [WHITE,  'SESSION',   `Day summary  trades: 2  winners: 1  losers: 1  net P&L: ${GREEN}+$20.52${RESET}  LLM cost: ${WHITE}$0.000102`],
  ]

  for (const [color, tag, msg] of streamLogs) {
    await sleep(Math.random() * 500 + 250)
    log(tag, color, msg)
  }

  console.log('')
  rule('═')
  console.log(GRAY + '  NightWatcher V2 session complete. All data persisted to D1.' + RESET)
  console.log('')
}

run().catch(console.error)
