# Strategy Card 04 — Momentum Breakout

**Status:** Forward Testing (live paper since 2026-05-12)

---

## Hypothesis

Stocks showing RSI in the 40–65 zone (momentum building, not yet overbought) with a bullish MACD crossover and price above the 20-day SMA are entering a technical momentum phase. Buying this setup in bullish and low-volatility regimes captures the early-to-mid stage of an institutional accumulation move. TWAP execution reduces market impact and gets a better average fill than a single market order.

---

## Rules

| | |
|---|---|
| **Universe** | AAPL, MSFT, NVDA, AMZN, META, GOOGL, SPY, QQQ |
| **Scan times** | 9:30 AM, 10:30 AM ET |
| **Entry signal** | RSI(14) 40–65 AND MACD bullish crossover AND price > SMA-20 AND confidence ≥ 0.60 |
| **Entry** | TWAP — 3 equal slices over 30 minutes (10-min intervals) |
| **Direction** | Long only |
| **Stop** | Below SMA-20 at time of entry |
| **Target** | Defined by signal confidence output |
| **Time exit** | 3:59 PM ET |
| **Max positions** | 2 concurrent |
| **Sizing** | $500 notional per trade |

---

## Filters

1. **RSI band** — 40–65 specifically. Below 40 = potential knife catch; above 65 = chase risk
2. **MACD crossover** — Signal line must have crossed bullish within recent bars (not a stale setup)
3. **Above SMA-20** — Price must be above the 20-day SMA (trend confirmation)
4. **Confidence score** — Model confidence ≥ 0.60 required (eliminates marginal setups)
5. **Regime gate** — Active only in `trending_bull`, `low_volatility`, `range_bound`
6. **Per-symbol deduplication** — One trade per symbol per day

---

## Execution: TWAP

TWAP (Time-Weighted Average Price) splits the $500 notional into 3 equal slices executed every 10 minutes. This reduces the risk of a single entry at a bad tick and gets the position on in a way consistent with institutional execution practice.

---

## Backtest Results

*No historical backtest completed. Forward test data accumulating from 2026-05-12.*

RSI + MACD momentum setups on large-cap tech show Sharpe ratios of 0.7–1.3 in back-literature over 2015–2022. Internal backtest on 6-week review roadmap.

---

## Forward Test Metrics to Track

- Signal frequency: qualifying RSI + MACD + SMA setups per week
- TWAP fill quality: average fill vs midpoint at time of entry
- Win rate to target (expect 50–60%)
- Regime distribution: how often `trending_bull` is active

---

## Adjustment Trigger (2026-06-23)

If confidence ≥ 0.60 produces too few signals → lower to 0.55  
If RSI 40–65 window is too tight → widen to 35–70 for exploratory test  
If TWAP execution causes significant slippage → reduce to 2 slices
