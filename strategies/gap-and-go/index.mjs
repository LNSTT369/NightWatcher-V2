/**
 * GAP & GO
 *
 * At 9:35 AM ET, scans the watchlist for stocks that gapped up >= gap_min_pct%
 * from the prior session's close and are still holding the gap.
 * Entry: market long on gap hold confirmation.
 * Stop: prior close (full gap fill). Target: entry + rr_ratio × gap_size.
 * Polls every 5 min after entry. Time exit: 11:00 AM ET.
 * One trade per day.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8"));

export const meta = {
  name: "Gap & Go",
  description: ">3% gap up + holding at 9:35 ET. 2:1 R:R. Time exit 11 AM ET.",
  scanTimes: [{ hour: 9, minute: 35 }],
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
  if (state.tradeTaken) {
    state.log("GAP", "Trade already taken today — skip");
    return;
  }

  state.log("SCAN", `Scanning ${cfg.watchlist.length} symbols for gap setups`);

  const candidates = [];

  for (const symbol of cfg.watchlist) {
    const barsRes = await t(client, "prices-bars", { symbol, timeframe: "1Day", limit: 2 });
    if (!barsRes.ok || barsRes.data.bars?.length < 2) continue;

    const bars = barsRes.data.bars;
    const prevClose = bars[bars.length - 2].c;
    const todayOpen = bars[bars.length - 1].o;

    const overview = await t(client, "symbol-overview", { symbol });
    if (!overview.ok) continue;
    const currentPrice = overview.data.latest_price;

    const gapPct = ((todayOpen - prevClose) / prevClose) * 100;
    const gapSize = todayOpen - prevClose;
    const isHolding = currentPrice >= todayOpen * (1 - cfg.gap_hold_tolerance_pct / 100);

    state.log("GAP", `${symbol} gap=${gapPct.toFixed(2)}% price=$${currentPrice?.toFixed(2)} holding=${isHolding}`, {
      prevClose: prevClose?.toFixed(2),
      todayOpen: todayOpen?.toFixed(2),
    });

    if (gapPct < cfg.gap_min_pct || !isHolding) continue;

    candidates.push({ symbol, gapPct, gapSize, currentPrice, prevClose, todayOpen });
  }

  if (!candidates.length) {
    state.log("SCAN", "No gap setups found");
    state.emptyScan++;
    return;
  }

  candidates.sort((a, b) => b.gapPct - a.gapPct);
  const pick = candidates[0];

  state.log("PICK", `${pick.symbol} gap ${pick.gapPct.toFixed(2)}% @ $${pick.currentPrice?.toFixed(2)}`);

  const qty = Math.max(1, Math.floor(cfg.notional_per_trade / pick.currentPrice));
  const stopPrice = pick.prevClose;
  const targetPrice = pick.currentPrice + cfg.rr_ratio * pick.gapSize;

  await t(client, "signal-submit", {
    source: "technical", symbol: pick.symbol, asset_class: "equity",
    direction: "long", confidence: 0.74,
    urgency: "immediate", horizon: 90,
    rationale: `Gap & Go. Gap ${pick.gapPct.toFixed(2)}% from $${pick.prevClose.toFixed(2)} to $${pick.todayOpen.toFixed(2)}. Holding at $${pick.currentPrice.toFixed(2)}.`,
    suggested_notional: cfg.notional_per_trade,
  });

  const preview = await t(client, "orders-preview", {
    symbol: pick.symbol, side: "buy", qty,
    order_type: "market", time_in_force: "day",
  });

  if (!preview.ok || !preview.data.policy.allowed) {
    const why = (preview.data?.policy?.violations || []).map(v => v.message || v.rule).join("; ");
    state.log("EXEC", `Blocked: ${why || preview.error?.message}`);
    return;
  }

  const submit = await t(client, "orders-submit", { approval_token: preview.data.policy.approval_token });
  if (!submit.ok) { state.log("EXEC", `Submit failed: ${submit.error?.message}`); return; }

  const fillPrice = preview.data.preview.estimated_price ?? pick.currentPrice;
  state.log("EXEC", `✓ BUY ${qty} ${pick.symbol} @ ~$${fillPrice.toFixed(2)}`, {
    stop: stopPrice.toFixed(2),
    target: targetPrice.toFixed(2),
    gap_pct: pick.gapPct.toFixed(2),
  });

  await t(client, "execution-record-fill", {
    alpaca_order_id: submit.data.order.id,
    symbol: pick.symbol, side: "buy", qty,
    fill_price: fillPrice, expected_price: pick.currentPrice,
    venue: "alpaca", algo_type: "market",
  });

  state.tradeTaken = true;
  state.trade = { symbol: pick.symbol, qty, entry: fillPrice, stop: stopPrice, target: targetPrice, order_id: submit.data.order.id };
  state.fills.push({ symbol: pick.symbol, qty, price: fillPrice, order_id: submit.data.order.id, time: new Date().toISOString() });

  startMonitor(client, state, pick.symbol, fillPrice, stopPrice, targetPrice);
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
      state.log("EXIT", `${symbol} time exit (11 AM)`);
      await t(client, "positions-close", { symbol }).catch(() => {});
    }
  }, msToExit);
}

export function onStop(state) {
  for (const handle of monitors.values()) clearInterval(handle);
  monitors.clear();
  state.log("SUMMARY", state.tradeTaken
    ? `Trade: ${state.trade?.symbol} ×${state.trade?.qty} @ $${state.trade?.entry?.toFixed(2)}`
    : "No gap setups taken today"
  );
}
