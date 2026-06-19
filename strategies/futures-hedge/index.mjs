/**
 * PORTFOLIO HEDGE — SPY Short Overlay (Phase 5)
 *
 * Monitors total long equity exposure every 15 minutes. If net long exposure
 * exceeds long_exposure_threshold AND the regime is bearish/volatile, enters
 * a short SPY position as a portfolio hedge. Closes the hedge when exposure
 * drops below unhedge_threshold or regime normalizes.
 *
 * This is a portfolio overlay strategy — it runs alongside the directional
 * strategies and provides macro downside protection.
 *
 * Note: Short selling requires margin enabled on the Alpaca account.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8"));

export const meta = {
  name: "Portfolio Hedge",
  description: "SPY short overlay. Activates when long exposure + bearish regime align.",
  scanTimes: [{ hour: 10, minute: 0 }],
  stopTime: { hour: 15, minute: 30 },
};

let pollHandle = null;
let hedgeActive = false;

async function t(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

function msUntilET(hour, minute) {
  const now = new Date();
  const offsetMin = (now.getUTCMonth() + 1) >= 3 && (now.getUTCMonth() + 1) <= 11 ? 240 : 300;
  const etNow = new Date(now.getTime() - offsetMin * 60_000);
  const target = new Date(etNow);
  target.setUTCHours(hour, minute, 0, 0);
  let targetUTC = new Date(target.getTime() + offsetMin * 60_000);
  if (targetUTC <= now) targetUTC = new Date(targetUTC.getTime() + 86_400_000);
  return targetUTC.getTime() - now.getTime();
}

async function assessAndHedge(client, state) {
  // Get current regime
  const regime = await t(client, "regime-detect", { force_refresh: false });
  const currentRegime = regime.ok ? regime.data.regime : null;
  const isHedgeRegime = currentRegime && cfg.hedge_regimes.includes(currentRegime);

  // Get portfolio exposure
  const portfolio = await t(client, "portfolio-get");
  if (!portfolio.ok) return;

  const positions = portfolio.data.positions || [];
  const longExposure = positions
    .filter(p => (p.qty ?? 0) > 0 && p.symbol !== cfg.hedge_symbol)
    .reduce((sum, p) => sum + (p.market_value ?? 0), 0);

  const shortPositions = positions.filter(p => p.symbol === cfg.hedge_symbol && (p.qty ?? 0) < 0);
  hedgeActive = shortPositions.length > 0;

  state.log("HEDGE", `Long exposure: $${longExposure.toFixed(0)} | Regime: ${currentRegime} | Hedge: ${hedgeActive ? "ACTIVE" : "INACTIVE"}`);

  // Enter hedge: exposure over threshold + bearish/volatile regime
  if (!hedgeActive && longExposure >= cfg.long_exposure_threshold && isHedgeRegime) {
    state.log("HEDGE", `Threshold crossed ($${longExposure.toFixed(0)} ≥ $${cfg.long_exposure_threshold}) in ${currentRegime} regime — entering SPY short`);

    await t(client, "signal-submit", {
      source: "technical", symbol: cfg.hedge_symbol, asset_class: "equity",
      direction: "short", confidence: 0.80,
      urgency: "immediate", horizon: 240,
      rationale: `Portfolio hedge. Long exposure $${longExposure.toFixed(0)}. Regime: ${currentRegime}.`,
      regime_tags: [currentRegime],
    });

    const qty = Math.max(1, Math.floor(cfg.hedge_notional / 560)); // SPY ~$560
    const preview = await t(client, "orders-preview", {
      symbol: cfg.hedge_symbol, side: "sell", qty,
      order_type: "market", time_in_force: "day",
    });

    if (!preview.ok || !preview.data.policy.allowed) {
      const why = (preview.data?.policy?.violations || []).map(v => v.message || v.rule).join("; ");
      state.log("HEDGE", `Short blocked: ${why || preview.error?.message}`);
      return;
    }

    const submit = await t(client, "orders-submit", { approval_token: preview.data.policy.approval_token });
    if (submit.ok) {
      hedgeActive = true;
      state.fills.push({ symbol: cfg.hedge_symbol, side: "short", qty, price: preview.data.preview.estimated_price, order_id: submit.data.order.id, time: new Date().toISOString() });
      state.log("EXEC", `✓ SHORT ${qty} ${cfg.hedge_symbol} @ ~$${preview.data.preview.estimated_price?.toFixed(2)} (HEDGE)`);
    }
    return;
  }

  // Close hedge: exposure dropped below threshold OR regime normalized
  if (hedgeActive && (longExposure < cfg.unhedge_threshold || !isHedgeRegime)) {
    const reason = longExposure < cfg.unhedge_threshold ? `exposure $${longExposure.toFixed(0)} < $${cfg.unhedge_threshold}` : `regime ${currentRegime} normalized`;
    state.log("HEDGE", `Closing hedge — ${reason}`);
    const close = await t(client, "positions-close", { symbol: cfg.hedge_symbol });
    if (close.ok) {
      hedgeActive = false;
      state.log("EXEC", `✓ Hedge closed (${reason})`);
    }
  }
}

export async function scan(client, state) {
  await assessAndHedge(client, state);

  if (pollHandle) return;

  state.log("HEDGE", `Starting 15-min exposure monitor`);
  pollHandle = setInterval(async () => {
    try {
      await assessAndHedge(client, state);
    } catch (err) {
      state.log("HEDGE", `Poll error: ${err.message}`);
    }
  }, cfg.poll_interval_ms);

  const msToExit = msUntilET(cfg.time_exit_et.hour, cfg.time_exit_et.minute);
  setTimeout(async () => {
    clearInterval(pollHandle);
    pollHandle = null;
    if (hedgeActive) {
      state.log("HEDGE", "Time exit — closing hedge");
      await t(client, "positions-close", { symbol: cfg.hedge_symbol }).catch(() => {});
      hedgeActive = false;
    }
  }, msToExit);
}

export function onStop(state) {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  state.log("SUMMARY", `Hedge fills: ${state.fills.length}`);
  for (const f of state.fills) {
    state.log("FILL", `${f.side?.toUpperCase()} ${f.qty} ${f.symbol} @ $${f.price?.toFixed(2)}`);
  }
}
