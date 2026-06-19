# Strategy Card 06 — VWAP Reversion

**Status:** Forward Testing (live paper since 2026-05-12)

---

## Hypothesis

VWAP (Volume-Weighted Average Price) is the institutional benchmark. Market makers and large funds constantly push price back toward VWAP throughout the session. When a stock dips ≥ 1.5% below VWAP with RSI oversold, it has moved too far from the institutional anchor. The reversion to VWAP is a high-probability intraday mean-reversion trade that typically completes within 1–3 hours.

---

## Rules

| | |
|---|---|
| **Universe** | AAPL, MSFT, NVDA, AMZN, META, GOOGL, SPY, QQQ |
| **Scan times** | 10:00 AM, 11:00 AM, 12:00 PM, 1:00 PM, 2:00 PM ET |
| **Entry signal** | Price ≥ 1.5% below VWAP AND RSI(14) ≤ 42 |
| **Entry** | Market long |
| **Direction** | Long only |
| **Stop** | Same distance below entry as the VWAP deviation (symmetric risk) |
| **Target** | VWAP value at time of entry |
| **Time exit** | 3:00 PM ET (all positions closed) |
| **Max positions** | 2 concurrent |
| **Sizing** | $500 notional per trade |

---

## Filters

1. **VWAP deviation** — ≥ 1.5% below intraday VWAP (computed from all bars since 9:30 AM using high+low+close ÷ 3, volume-weighted)
2. **RSI** — RSI(14) ≤ 42 (oversold, not just a small dip)
3. **Regime gate** — Active in `range_bound`, `high_volatility`, `low_volatility`. Skipped in `trending_bear` (VWAP reversion fails when price is in sustained downtrend)
4. **Time window** — No new entries after 2:00 PM ET (allows time to reach VWAP before 3:00 PM close)

---

## VWAP Calculation

VWAP is computed fresh at each scan using all intraday 1-hour bars since 9:30 AM:

```
VWAP = Σ(typical_price × volume) / Σ(volume)
typical_price = (high + low + close) / 3
```

This is the same VWAP used by institutional desks as an execution benchmark.

---

## Backtest Results

*No historical backtest completed. Forward test data accumulating from 2026-05-12.*

VWAP reversion is one of the most documented intraday patterns. Academic studies show 55–65% win rate to VWAP target with 1.5–2% deviation entry on large-cap equities. Internal backtest on 6-week review roadmap.

---

## Forward Test Metrics to Track

- Setup frequency per day (expect 1–3 across 8 names)
- Win rate to VWAP target (expect 55–65%)
- Average time to target (30 min to 2 hours expected)
- Regime distribution at time of entry

---

## Adjustment Trigger (2026-06-23)

If setup frequency is too low → reduce deviation threshold to 1.2%  
If win rate is below 45% → add volume spike confirmation (above 2× avg bar volume on dip bar)  
If too many positions hit time exit without reaching VWAP → tighten entry to 2.0% deviation
