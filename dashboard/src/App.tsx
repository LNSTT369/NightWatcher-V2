import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Panel } from './components/Panel'
import { Metric, MetricInline } from './components/Metric'
import { StatusBar } from './components/StatusIndicator'
import { SettingsModal } from './components/SettingsModal'
import { SetupWizard } from './components/SetupWizard'
import { LineChart, Sparkline } from './components/LineChart'
import { NotificationBell } from './components/NotificationBell'
import { Tooltip, TooltipContent } from './components/Tooltip'
import type {
  Status, Config, LogEntry, Signal, Position, SignalResearch, PortfolioSnapshot,
  RegimeState, RiskMetrics, AlphaSignal, MarketRegime,
} from './types'

const API_BASE = '/api'

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function getAgentColor(agent: string): string {
  const colors: Record<string, string> = {
    Analyst: 'text-hud-purple',
    Executor: 'text-hud-cyan',
    StockTwits: 'text-hud-success',
    SignalResearch: 'text-hud-cyan',
    PositionResearch: 'text-hud-purple',
    Crypto: 'text-hud-warning',
    System: 'text-hud-text-dim',
  }
  return colors[agent] || 'text-hud-text'
}

function isCryptoSymbol(symbol: string, cryptoSymbols: string[] = []): boolean {
  return cryptoSymbols.includes(symbol) || symbol.includes('/USD') ||
    symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL')
}

function getVerdictColor(verdict: string): string {
  if (verdict === 'BUY')  return 'text-hud-success'
  if (verdict === 'SKIP') return 'text-hud-error'
  return 'text-hud-warning'
}

function getQualityColor(quality: string): string {
  if (quality === 'excellent') return 'text-hud-success'
  if (quality === 'good')      return 'text-hud-primary'
  if (quality === 'fair')      return 'text-hud-warning'
  return 'text-hud-error'
}

function getSentimentColor(score: number): string {
  if (score >= 0.3)  return 'text-hud-success'
  if (score <= -0.2) return 'text-hud-error'
  return 'text-hud-warning'
}

// ─── V3 color / label helpers ─────────────────────────────────────────────────

const REGIME_LABELS: Record<MarketRegime, string> = {
  trending_bull:   'TRENDING BULL',
  trending_bear:   'TRENDING BEAR',
  range_bound:     'RANGE BOUND',
  high_volatility: 'HIGH VOL',
  low_volatility:  'LOW VOL',
  crisis:          'CRISIS',
}

const REGIME_HEX: Record<MarketRegime, string> = {
  trending_bull:   '#28c870',
  trending_bear:   '#e83838',
  range_bound:     '#e0a030',
  high_volatility: '#d87820',
  low_volatility:  '#48a0c0',
  crisis:          '#e83838',
}

function getSharpeColor(sharpe: number): string {
  if (sharpe >= 2.0) return 'text-hud-success'
  if (sharpe >= 1.0) return 'text-hud-primary'
  if (sharpe >= 0)   return 'text-hud-warning'
  return 'text-hud-error'
}

function getDirectionColor(dir: string): string {
  if (dir === 'long')  return 'text-hud-success'
  if (dir === 'short') return 'text-hud-error'
  return 'text-hud-text-dim'
}

function getSourceLabel(source: string): string {
  const map: Record<string, string> = {
    dark_pool: 'DARK', l2_microstructure: 'L2', external: 'EXT',
    technical: 'TECH', llm: 'LLM', manual: 'MANU',
  }
  return map[source] || source.toUpperCase()
}

// ─── Mock data generators (used before real data arrives) ─────────────────────

function generateMockPortfolioHistory(equity: number, points: number = 24): PortfolioSnapshot[] {
  const history: PortfolioSnapshot[] = []
  const now = Date.now()
  const interval = 3_600_000
  let value = equity * 0.95

  for (let i = points; i >= 0; i--) {
    const change = (Math.random() - 0.45) * equity * 0.005
    value = Math.max(value + change, equity * 0.8)
    const pl = value - equity * 0.95
    history.push({ timestamp: now - i * interval, equity: value, pl, pl_pct: (pl / (equity * 0.95)) * 100 })
  }
  history[history.length - 1] = { timestamp: now, equity, pl: equity - history[0].equity, pl_pct: ((equity - history[0].equity) / history[0].equity) * 100 }
  return history
}

function generateMockPriceHistory(currentPrice: number, unrealizedPl: number, points: number = 20): number[] {
  const prices: number[] = []
  const startPrice = currentPrice * (unrealizedPl >= 0 ? 0.95 : 1.05)
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const trend = startPrice + (currentPrice - startPrice) * progress
    prices.push(trend + trend * (Math.random() - 0.5) * 0.02)
  }
  prices[prices.length - 1] = currentPrice
  return prices
}

// ─── Icon components ──────────────────────────────────────────────────────────

function SunIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2m-4.34-5.66 1.41-1.41M6.34 17.66l-1.41 1.41" />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' ? (window.localStorage.getItem('theme') as 'light' | 'dark' || 'dark') : 'dark'
  )
  useEffect(() => {
    const root = window.document.documentElement
    theme === 'light' ? root.classList.add('light') : root.classList.remove('light')
    localStorage.setItem('theme', theme)
  }, [theme])
  const toggleTheme = () => setTheme(p => p === 'light' ? 'dark' : 'light')

  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [time, setTime] = useState(new Date())
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([])
  const [historyPeriod, setHistoryPeriod] = useState<'1D' | '1W' | '1M'>('1D')
  const logsEndRef = useRef<HTMLDivElement>(null)

  // V3 state
  const [regime, setRegime] = useState<RegimeState | null>(null)
  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics | null>(null)
  const [alphaSignals, setAlphaSignals] = useState<AlphaSignal[]>([])

  // ── Setup check ────────────────────────────────────────────────────────────
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${API_BASE}/setup/status`)
        const data = await res.json()
        if (data.ok && !data.data.configured) setShowSetup(true)
        setSetupChecked(true)
      } catch { setSetupChecked(true) }
    }
    checkSetup()
  }, [])

  // ── Status polling ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/status`)
        const data = await res.json()
        if (data.ok) { setStatus(data.data); setError(null) }
        else setError(data.error || 'Failed to fetch status')
      } catch { setError('Connection failed — is the agent running?') }
    }
    if (setupChecked && !showSetup) {
      fetchStatus()
      const si = setInterval(fetchStatus, 5000)
      const ti = setInterval(() => setTime(new Date()), 1000)
      return () => { clearInterval(si); clearInterval(ti) }
    }
  }, [setupChecked, showSetup])

  // ── Portfolio history ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!setupChecked || showSetup) return
    const fetchHistory = async () => {
      try {
        const tf = historyPeriod === '1D' ? '15Min' : historyPeriod === '1W' ? '1H' : '1D'
        const res = await fetch(`${API_BASE}/portfolio/history?period=${historyPeriod}&timeframe=${tf}`)
        const json = await res.json()
        if (json.ok && json.data) {
          const { timestamp, equity, profit_loss, profit_loss_pct } = json.data
          if (timestamp && equity) {
            const mapped = timestamp.map((t: number, i: number) => ({
              timestamp: t * 1000, equity: equity[i] || 0,
              pl: profit_loss ? profit_loss[i] : 0,
              pl_pct: profit_loss_pct ? profit_loss_pct[i] * 100 : 0,
            })).filter((m: PortfolioSnapshot) => m.equity > 0)
            if (mapped.length > 1) { setPortfolioHistory(mapped); return }
          }
        }
        if (status?.account) setPortfolioHistory(generateMockPortfolioHistory(status.account.equity))
      } catch {
        if (status?.account && portfolioHistory.length <= 1)
          setPortfolioHistory(generateMockPortfolioHistory(status.account.equity))
      }
    }
    fetchHistory()
    const id = setInterval(fetchHistory, 60_000)
    return () => clearInterval(id)
  }, [setupChecked, showSetup, historyPeriod, status?.account])

  // ── V3: regime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!setupChecked || showSetup) return
    const fetch$ = async () => {
      try {
        const res = await fetch(`${API_BASE}/v3/regime`)
        const json = await res.json()
        if (json.ok && json.data) setRegime(json.data)
      } catch { /* MCP not connected */ }
    }
    fetch$()
    const id = setInterval(fetch$, 300_000)
    return () => clearInterval(id)
  }, [setupChecked, showSetup])

  // ── V3: risk metrics ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!setupChecked || showSetup) return
    const fetch$ = async () => {
      try {
        const res = await fetch(`${API_BASE}/v3/risk`)
        const json = await res.json()
        if (json.ok && json.data) setRiskMetrics(json.data)
      } catch { /* MCP not connected */ }
    }
    fetch$()
    const id = setInterval(fetch$, 300_000)
    return () => clearInterval(id)
  }, [setupChecked, showSetup])

  // ── V3: alpha signals ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!setupChecked || showSetup) return
    const fetch$ = async () => {
      try {
        const res = await fetch(`${API_BASE}/v3/signals`)
        const json = await res.json()
        if (json.ok && json.data?.signals) setAlphaSignals(json.data.signals)
      } catch { /* MCP not connected */ }
    }
    fetch$()
    const id = setInterval(fetch$, 15_000)
    return () => clearInterval(id)
  }, [setupChecked, showSetup])

  // ── Auto-scroll logs ───────────────────────────────────────────────────────
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [status?.logs])

  // ── Config save ────────────────────────────────────────────────────────────
  const handleSaveConfig = async (config: Config) => {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    })
    const data = await res.json()
    if (data.ok && status) setStatus({ ...status, config: data.data })
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const account      = status?.account
  const positions    = status?.positions || []
  const signals      = status?.signals || []
  const logs         = status?.logs || []
  const costs        = status?.costs || { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 }
  const config       = status?.config
  const isMarketOpen = status?.clock?.is_open ?? false

  const startingEquity = config?.starting_equity || 100_000
  const unrealizedPl   = positions.reduce((s, p) => s + p.unrealized_pl, 0)
  const totalPl        = account ? account.equity - startingEquity : 0
  const realizedPl     = totalPl - unrealizedPl
  const totalPlPct     = account ? (totalPl / startingEquity) * 100 : 0

  const positionColors = ['cyan', 'purple', 'yellow', 'blue', 'green'] as const

  const positionPriceHistories = useMemo(() => {
    const h: Record<string, number[]> = {}
    positions.forEach(p => { h[p.symbol] = generateMockPriceHistory(p.current_price, p.unrealized_pl) })
    return h
  }, [positions.map(p => p.symbol).join(',')])

  const portfolioChartData   = useMemo(() => portfolioHistory.map(s => s.equity), [portfolioHistory])
  const portfolioChartLabels = useMemo(() => portfolioHistory.map(s => {
    const d = new Date(s.timestamp)
    return historyPeriod === '1D'
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }), [portfolioHistory, historyPeriod])

  const normalizedPositionSeries = useMemo(() => positions.map((pos, idx) => {
    const hist = positionPriceHistories[pos.symbol] || []
    if (hist.length < 2) return null
    const start = hist[0]
    return { label: pos.symbol, data: hist.map(p => ((p - start) / start) * 100), variant: positionColors[idx % positionColors.length] }
  }).filter(Boolean) as { label: string; data: number[]; variant: typeof positionColors[number] }[], [positions, positionPriceHistories])

  // V3 regime accent color
  const regimeAccent = regime ? REGIME_HEX[regime.regime] : undefined

  // ── Early returns ──────────────────────────────────────────────────────────
  if (showSetup) return <SetupWizard onComplete={() => setShowSetup(false)} />

  if (error && !status) {
    return (
      <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
        <Panel title="CONNECTION ERROR" className="max-w-md w-full">
          <div className="text-center py-10">
            <p className="text-hud-error text-2xl mb-3" style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 400 }}>OFFLINE</p>
            <p className="hud-label mb-5 text-hud-text">{error}</p>
            <div className="hud-label opacity-60 space-y-2">
              <p>Start the system:</p>
              <code className="block text-hud-primary text-base">./start.sh</code>
              <p className="text-[9px] opacity-60 pt-1">or individually:</p>
              <code className="block text-hud-text-dim text-[10px]">npm run dev</code>
              <code className="block text-hud-text-dim text-[10px]">node scripts/run.mjs momentum-breakout</code>
              <code className="block text-hud-text-dim text-[10px]">node scripts/run.mjs orb</code>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-hud-bg transition-colors duration-500">
      {/* drifting amber scanline */}
      <div className="nw-scanline" />

      <div className="max-w-[1920px] mx-auto p-4">

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5 pb-4 border-b border-hud-line/60">
          <div className="flex items-center gap-5">
            {/* Brand */}
            <div>
              <div className="flex items-baseline gap-3">
                <h1
                  className="nw-brand leading-none"
                  style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 400, fontSize: 'clamp(2rem, 4vw, 3.2rem)', letterSpacing: '0.06em' }}
                >
                  NIGHTWATCHER
                </h1>
                <span className="hud-label text-hud-primary border border-hud-primary/50 px-1.5 py-0.5 shrink-0">V3</span>
              </div>
              <p className="hud-label mt-1" style={{ letterSpacing: '0.22em', opacity: 0.38 }}>
                AUTONOMOUS TRADING OPERATIONS
              </p>
            </div>

            {/* Market status */}
            <div className="flex items-center gap-2 pl-5 border-l border-hud-line">
              {isMarketOpen ? (
                <>
                  <div className="nw-live-dot" />
                  <span className="hud-label text-hud-success">MARKET OPEN</span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-sm bg-hud-dim" />
                  <span className="hud-label">MARKET CLOSED</span>
                </>
              )}
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBar items={[
              { label: 'LLM COST', value: `$${costs.total_usd.toFixed(4)}`, status: costs.total_usd > 1 ? 'warning' : 'active' },
              { label: 'CALLS', value: costs.calls.toString() },
            ]} />
            <div className="h-3 w-px bg-hud-line" />
            <NotificationBell overnightActivity={status?.overnightActivity} premarketPlan={status?.premarketPlan} />
            <button
              className="hud-label hover:text-hud-primary transition-colors"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
            <button className="hud-label hover:text-hud-primary transition-colors" onClick={() => setShowSettings(true)}>
              [CONFIG]
            </button>
            <div className="h-3 w-px bg-hud-line" />
            <span className="hud-value-sm text-hud-primary" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {time.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        </header>

        {/* ── GRID ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-3">

          {/* ╔═ ROW 1: Account · Positions · LLM ═════════════════════╗ */}

          {/* Account */}
          <div className="col-span-4 md:col-span-4 lg:col-span-3">
            <Panel title="ACCOUNT" className="h-full">
              {account ? (
                <div className="space-y-4">
                  <Metric label="EQUITY" value={formatCurrency(account.equity)} size="xl" />
                  <div className="grid grid-cols-2 gap-3">
                    <Metric label="CASH" value={formatCurrency(account.cash)} size="md" />
                    <Metric label="BUYING POWER" value={formatCurrency(account.buying_power)} size="md" />
                  </div>
                  <div className="pt-2 border-t border-hud-line/40 space-y-2">
                    <Metric
                      label="TOTAL P&L"
                      value={`${formatCurrency(totalPl)} (${formatPercent(totalPlPct)})`}
                      size="md"
                      color={totalPl >= 0 ? 'success' : 'error'}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <MetricInline label="REALIZED"   value={formatCurrency(realizedPl)}   color={realizedPl >= 0 ? 'success' : 'error'} />
                      <MetricInline label="UNREALIZED" value={formatCurrency(unrealizedPl)}  color={unrealizedPl >= 0 ? 'success' : 'error'} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="hud-label text-hud-text-dim py-4">Loading…</div>
              )}
            </Panel>
          </div>

          {/* Positions */}
          <div className="col-span-4 md:col-span-4 lg:col-span-5">
            <Panel title="POSITIONS" titleRight={`${positions.length}/${config?.max_positions || 5}`} className="h-full">
              {positions.length === 0 ? (
                <div className="hud-label text-hud-text-dim py-8 text-center">No open positions</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-hud-line/40">
                        <th className="hud-label text-left py-2 px-2">Symbol</th>
                        <th className="hud-label text-right py-2 px-2 hidden sm:table-cell">Qty</th>
                        <th className="hud-label text-right py-2 px-2 hidden md:table-cell">Value</th>
                        <th className="hud-label text-right py-2 px-2">P&amp;L</th>
                        <th className="hud-label text-center py-2 px-2">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos: Position) => {
                        const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100
                        const priceHistory = positionPriceHistories[pos.symbol] || []
                        const posEntry = status?.positionEntries?.[pos.symbol]
                        const staleness = status?.stalenessAnalysis?.[pos.symbol]
                        const holdTime = posEntry ? Math.floor((Date.now() - posEntry.entry_time) / 3_600_000) : null
                        return (
                          <motion.tr
                            key={pos.symbol}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="border-b border-hud-line/15 hover:bg-hud-line/10 transition-colors"
                          >
                            <td className="hud-value-sm py-2 px-2">
                              <Tooltip position="right" content={
                                <TooltipContent
                                  title={pos.symbol}
                                  items={[
                                    { label: 'Entry Price',    value: posEntry ? formatCurrency(posEntry.entry_price) : 'N/A' },
                                    { label: 'Current Price',  value: formatCurrency(pos.current_price) },
                                    { label: 'Hold Time',      value: holdTime !== null ? `${holdTime}h` : 'N/A' },
                                    { label: 'Entry Sentiment',value: posEntry ? `${(posEntry.entry_sentiment * 100).toFixed(0)}%` : 'N/A' },
                                    ...(staleness ? [{ label: 'Staleness', value: `${(staleness.score * 100).toFixed(0)}%`, color: staleness.shouldExit ? 'text-hud-error' : 'text-hud-text' }] : []),
                                  ]}
                                  description={posEntry?.entry_reason}
                                />
                              }>
                                <span className="cursor-help border-b border-dotted border-hud-text-dim">
                                  {isCryptoSymbol(pos.symbol, config?.crypto_symbols) && <span className="text-hud-warning mr-1">₿</span>}
                                  {pos.symbol}
                                </span>
                              </Tooltip>
                            </td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden sm:table-cell">{pos.qty}</td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden md:table-cell">{formatCurrency(pos.market_value)}</td>
                            <td className={clsx('hud-value-sm text-right py-2 px-2', pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                              <div>{formatCurrency(pos.unrealized_pl)}</div>
                              <div className="text-xs opacity-70">{formatPercent(plPct)}</div>
                            </td>
                            <td className="py-2 px-2">
                              <div className="flex justify-center">
                                <Sparkline data={priceHistory} width={60} height={20} />
                              </div>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          {/* LLM Costs */}
          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="LLM COSTS" className="h-full">
              <div className="grid grid-cols-2 gap-4">
                <Metric label="TOTAL SPENT" value={`$${costs.total_usd.toFixed(4)}`} size="lg" />
                <Metric label="API CALLS"   value={costs.calls.toString()} size="lg" />
                <MetricInline label="TOKENS IN"  value={costs.tokens_in.toLocaleString()} />
                <MetricInline label="TOKENS OUT" value={costs.tokens_out.toLocaleString()} />
                <MetricInline label="AVG / CALL" value={costs.calls > 0 ? `$${(costs.total_usd / costs.calls).toFixed(6)}` : '$0'} />
                <MetricInline label="MODEL"      value={config?.llm_model || 'gpt-oss:20b'} />
                <MetricInline
                  label="PROVIDER"
                  value={(config?.llm_provider || 'ollama').toUpperCase()}
                  valueClassName={
                    config?.llm_provider === 'openai' ? 'text-hud-success' :
                    config?.llm_provider === 'gemini' ? 'text-hud-purple' :
                    'text-hud-cyan'
                  }
                />
              </div>
            </Panel>
          </div>

          {/* ╔═ ROW 2: V3 Intelligence Layer ══════════════════════════╗ */}

          {/* Market Regime */}
          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel
              title="MARKET REGIME"
              titleRight={regime ? (regime.cached ? 'CACHED' : 'LIVE') : '—'}
              className="h-full"
              accentColor={regimeAccent}
              accentGlow={!!regime}
            >
              {regime ? (
                <div className="space-y-3">
                  {/* Regime label */}
                  <div className="flex items-center gap-3 pt-1">
                    <span
                      className={clsx('font-bold tracking-widest', regime.regime === 'crisis' && 'nw-crisis-pulse')}
                      style={{
                        fontFamily: 'Oswald, sans-serif',
                        fontSize: '1.7rem',
                        color: regimeAccent,
                        lineHeight: 1,
                      }}
                    >
                      {REGIME_LABELS[regime.regime]}
                    </span>
                  </div>

                  {/* Confidence bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="hud-label">CONFIDENCE</span>
                      <span className="hud-value-sm" style={{ color: regimeAccent }}>{(regime.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1 bg-hud-dim/40 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${regime.confidence * 100}%`, background: regimeAccent }}
                      />
                    </div>
                  </div>

                  {/* Size multiplier */}
                  <div className="flex justify-between items-center pt-2 border-t border-hud-line/40">
                    <span className="hud-label">SIZE MULTIPLIER</span>
                    <span
                      className="hud-value-sm font-bold"
                      style={{
                        color: regime.position_size_multiplier < 0.5 ? 'var(--color-hud-error)' :
                               regime.position_size_multiplier < 1.0 ? 'var(--color-hud-warning)' :
                               'var(--color-hud-success)',
                      }}
                    >
                      {regime.position_size_multiplier.toFixed(2)}×
                    </span>
                  </div>

                  {/* Raw inputs grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 border-t border-hud-line/40">
                    {regime.adx !== null && <MetricInline label="ADX" value={regime.adx.toFixed(1)} />}
                    {regime.atr_pct !== null && <MetricInline label="ATR%" value={`${regime.atr_pct.toFixed(2)}%`} />}
                    {regime.spy_return_20d !== null && (
                      <MetricInline
                        label="SPY 20D"
                        value={`${regime.spy_return_20d >= 0 ? '+' : ''}${regime.spy_return_20d.toFixed(2)}%`}
                        valueClassName={regime.spy_return_20d >= 0 ? 'text-hud-success' : 'text-hud-error'}
                      />
                    )}
                    {regime.realized_vol_20d !== null && (
                      <MetricInline label="RVOL" value={`${regime.realized_vol_20d.toFixed(1)}%`} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="hud-label text-hud-text-dim py-8 text-center space-y-1">
                  <div>Regime data unavailable</div>
                  <div className="opacity-50 text-[8px]">MCP server must be running</div>
                </div>
              )}
            </Panel>
          </div>

          {/* Quant Risk */}
          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="QUANT RISK" className="h-full">
              {riskMetrics ? (
                <div className="space-y-3">
                  {/* Kelly */}
                  {riskMetrics.kelly ? (
                    <div className="pb-3 border-b border-hud-line/40">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="hud-label">KELLY SIZE</span>
                        <span className={clsx('hud-value-sm font-bold', riskMetrics.kelly.is_positive_edge ? 'text-hud-success' : 'text-hud-error')}>
                          {riskMetrics.kelly.recommended_pct_equity.toFixed(1)}% EQ
                        </span>
                      </div>
                      <div className="flex gap-4">
                        <MetricInline label="WIN RATE" value={`${(riskMetrics.kelly.win_rate * 100).toFixed(0)}%`} />
                        <MetricInline
                          label="EDGE"
                          value={riskMetrics.kelly.edge.toFixed(3)}
                          valueClassName={riskMetrics.kelly.is_positive_edge ? 'text-hud-success' : 'text-hud-error'}
                        />
                        <MetricInline label="ODDS" value={`${riskMetrics.kelly.odds_ratio.toFixed(2)}R`} />
                      </div>
                    </div>
                  ) : (
                    <div className="hud-label pb-3 border-b border-hud-line/40 opacity-40">Kelly — insufficient history</div>
                  )}

                  {/* Sharpe */}
                  {riskMetrics.sharpe ? (
                    <div className="pb-3 border-b border-hud-line/40">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="hud-label">SHARPE RATIO</span>
                        <span className={clsx('hud-value-sm font-bold', getSharpeColor(riskMetrics.sharpe.sharpe_ratio))}>
                          {riskMetrics.sharpe.sharpe_ratio.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex gap-4">
                        <MetricInline
                          label="ANN RET"
                          value={`${riskMetrics.sharpe.annualized_return_pct.toFixed(1)}%`}
                          valueClassName={riskMetrics.sharpe.annualized_return_pct >= 0 ? 'text-hud-success' : 'text-hud-error'}
                        />
                        <MetricInline label="ANN VOL" value={`${riskMetrics.sharpe.annualized_vol_pct.toFixed(1)}%`} />
                      </div>
                    </div>
                  ) : (
                    <div className="hud-label pb-3 border-b border-hud-line/40 opacity-40">Sharpe — insufficient history</div>
                  )}

                  {/* VaR */}
                  {riskMetrics.var ? (
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="hud-label">VAR 95%</span>
                        <span className="hud-value-sm font-bold text-hud-error">
                          ${riskMetrics.var.var_usd.toFixed(0)}
                        </span>
                      </div>
                      <div className="flex gap-4">
                        <MetricInline label="VAR%" value={`${riskMetrics.var.var_pct.toFixed(2)}%`} valueClassName="text-hud-error" />
                        <MetricInline label="CVAR" value={`$${riskMetrics.var.cvar_usd.toFixed(0)}`} valueClassName="text-hud-error" />
                      </div>
                    </div>
                  ) : (
                    <div className="hud-label opacity-40">VaR — insufficient history</div>
                  )}
                </div>
              ) : (
                <div className="hud-label text-hud-text-dim py-8 text-center space-y-1">
                  <div>Risk metrics unavailable</div>
                  <div className="opacity-50 text-[8px]">Requires trade history in D1</div>
                </div>
              )}
            </Panel>
          </div>

          {/* V3 Alpha Signals */}
          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="ALPHA SIGNALS" titleRight={alphaSignals.length > 0 ? alphaSignals.length.toString() : '—'} className="h-full min-h-[200px]">
              <div className="overflow-y-auto h-full space-y-0.5">
                {alphaSignals.length === 0 ? (
                  <div className="hud-label text-hud-text-dim py-8 text-center space-y-1">
                    <div>No alpha signals</div>
                    <div className="opacity-50 text-[8px]">Submit via signal-submit MCP tool</div>
                  </div>
                ) : (
                  alphaSignals.slice(0, 20).map((sig, i) => (
                    <motion.div
                      key={sig.signal_id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.025 }}
                      className="flex items-center justify-between py-1.5 px-2 border-b border-hud-line/10 hover:bg-hud-line/8 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="hud-value-sm shrink-0 text-hud-text-bright">{sig.symbol}</span>
                        <span className="hud-label shrink-0">{getSourceLabel(sig.source)}</span>
                        {(sig.regime_tags?.length ?? 0) > 0 && (
                          <span className="hud-label opacity-50 hidden sm:inline truncate">{sig.regime_tags[0]}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="hud-label opacity-60">{sig.urgency.slice(0, 3).toUpperCase()}</span>
                        <span className={clsx('hud-value-sm font-bold', getDirectionColor(sig.direction))}>
                          {sig.direction === 'long' ? '▲' : sig.direction === 'short' ? '▼' : '—'} {(sig.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </Panel>
          </div>

          {/* ╔═ ROW 3: Portfolio Performance Chart ════════════════════╗ */}

          <div className="col-span-4 md:col-span-8 lg:col-span-8">
            <Panel
              title="PORTFOLIO PERFORMANCE"
              titleRight={
                <div className="flex gap-2">
                  {(['1D', '1W', '1M'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setHistoryPeriod(p)}
                      className={clsx('hud-label hover:text-hud-primary transition-colors', historyPeriod === p ? 'text-hud-primary' : 'opacity-40')}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              }
              className="h-[300px]"
            >
              {portfolioChartData.length > 1 ? (
                <div className="h-full w-full">
                  <LineChart
                    series={[{ label: 'Equity', data: portfolioChartData, variant: totalPl >= 0 ? 'green' : 'red' }]}
                    labels={portfolioChartLabels}
                    showArea showGrid showDots={false}
                    formatValue={v => `$${(v / 1000).toFixed(1)}k`}
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center hud-label text-hud-text-dim">
                  Collecting performance data…
                </div>
              )}
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="POSITION PERFORMANCE" titleRight="% CHANGE" className="h-[300px]">
              {positions.length === 0 ? (
                <div className="h-full flex items-center justify-center hud-label text-hud-text-dim">
                  No positions
                </div>
              ) : normalizedPositionSeries.length > 0 ? (
                <div className="h-full flex flex-col">
                  <div className="flex flex-wrap gap-3 mb-2 pb-2 border-b border-hud-line/30 shrink-0">
                    {positions.slice(0, 5).map((pos: Position, idx) => {
                      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100
                      const color = positionColors[idx % positionColors.length]
                      return (
                        <div key={pos.symbol} className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `var(--color-hud-${color})` }} />
                          <span className="hud-value-sm">{pos.symbol}</span>
                          <span className={clsx('hud-label', pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                            {formatPercent(plPct)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex-1 min-h-0 w-full">
                    <LineChart
                      series={normalizedPositionSeries.slice(0, 5)}
                      showArea={false} showGrid showDots={false} animated={false}
                      formatValue={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center hud-label text-hud-text-dim">
                  Loading position data…
                </div>
              )}
            </Panel>
          </div>

          {/* ╔═ ROW 4: Signals · Activity Feed · Research ═════════════╗ */}

          {/* Active Signals (V2 sentiment) */}
          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVE SIGNALS" titleRight={signals.length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-px">
                {signals.length === 0 ? (
                  <div className="hud-label text-hud-text-dim py-6 text-center">Gathering signals…</div>
                ) : (
                  signals.slice(0, 20).map((sig: Signal, i) => (
                    <Tooltip key={`${sig.symbol}-${sig.source}-${i}`} position="right" content={
                      <TooltipContent
                        title={`${sig.symbol} — ${sig.source.toUpperCase()}`}
                        items={[
                          { label: 'Sentiment', value: `${(sig.sentiment * 100).toFixed(0)}%`, color: getSentimentColor(sig.sentiment) },
                          { label: 'Volume', value: sig.volume },
                          ...(sig.bullish !== undefined ? [{ label: 'Bullish', value: sig.bullish, color: 'text-hud-success' }] : []),
                          ...(sig.bearish !== undefined ? [{ label: 'Bearish', value: sig.bearish, color: 'text-hud-error' }] : []),
                          ...(sig.score !== undefined ? [{ label: 'Score', value: sig.score }] : []),
                          ...(sig.momentum !== undefined ? [{ label: 'Momentum', value: `${sig.momentum >= 0 ? '+' : ''}${sig.momentum.toFixed(2)}%` }] : []),
                          ...(sig.price !== undefined ? [{ label: 'Price', value: formatCurrency(sig.price) }] : []),
                        ]}
                        description={sig.reason}
                      />
                    }>
                      <motion.div
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={clsx(
                          'flex items-center justify-between py-1 px-2 border-b border-hud-line/10 hover:bg-hud-line/8 cursor-help transition-colors',
                          sig.isCrypto && 'bg-hud-warning/5'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {sig.isCrypto && <span className="text-hud-warning text-xs">₿</span>}
                          <span className="hud-value-sm text-hud-text-bright">{sig.symbol}</span>
                          <span className={clsx('hud-label', sig.isCrypto ? 'text-hud-warning' : '')}>{sig.source.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {sig.isCrypto && sig.momentum !== undefined ? (
                            <span className={clsx('hud-label hidden sm:inline', sig.momentum >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                              {sig.momentum >= 0 ? '+' : ''}{sig.momentum.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="hud-label hidden sm:inline opacity-50">VOL {sig.volume}</span>
                          )}
                          <span className={clsx('hud-value-sm font-bold', getSentimentColor(sig.sentiment))}>
                            {(sig.sentiment * 100).toFixed(0)}%
                          </span>
                        </div>
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>

          {/* Activity Feed */}
          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVITY FEED" titleRight={<div className="flex items-center gap-1.5"><div className="nw-live-dot" /><span className="hud-label text-hud-success">LIVE</span></div>} className="h-80">
              <div className="overflow-y-auto h-full font-mono text-xs space-y-0.5">
                {logs.length === 0 ? (
                  <div className="hud-label text-hud-text-dim py-6 text-center">Waiting for activity…</div>
                ) : (
                  logs.slice(-50).map((log: LogEntry, i) => (
                    <motion.div
                      key={`${log.timestamp}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-start gap-2 py-1 border-b border-hud-line/8"
                    >
                      <span className="text-hud-text-dim shrink-0 hidden sm:inline w-[52px]">
                        {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                      <span className={clsx('shrink-0 w-[72px] text-right', getAgentColor(log.agent))}>
                        {log.agent}
                      </span>
                      <span className="text-hud-text flex-1 text-right break-words">
                        {log.action}
                        {log.symbol && <span className="text-hud-primary ml-1">({log.symbol})</span>}
                      </span>
                    </motion.div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </Panel>
          </div>

          {/* Signal Research */}
          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="SIGNAL RESEARCH" titleRight={Object.keys(status?.signalResearch || {}).length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-2">
                {Object.entries(status?.signalResearch || {}).length === 0 ? (
                  <div className="hud-label text-hud-text-dim py-6 text-center">Researching candidates…</div>
                ) : (
                  Object.entries(status?.signalResearch || {}).map(([symbol, research]: [string, SignalResearch]) => (
                    <Tooltip key={symbol} position="left" content={
                      <div className="space-y-2 min-w-[200px]">
                        <div className="hud-label text-hud-primary border-b border-hud-line/50 pb-1">{symbol} DETAILS</div>
                        <div className="space-y-1">
                          <div className="flex justify-between"><span className="text-hud-text-dim">Confidence</span><span className="text-hud-text-bright">{(research.confidence * 100).toFixed(0)}%</span></div>
                          <div className="flex justify-between"><span className="text-hud-text-dim">Sentiment</span><span className={getSentimentColor(research.sentiment)}>{(research.sentiment * 100).toFixed(0)}%</span></div>
                          <div className="flex justify-between"><span className="text-hud-text-dim">Analyzed</span><span className="text-hud-text">{new Date(research.timestamp).toLocaleTimeString('en-US', { hour12: false })}</span></div>
                        </div>
                        {research.catalysts.length > 0 && (
                          <div className="pt-1 border-t border-hud-line/30">
                            <span className="text-[9px] text-hud-text-dim">CATALYSTS:</span>
                            <ul className="mt-1 space-y-0.5">{research.catalysts.map((c, i) => <li key={i} className="text-[10px] text-hud-success">+ {c}</li>)}</ul>
                          </div>
                        )}
                        {research.red_flags.length > 0 && (
                          <div className="pt-1 border-t border-hud-line/30">
                            <span className="text-[9px] text-hud-text-dim">RED FLAGS:</span>
                            <ul className="mt-1 space-y-0.5">{research.red_flags.map((f, i) => <li key={i} className="text-[10px] text-hud-error">− {f}</li>)}</ul>
                          </div>
                        )}
                      </div>
                    }>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-2 border border-hud-line/25 hover:border-hud-line/50 cursor-help transition-colors"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="hud-value-sm text-hud-text-bright">{symbol}</span>
                          <div className="flex items-center gap-2">
                            <span className={clsx('hud-label', getQualityColor(research.entry_quality))}>
                              {research.entry_quality.toUpperCase()}
                            </span>
                            <span className={clsx('hud-value-sm font-bold', getVerdictColor(research.verdict))}>
                              {research.verdict}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-hud-text-dim leading-tight mb-1">{research.reasoning}</p>
                        {research.red_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {research.red_flags.slice(0, 2).map((flag, i) => (
                              <span key={i} className="text-xs text-hud-error bg-hud-error/10 px-1">
                                {flag.slice(0, 30)}…
                              </span>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>

        </div>{/* /grid */}

        {/* ── FOOTER ─────────────────────────────────────────────────── */}
        <footer className="mt-4 pt-3 border-t border-hud-line/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex flex-wrap gap-4 md:gap-5">
            {config && (
              <>
                <MetricInline label="MAX POS"    value={`$${config.max_position_value}`} />
                <MetricInline label="MIN SENT"   value={`${(config.min_sentiment_score * 100).toFixed(0)}%`} />
                <MetricInline label="TAKE PROFIT" value={`${config.take_profit_pct}%`} />
                <MetricInline label="STOP LOSS"  value={`${config.stop_loss_pct}%`} />
                <span className="hidden lg:inline text-hud-line">│</span>
                <MetricInline
                  label="OPTIONS"
                  value={config.options_enabled ? 'ON' : 'OFF'}
                  valueClassName={config.options_enabled ? 'text-hud-purple' : 'opacity-40'}
                />
                {config.options_enabled && (
                  <>
                    <MetricInline label="OPT Δ"   value={config.options_target_delta?.toFixed(2) || '0.35'} />
                    <MetricInline label="OPT DTE" value={`${config.options_min_dte || 7}–${config.options_max_dte || 45}`} />
                  </>
                )}
                <span className="hidden lg:inline text-hud-line">│</span>
                <MetricInline
                  label="CRYPTO"
                  value={config.crypto_enabled ? '24/7' : 'OFF'}
                  valueClassName={config.crypto_enabled ? 'text-hud-warning' : 'opacity-40'}
                />
                {config.crypto_enabled && (
                  <MetricInline label="SYMBOLS" value={(config.crypto_symbols || ['BTC', 'ETH', 'SOL']).map(s => s.split('/')[0]).join('/')} />
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            {regime && (
              <span className="hud-label hidden md:inline" style={{ color: regimeAccent }}>
                {REGIME_LABELS[regime.regime]}
              </span>
            )}
            <span className="hidden md:inline text-hud-line">│</span>
            <span className="hud-label hidden md:inline opacity-40">AUTONOMOUS TRADING SYSTEM</span>
            <span
              className="hud-label text-hud-primary border border-hud-primary/30 px-1.5 py-0.5"
              style={{ letterSpacing: '0.15em' }}
            >
              PAPER MODE
            </span>
          </div>
        </footer>

      </div>{/* /max-w */}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSettings && config && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SettingsModal config={config} onSave={handleSaveConfig} onClose={() => setShowSettings(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
