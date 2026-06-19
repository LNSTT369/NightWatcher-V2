# Strategy Card 03 — Mean Reversion (SMA-20)

**Status:** Forward Testing (live paper since 2026-05-12)

---

## Hypothesis

Large-cap liquid stocks that dip ≥ 3% below their 20-day SMA with RSI in oversold territory are statistically likely to revert to the mean. In range-bound and high-volatility regimes (no clear trend), this reversion is faster and more reliable than in trending markets. The 20-day SMA acts as a gravitational target with high hit rate.

---

## Rules

| | |
|---|---|
| **Universe** | AAPL, MSFT, NVDA, AMZN, META, GOOGL |
| **Scan times** | 10:30 AM, 12:00 PM, 1:30 PM ET |
| **Entry signal** | Price ≥ 3.0% below 20-day SMA AND RSI ≤ 40 |
| **Entry** | Market long |
| **Direction** | Long only |
| **Stop** | Entry × (1 − 3.0%) — same as deviation threshold |
| **Target** | 20-day SMA value at time of entry |
| **Time exit** | 3:30 PM ET |
| **Max positions** | 2 concurrent |
| **Sizing** | $500 notional per trade |

---

## Filters

1. **SMA deviation** — Price must be ≥ 3% below SMA-20 (not just a minor dip)
2. **RSI** — RSI(14) ≤ 40 (oversold confirmation, avoids catching falling knives in downtrends)
3. **Regime gate** — Only active in `range_bound` or `high_volatility` regimes. Skipped entirely in `trending_bull` and `trending_bear` (mean reversion fails in strong trends)

---

## Backtest Results

*No historical backtest completed. Forward test data accumulating from 2026-05-12.*

Strategy type validation: SMA-20 reversion with RSI confirmation on large-cap tech is a well-documented pattern. Expected Sharpe 0.5–1.0 in non-trending regimes. Internal backtest on the 6-week review roadmap.

---

## Forward Test Metrics to Track

- Setup frequency per week (expect 2–5 qualifying entries across 6 names)
- Regime hit rate: how often the system is in `range_bound` / `high_volatility`
- Win rate to SMA target (expect 55–65%)
- Average time to target (intraday vs multi-day)

---

## Adjustment Trigger (2026-06-23)

If setup frequency is too low → reduce SMA deviation to 2.5%  
If win rate is below 45% → add volume confirmation (above-average volume on dip)  
If regime is persistently `trending_bull` → strategy correctly sits out; no change needed
