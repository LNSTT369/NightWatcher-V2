/**
 * MEAN REVERSION (SMA-20 Bollinger Proxy)
 *
 * Scans for stocks trading >= sma_deviation_pct% below their 20-day SMA
 * with RSI in oversold territory. Enters long and targets a full reversion
 * to the SMA. Only operates in range_bound and high_volatility regimes.
 *
 * Target: 20-day SMA. Stop: entry × (1 - sma_deviation_pct%).
 * Polls every 5 min after entry. Time exit: 3:30 PM ET.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8"));

export const meta = {
  name: "Mean Reversion",
  description: "SMA-20 deviation + RSI oversold. Range/vol regimes only.",
  scanTimes: [
    { hour: 10, minute: 30 },
    { hour: 12, minute: 0 },
    { hour: 13, minute: 30 },
  ],
  stopTime: { hour: 15, minute: 59 },
};

const monitors = new Map();

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
      state.log("REGIME", "Not in allowed list (need range_bound or high_volatility) — skip");
      state.skippedRegime++;
      return;
    }
  }

  state.log("SCAN", `Scanning ${cfg.watchlist.join(", ")}`);

  for (const symbol of cfg.watchlist) {
    if (state.traded.has(symbol)) continue;
    if (state.positionsOpened >= cfg.max_positions) break;

    const res = await t(client, "signals-get", { symbol, timeframe: "1Day" });
    if (!res.ok) continue;

    const tech = res.data.technicals;
    const price = tech?.price;
    const sma20 = tech?.sma_20;
    const rsi = tech?.rsi_14;

    if (!price || !sma20) continue;

    const deviationPct = ((sma20 - price) / sma20) * 100;
    const belowSma = deviationPct >= cfg.sma_deviation_pct;
    const rsiOk = rsi != null && rsi < cfg.rsi_oversold;

    state.log("MR", `${symbol} price=$${price?.toFixed(2)} sma20=$${sma20?.toFixed(2)} dev=${deviationPct?.toFixed(2)}%`, {
      rsi: rsi?.toFixed(1),
    });

    if (!belowSma || !rsiOk) continue;

    state.log("SIGNAL", `${symbol} — ${deviationPct.toFixed(2)}% below SMA20, RSI ${rsi.toFixed(1)}`);

    const qty = Math.max(1, Math.floor(cfg.notional_per_trade / price));
    const stopPrice = price * (1 - cfg.sma_deviation_pct / 100);
    const targetPrice = sma20;

    await t(client, "signal-submit", {
      source: "technical", symbol, asset_class: "equity",
      direction: "long", confidence: 0.70,
      urgency: "session", horizon: 90,
      rationale: `Mean reversion. $${deviationPct.toFixed(2)}% below SMA20 ($${sma20.toFixed(2)}). RSI ${rsi.toFixed(1)}.`,
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
        state.log("EXIT", `${symbol} target (SMA20) hit @ $${price.toFixed(2)}`);
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
  state.log("SUMMARY", `Positions opened: ${state.positionsOpened} | Empty scans: ${state.emptyScan} | Regime skips: ${state.skippedRegime}`);
  for (const f of state.fills) {
    state.log("FILL", `${f.symbol} ×${f.qty} @ $${f.price?.toFixed(2)}`);
  }
}
