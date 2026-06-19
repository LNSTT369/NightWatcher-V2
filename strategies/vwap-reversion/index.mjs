/**
 * VWAP REVERSION
 *
 * Intraday mean-reversion strategy. Scans hourly for stocks trading
 * >= deviation_pct% below VWAP with RSI in oversold territory.
 * Entry: long. Target: VWAP level. Stop: same distance below entry.
 * Polls every 5 min after entry. Time exit: 3:00 PM ET.
 * Allowed regimes: range_bound, high_volatility, low_volatility.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8"));

export const meta = {
  name: "VWAP Reversion",
  description: "Intraday mean-reversion to VWAP. Long only. RSI + deviation filter.",
  scanTimes: [
    { hour: 10, minute: 0 },
    { hour: 11, minute: 0 },
    { hour: 12, minute: 0 },
    { hour: 13, minute: 0 },
    { hour: 14, minute: 0 },
  ],
  stopTime: { hour: 15, minute: 30 },
};

const monitors = new Map(); // symbol → interval handle

async function t(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

function computeVwap(bars) {
  let pv = 0, vol = 0;
  for (const b of bars) {
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v;
    vol += b.v;
  }
  return vol > 0 ? pv / vol : null;
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

export async function scan(client, state) {
  if (state.positionsOpened >= cfg.max_positions) {
    state.log("SCAN", `At max positions (${cfg.max_positions}) — skip`);
    return;
  }

  const regime = await t(client, "regime-detect", { force_refresh: false });
  if (regime.ok) {
    state.lastRegime = regime.data.regime;
    state.log("REGIME", regime.data.regime);
    if (!cfg.allowed_regimes.includes(regime.data.regime)) {
      state.log("REGIME", "Not in allowed list — skip scan");
      state.skippedRegime++;
      return;
    }
  }

  state.log("SCAN", `Scanning ${cfg.watchlist.join(", ")}`);

  for (const symbol of cfg.watchlist) {
    if (state.traded.has(symbol)) continue;
    if (state.positionsOpened >= cfg.max_positions) break;

    const barsRes = await t(client, "prices-bars", { symbol, timeframe: "5Min", limit: 79 });
    if (!barsRes.ok || !barsRes.data.bars?.length) continue;

    const bars5m = barsRes.data.bars;
    const vwap = computeVwap(bars5m);
    const price = bars5m[bars5m.length - 1]?.c;
    if (!price || !vwap) continue;

    const techRes = await t(client, "signals-get", { symbol, timeframe: "5Min" });
    const rsi = techRes.ok ? techRes.data?.technicals?.rsi_14 : null;

    const deviationPct = ((vwap - price) / vwap) * 100;
    const isUndervwap = deviationPct >= cfg.deviation_pct;
    const rsiOk = rsi == null || rsi < cfg.rsi_oversold;

    state.log("VWAP", `${symbol} price=$${price.toFixed(2)} vwap=$${vwap.toFixed(2)} dev=${deviationPct.toFixed(2)}%`, {
      rsi: rsi?.toFixed(1),
    });

    if (!isUndervwap || !rsiOk) continue;

    state.log("SIGNAL", `${symbol} — ${deviationPct.toFixed(2)}% below VWAP, RSI ${rsi?.toFixed(1)}`);

    const qty = Math.max(1, Math.floor(cfg.notional_per_trade / price));
    const stopPrice = price - (vwap - price);
    const targetPrice = vwap;

    await t(client, "execution-sor-route", {
      symbol, side: "buy", total_qty: qty,
      notional_usd: cfg.notional_per_trade, urgency: "session",
      signal_source: "technical",
    });

    await t(client, "signal-submit", {
      source: "technical", symbol, asset_class: "equity",
      direction: "long", confidence: 0.72,
      urgency: "session", horizon: 60,
      rationale: `VWAP reversion. Price $${price.toFixed(2)}, VWAP $${vwap.toFixed(2)}, dev ${deviationPct.toFixed(2)}%.`,
      regime_tags: state.lastRegime ? [state.lastRegime] : [],
      suggested_notional: cfg.notional_per_trade,
    });

    const preview = await t(client, "orders-preview", {
      symbol, side: "buy", qty, order_type: "market", time_in_force: "day",
    });

    if (!preview.ok || !preview.data.policy.allowed) {
      const why = (preview.data?.policy?.violations || []).map(v => v.message || v.rule).join("; ");
      state.log("EXEC", `Blocked: ${why || preview.error?.message}`);
      continue;
    }

    const submit = await t(client, "orders-submit", { approval_token: preview.data.policy.approval_token });
    if (!submit.ok) { state.log("EXEC", `Submit failed: ${submit.error?.message}`); continue; }

    const fillPrice = preview.data.preview.estimated_price ?? price;
    state.log("EXEC", `✓ BUY ${qty} ${symbol} @ ~$${fillPrice.toFixed(2)}`, {
      stop: stopPrice.toFixed(2), target: targetPrice.toFixed(2),
    });

    await t(client, "execution-record-fill", {
      alpaca_order_id: submit.data.order.id,
      symbol, side: "buy", qty,
      fill_price: fillPrice, expected_price: price,
      venue: "alpaca", algo_type: "market",
    });

    state.traded.add(symbol);
    state.positionsOpened++;
    state.fills.push({ symbol, qty, price: fillPrice, stop: stopPrice, target: targetPrice, order_id: submit.data.order.id, time: new Date().toISOString() });

    startMonitor(client, state, symbol, fillPrice, stopPrice, targetPrice);
  }

  if (state.positionsOpened === 0) state.emptyScan++;
}

function startMonitor(client, state, symbol, entry, stop, target) {
  if (monitors.has(symbol)) return;

  const handle = setInterval(async () => {
    try {
      const overview = await t(client, "symbol-overview", { symbol });
      if (!overview.ok) return;
      const price = overview.data.latest_price;
      state.log("MONITOR", `${symbol} $${price.toFixed(2)} stop=$${stop.toFixed(2)} target=$${target.toFixed(2)}`);

      if (price >= target) {
        state.log("EXIT", `${symbol} target hit @ $${price.toFixed(2)}`);
        await t(client, "positions-close", { symbol });
        clearInterval(monitors.get(symbol));
        monitors.delete(symbol);
      } else if (price <= stop) {
        state.log("EXIT", `${symbol} stop hit @ $${price.toFixed(2)}`);
        await t(client, "positions-close", { symbol });
        clearInterval(monitors.get(symbol));
        monitors.delete(symbol);
      }
    } catch (err) {
      state.log("MONITOR", `${symbol} error: ${err.message}`);
    }
  }, cfg.poll_interval_ms);

  monitors.set(symbol, handle);

  const msToExit = msUntilET(cfg.time_exit_et.hour, cfg.time_exit_et.minute);
  setTimeout(async () => {
    if (monitors.has(symbol)) {
      clearInterval(monitors.get(symbol));
      monitors.delete(symbol);
      state.log("EXIT", `${symbol} time exit`);
      await t(client, "positions-close", { symbol }).catch(() => {});
    }
  }, msToExit);
}

export function onStop(state) {
  for (const handle of monitors.values()) clearInterval(handle);
  monitors.clear();
  state.log("SUMMARY", `Positions opened: ${state.positionsOpened}`);
  for (const f of state.fills) {
    state.log("FILL", `${f.symbol} ×${f.qty} @ $${f.price?.toFixed(2)} [${f.order_id}]`);
  }
}
