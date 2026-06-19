# Strategy Card 07 — Portfolio Hedge (SPY Short Overlay)

**Status:** Forward Testing (live paper since 2026-05-12)

---

## Hypothesis

When the portfolio is carrying significant long equity exposure (≥ $1,500 notional) in a bearish or high-volatility regime, unhedged directional risk is excessive. A short SPY overlay mechanically reduces net long exposure without requiring the directional strategies to close their positions. SPY is chosen as the hedge instrument because it has the highest liquidity, tightest spreads, and direct correlation to the broad equity beta of the portfolio.

---

## Rules

| | |
|---|---|
| **Hedge instrument** | SPY (short) |
| **Scan time** | 10:00 AM ET (once daily) |
| **Activation signal** | Net long exposure ≥ $1,500 AND regime in [bearish, high_volatility, crisis] |
| **Entry** | Short SPY, $500 notional |
| **Deactivation signal** | Net long exposure drops below $800 OR regime normalizes |
| **Exit** | Cover SPY short |
| **Time exit** | 3:30 PM ET (cover regardless of conditions) |
| **Poll interval** | Every 15 minutes after activation |

---

## Activation Logic

```
IF net_long_exposure > $1,500
AND regime IN [bearish, high_volatility, crisis]
AND no hedge currently active
→ Enter short SPY $500 notional

IF hedge active AND (net_long_exposure < $800 OR regime NOT IN hedge_regimes)
→ Cover SPY short
```

The hedge is a binary overlay — either on or off. It does not scale with exposure beyond the initial $500 position.

---

## Portfolio Context

This strategy runs as an **overlay** alongside the directional strategies (ORB, Gap & Go, Momentum Breakout). It does not compete for position slots with those strategies — the max_positions limit applies only to directional trades. The hedge position is tracked separately.

**Requires:** Short selling / margin enabled on the Alpaca account.

---

## Regime Triggers

| Regime | Hedge Active? |
|---|---|
| `trending_bull` | No |
| `low_volatility` | No |
| `range_bound` | No |
| `trending_bear` | Yes |
| `high_volatility` | Yes |
| `crisis` | Yes |

---

## Backtest Results

*Portfolio overlay — not independently backtested.*

The hedge is a risk-management mechanism, not an alpha-generating strategy. Its value is measured in reduced drawdown during adverse regimes, not standalone Sharpe ratio.

---

## Forward Test Metrics to Track

- Activation frequency: how often the hedge triggers (expect 0–2 activations/week)
- Regime correlation: does hedge activate correctly during adverse market periods?
- Net portfolio drawdown with hedge vs without (primary success metric)
- False activation rate: hedge activates but market recovers same day

---

## Adjustment Trigger (2026-06-23)

If hedge never activates (6 weeks of only bullish regime) → no change, correct behavior  
If hedge activates too frequently → raise long_exposure_threshold from $1,500 to $2,000  
If hedge activates but portfolio is still underwater → increase hedge notional from $500 to $800
