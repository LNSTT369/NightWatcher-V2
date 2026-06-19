# Strategy Card 01 — Opening Range Breakout (ORB)

**Status:** Forward Testing (live paper since 2026-05-12)

---

## Hypothesis

The first 60 minutes of the session establishes the day's structural range. On days where that range is narrow relative to recent history (compressed volatility), a breakout above the high signals institutional commitment to a directional move. High-ADR stocks with above-average opening volume have the fuel to extend the breakout to a meaningful R multiple.

---

## Rules

| | |
|---|---|
| **Universe** | NVDA, TSLA, AMD, NFLX, AMZN, MU, BILI, COIN, PLTR, HOOD, ABNB |
| **Selection criteria** | ADR% ≥ 1.5% (20-day avg daily range / close) |
| **ORB window** | 9:30 – 10:30 AM ET (60-minute range) |
| **Entry** | Price closes above ORB high + 0.1% buffer |
| **Entry cutoff** | No new entries after 12:00 PM ET |
| **Direction** | Long only |
| **Stop** | ORB low |
| **Target** | Per-symbol R (see table below) |
| **Time exit** | 3:55 PM ET (force-close all positions) |
| **Max positions** | 3 concurrent |
| **Sizing** | Risk-anchored: qty = min(risk_$5 ÷ stop_distance, $500 ÷ price) |

### Per-Symbol R Targets

| Symbol | R Target | Rationale |
|---|---|---|
| AMZN | 3.0R | Best backtest Sharpe at 3R |
| NVDA | 1.0R | High frequency, fast mover |
| AMD | 1.0R | Tight structure, quick resolution |
| COIN | 1.5R | Vol-adjusted optimum |
| HOOD | 1.5R | IPO-era momentum profile |
| PLTR | 2.0R | Slower extension, needs room |
| ABNB | 1.5R | Mid-range extension |
| TSLA, NFLX, MU, BILI | 2.0R | Default (no single-symbol backtest) |

---

## Filters (all must pass)

1. **ADR% gate** — 20-day avg range ÷ close ≥ 1.5%. Dead-zone stocks (<1.2%) are skipped.
2. **Narrow Range (NR50)** — Today's ORB range must be in the bottom 50th percentile of the last 20 sessions. Exempt: NVDA, AMD (backtest shows NR hurts both names).
3. **Regime gate** — Skips all longs if regime-detect returns `bearish`.

---

## Backtest Results (Long-Only, Real Volume, Commissions Included)

| Ticker | Scenario | Sharpe | Trades | Net Profit | Period |
|---|---|---|---|---|---|
| TSLA | No Filter, 2.0R | **0.98** | 718 | +$43,423 | 2016–2026 |
| AMZN | No Filter, 1.5R | **0.75** | 760 | +$33,139 | 2016–2026 |
| TSLA | RRVOL 1.2x, 1.0R | 1.10 | 134 | +$5,833 | 2016–2026 |

*100-trade minimum applied. Results on $100k capital, 1% risk per trade.*  
*NVDA, AMD, MU, ABNB: negative long-only on full history. Watchlist retained for regime-filtered live data.*

---

## Forward Test Metrics to Track

- Filter pass rate per week (target: 3–8 setups/week across universe)
- Trade count vs backtest expectation (≈ 2–4 trades/week)
- Live Sharpe vs backtest Sharpe at 6-week checkpoint
- NR filter pass rate per symbol (flag if TSLA/AMZN pass <20% of days)

---

## Adjustment Trigger (2026-06-23)

If after 6 weeks:
- Filter pass rate is too low → loosen NR percentile from 50% to 60%
- TSLA/AMZN trade count is low → check ADR filter thresholds
- Live Sharpe lags backtest by >50% → review execution slippage
