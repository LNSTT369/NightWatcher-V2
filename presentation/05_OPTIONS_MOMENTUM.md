# Strategy Card 05 — Options Momentum

**Status:** Staged — Pending options_enabled policy activation

---

## Hypothesis

The same momentum-breakout signal that drives equity entries (RSI 45–65 + MACD bullish + above SMA-20) can be expressed more efficiently through OTM calls. A 0.35-delta call with 14–45 DTE provides leveraged directional exposure with defined risk (premium paid). In strongly trending, low-volatility regimes the probability of a sustained move justifies the premium cost. Target: 100% gain on premium (2× the call price).

---

## Rules

| | |
|---|---|
| **Universe** | AAPL, MSFT, NVDA, AMZN, META |
| **Scan times** | 9:30 AM, 10:30 AM ET |
| **Entry signal** | RSI(14) 45–65 AND MACD bullish crossover AND price > SMA-20 AND confidence ≥ 0.75 |
| **Entry** | Buy call: delta ≈ 0.35, DTE 14–45 days |
| **Direction** | Long calls only |
| **Stop** | 50% premium loss (contract cut in half) |
| **Target** | 100% premium gain (double the call price) |
| **Time exit** | 3:30 PM ET on day of entry if neither target nor stop hit |
| **Max positions** | 2 concurrent |
| **Sizing** | $200 notional per trade (options premium) |

---

## Filters

1. **Confidence threshold** — 0.75 (higher than equity version — options require higher conviction)
2. **RSI band** — 45–65 (tighter than equity — avoids marginal setups where premium is at risk)
3. **Delta selection** — 0.35 delta balances leverage with probability of profit
4. **DTE window** — 14–45 days avoids gamma risk of near-expiry and theta drag of far-dated options
5. **Regime gate** — `trending_bull` and `low_volatility` only (IV expansion in volatility regimes destroys premium economics)
6. **Policy gate** — `options_enabled: true` must be set in the NIGHTWATCHER policy config

---

## Activation Requirement

Options trading is disabled by default in the policy engine. To activate:

```
policy-update tool → set options_enabled: true
```

Requires explicit policy unlock. Staged for activation after equity momentum backtest is validated at the 6-week checkpoint.

---

## Backtest Results

*No historical backtest completed. This strategy is in staged pre-activation.*

Options backtesting requires tick-level options pricing data. Planned for the institutional data integration phase (post-Richard Kim onboarding).

---

## Forward Test Metrics to Track (post-activation)

- Premium cost vs realized P&L per trade
- Win rate to 100% target (expect 30–40% — offset by 2:1 R:R)
- Average DTE at close
- IV environment at entry (log VIX level per trade)

---

## Adjustment Trigger

Activate only after equity momentum (Strategy 04) shows positive forward test Sharpe at the 6-week review. Options are a leverage layer on a validated signal, not a standalone strategy.
