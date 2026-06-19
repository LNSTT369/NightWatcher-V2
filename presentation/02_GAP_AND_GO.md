# Strategy Card 02 — Gap & Go

**Status:** Forward Testing (live paper since 2026-05-12)

---

## Hypothesis

Stocks that gap up ≥ 3% from the prior close and hold above the gap in the first 5 minutes of the session have institutional buying pressure behind them. The gap acts as support; failure to fill the gap signals continuation. Entry is early (9:35 AM) to capture the intraday extension before the move exhausts.

---

## Rules

| | |
|---|---|
| **Universe** | AAPL, MSFT, NVDA, AMZN, META, GOOGL, SPY, QQQ |
| **Scan time** | 9:35 AM ET |
| **Entry signal** | Gap up ≥ 3.0% from prior close AND price still above (prior close × 1.025) at 9:35 |
| **Entry** | Market long on confirmation |
| **Direction** | Long only |
| **Stop** | Prior session close (full gap fill = exit) |
| **Target** | Entry + 2.0R × gap size |
| **Time exit** | 11:00 AM ET |
| **Max positions** | 1 per day |
| **Sizing** | $500 notional per trade |

---

## Filters

1. **Gap size** — Minimum 3.0% gap from prior close
2. **Gap hold tolerance** — Price must be within 0.5% of gap-open price at 9:35 (not already filling)
3. **One-and-done** — One trade per day maximum; once a trade is taken, no further scans

---

## Backtest Results

*No historical backtest completed. Forward test data accumulating from 2026-05-12.*

Key reference: academic and practitioner literature shows gap-and-go with ≥3% threshold and tight time exit has Sharpe ratios in the 0.6–1.2 range on large-cap tech over 2015–2023. Internal backtest is on the 6-week review roadmap.

---

## Forward Test Metrics to Track

- Gap frequency: how often watchlist produces a qualifying 3%+ gap (expect 1–3/week)
- Fill rate: what % of gap-up days trigger the hold condition at 9:35
- Win rate at 2.0R target (expect 40–50% for a 2:1 R:R to be profitable)
- Average time-to-exit (target vs time exit split)

---

## Adjustment Trigger (2026-06-23)

If gap frequency is too low → reduce gap threshold to 2.5%  
If win rate is below 35% → tighten hold tolerance or add volume confirmation
