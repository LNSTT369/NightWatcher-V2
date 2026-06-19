# NIGHTWATCHER — Strategy Overview
**System:** NIGHTWATCHER V2 (Cloudflare Workers / Alpaca Paper)  
**Account:** Paper — $100k notional cap, $500 max per position  
**Execution:** Autonomous MCP agent, cron-launched 9:25 AM ET Mon–Fri  
**Policy Engine:** Kill switch, daily loss limit, max open positions, order HMAC approval

---

## Strategy Roster

| # | Strategy | Type | Regime | Status |
|---|---|---|---|---|
| 01 | Opening Range Breakout (ORB) | Momentum | Bull / Neutral | Forward Testing |
| 02 | Gap & Go | Momentum | Any | Forward Testing |
| 03 | Mean Reversion (SMA-20) | Reversion | Range / High Vol | Forward Testing |
| 04 | Momentum Breakout | Trend | Bull / Low Vol | Forward Testing |
| 05 | Options Momentum | Leveraged Trend | Bull / Low Vol | Staged (options disabled) |
| 06 | VWAP Reversion | Intraday Reversion | Range / Vol | Forward Testing |
| 07 | Portfolio Hedge | Overlay | Bear / Crisis | Forward Testing |

---

## Risk Architecture

- All strategies share a single policy engine with hard limits
- Max 3 open positions across all strategies simultaneously
- Every order requires a signed HMAC approval token (5-min TTL)
- Regime filter blocks directional strategies in bear regimes
- Kill switch cancels all orders instantly

---

## Forward Test Schedule

**Go-live:** 2026-05-12  
**Review checkpoint:** 2026-06-23 (6 weeks)  
**Review criteria:** filter pass rate, trade count vs backtest expectation, live Sharpe vs backtest Sharpe
