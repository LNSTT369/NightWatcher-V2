/**
 * ORB v2 — Opening Range Breakout (multi-asset, long-only)
 *
 * Backtested spec (12-year, 18-ticker Gemini research + backtest folder):
 *   Long-only  — short-side Sharpe -1.49 on 60m, structurally unprofitable.
 *   60m range  — Sharpe 1.48 vs 1.10 for 15m; filters fake-out trades.
 *   Noon cutoff — signals only valid before 12:00 PM ET.
 *   Per-symbol R — AMZN=3.0, NVDA=1.0, AMD=1.0, COIN=1.5, HOOD=1.5, PLTR=2.0, ABNB=1.5, default=2.0.
 *
 * v2 filters (Gemini-validated):
 *   1. ADR% gate   — 20-day avg daily range % must be ≥1.5%. <1.2% = dead zone, skip.
 *   2. Narrow Range — today's 9:30–10:30 range in bottom 50% of 20d history (coiled spring effect).
 *                     NVDA is exempt: NR slightly hurts NVDA (1.10→1.01 Sharpe in sandbox).
 *   3. Regime gate  — skip longs when regime-detect returns "bearish".
 *
 * Sizing: risk-anchored (risk_per_trade_usd / stop_distance), capped at notional / price.
 *
 * Flow:
 *   1. scan() at 10:30 AM — captures ORB, computes ADR% + range_percentile, fetches regime.
 *   2. 5-min poll — checks each symbol through all 3 filter gates before breakout entry.
 *   3. Per-position monitor — polls stop and per-symbol R target; closes on first hit.
 *   4. Force-close — all open positions liquidated at 3:55 PM ET.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8"));

export const meta = {
  name: "ORB v2 — Opening Range Breakout",
  description: "60m ORB, long-only, per-symbol R, ADR%+NR+Regime filters.",
  scanTimes: [{ hour: 10, minute: 30 }],
  stopTime: { hour: 15, minute: 59 },
};

// symbol → { high, low, range, time, adr_pct, range_percentile }
const orbRanges = new Map();

// symbol → { qty, entry, stop, target, rr, order_id }
const openPositions = new Map();

let pollHandle = null;
let cachedRegime = null; // fetched once per scan day

// ── Core helpers ──────────────────────────────────────────────────────────────

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

function isBeforeEntryCutoff() {
  const now = new Date();
  const offsetMin = (now.getUTCMonth() + 1) >= 3 && (now.getUTCMonth() + 1) <= 11 ? 240 : 300;
  const etNow = new Date(now.getTime() - offsetMin * 60_000);
  const etHour = etNow.getUTCHours();
  const etMin  = etNow.getUTCMinutes();
  return etHour < cfg.entry_cutoff_et.hour ||
    (etHour === cfg.entry_cutoff_et.hour && etMin < cfg.entry_cutoff_et.minute);
}

// ── Filter helpers ────────────────────────────────────────────────────────────

/**
 * Compute 20-day average daily range percent: mean((H-L)/C) × 100.
 * Returns null on error.
 */
async function computeADR(client, symbol) {
  const lookback = cfg.filters.adr.lookback_days + 1;
  const res = await t(client, "prices-bars", { symbol, timeframe: "1Day", limit: lookback });
  if (!res.ok || !res.data.bars?.length) return null;

  const bars = res.data.bars.slice(0, -1); // drop today's incomplete bar
  if (!bars.length) return null;

  const sum = bars.reduce((acc, b) => acc + (b.h - b.l) / b.c, 0);
  return (sum / bars.length) * 100;
}

/**
 * Fetch the 9:30–10:30 range (h - l) for the last N trading days.
 * Looks for hourly bars where the bar closes at 10:30 AM ET (UTC hour depends on DST offset).
 * Returns array of range values (empty on error).
 */
async function fetchHistoricalRanges(client, symbol) {
  const lookback = cfg.filters.narrow_range.lookback_days;
  const limit = lookback * 8; // ~8 regular-session hourly bars per day
  const res = await t(client, "prices-bars", { symbol, timeframe: "1Hour", limit });
  if (!res.ok || !res.data.bars?.length) return [];

  // DST offset: EDT (Mar–Nov) = UTC-4, EST (Dec–Feb) = UTC-5
  const now = new Date();
  const isDST = (now.getUTCMonth() + 1) >= 3 && (now.getUTCMonth() + 1) <= 11;
  const utcHourFor1030ET = isDST ? 14 : 15; // 10:30 ET in UTC

  return res.data.bars
    .filter(b => {
      const barTime = new Date(b.t);
      return barTime.getUTCHours() === utcHourFor1030ET &&
             barTime.getUTCMinutes() === 30;
    })
    .map(b => b.h - b.l);
}

/**
 * Call regime-detect once per session; cache result for the day.
 * Returns "bullish" | "bearish" | "neutral" | null.
 */
async function detectRegime(client, state) {
  if (cachedRegime !== null) return cachedRegime;
  const res = await t(client, "regime-detect", {});
  if (!res.ok) {
    state.log("FILTER", "regime-detect failed — defaulting to neutral");
    cachedRegime = "neutral";
  } else {
    cachedRegime = res.data?.regime ?? "neutral";
    state.log("FILTER", `Regime: ${cachedRegime}`);
  }
  return cachedRegime;
}

// ── Step 1: capture ORB ranges + filter inputs ────────────────────────────────

async function captureRanges(client, state) {
  state.log("ORB", `Capturing 60m opening ranges for: ${cfg.watchlist.join(", ")}`);

  for (const symbol of cfg.watchlist) {
    const res = await t(client, "prices-bars", {
      symbol,
      timeframe: cfg.orb_timeframe,
      limit: 3,
    });

    if (!res.ok || !res.data.bars?.length) {
      state.log("ORB", `${symbol} — failed to fetch bars, skipping`);
      continue;
    }

    const bars  = res.data.bars;
    const orbBar = bars[bars.length - 2] ?? bars[bars.length - 1];

    const range = orbBar.h - orbBar.l;
    if (range <= 0) {
      state.log("ORB", `${symbol} — zero-width range, skipping`);
      continue;
    }

    // Compute filter inputs in parallel
    const [adr_pct, historicalRanges] = await Promise.all([
      cfg.filters.adr.enabled     ? computeADR(client, symbol)              : Promise.resolve(null),
      cfg.filters.narrow_range.enabled ? fetchHistoricalRanges(client, symbol) : Promise.resolve([]),
    ]);

    // Range percentile: fraction of historical ranges ≤ today's range
    let range_percentile = null;
    if (historicalRanges.length >= 5) {
      const below = historicalRanges.filter(r => r <= range).length;
      range_percentile = below / historicalRanges.length;
    }

    orbRanges.set(symbol, {
      high: orbBar.h,
      low:  orbBar.l,
      range,
      time: orbBar.t,
      adr_pct,
      range_percentile,
    });

    state.log("ORB", `${symbol} range captured`, {
      high:             orbBar.h.toFixed(2),
      low:              orbBar.l.toFixed(2),
      range:            range.toFixed(2),
      adr_pct:          adr_pct != null ? `${adr_pct.toFixed(2)}%` : "n/a",
      range_percentile: range_percentile != null ? range_percentile.toFixed(2) : "n/a",
    });
  }
}

// ── Step 2: poll for breakouts (with filter gates) ────────────────────────────

async function checkBreakouts(client, state) {
  const entryOpen = isBeforeEntryCutoff();

  // Regime gate — fetch once per cycle (cached)
  let regime = null;
  if (cfg.filters.regime.enabled) {
    regime = await detectRegime(client, state);
    if (cfg.filters.regime.block_in.includes(regime)) {
      state.log("FILTER", `Regime ${regime} — skipping all entries this cycle`);
      return;
    }
  }

  for (const symbol of cfg.watchlist) {
    if (openPositions.has(symbol)) continue;
    if (state.traded.has(symbol))  continue;
    if (openPositions.size >= cfg.max_positions) break;

    const orb = orbRanges.get(symbol);
    if (!orb) continue;

    // ── ADR% gate ──────────────────────────────────────────────────────────────
    if (cfg.filters.adr.enabled) {
      if (orb.adr_pct == null) {
        state.log("FILTER", `${symbol} — ADR unavailable, skip`);
        continue;
      }
      if (orb.adr_pct < cfg.filters.adr.caution_pct) {
        state.log("FILTER", `${symbol} — ADR ${orb.adr_pct.toFixed(2)}% < ${cfg.filters.adr.caution_pct}% dead zone, skip`);
        continue;
      }
      if (orb.adr_pct < cfg.filters.adr.min_pct) {
        state.log("FILTER", `${symbol} — ADR ${orb.adr_pct.toFixed(2)}% in caution zone (${cfg.filters.adr.caution_pct}%–${cfg.filters.adr.min_pct}%), proceeding with caution`);
      }
    }

    // ── Narrow Range gate ──────────────────────────────────────────────────────
    if (cfg.filters.narrow_range.enabled && !cfg.filters.narrow_range.exempt_symbols.includes(symbol)) {
      if (orb.range_percentile == null) {
        state.log("FILTER", `${symbol} — NR percentile unavailable (insufficient history), skip`);
        continue;
      }
      if (orb.range_percentile > cfg.filters.narrow_range.percentile_max) {
        state.log("FILTER", `${symbol} — range pctile ${orb.range_percentile.toFixed(2)} > ${cfg.filters.narrow_range.percentile_max} (not coiled), skip`);
        continue;
      }
      state.log("FILTER", `${symbol} — NR pass (pctile ${orb.range_percentile.toFixed(2)} ≤ ${cfg.filters.narrow_range.percentile_max})`);
    }

    // ── Breakout price check ───────────────────────────────────────────────────
    const overview = await t(client, "symbol-overview", { symbol });
    if (!overview.ok) continue;
    const price = overview.data.latest_price;
    if (!price) continue;

    const buffer   = orb.range * (cfg.breakout_buffer_pct / 100);
    const longBreak = price > orb.high + buffer;

    if (!longBreak) continue;

    if (!entryOpen) {
      state.log("ORB", `${symbol} breakout confirmed but past noon cutoff — skip`);
      continue;
    }

    state.log("ORB", `${symbol} LONG breakout confirmed @ $${price.toFixed(2)}`, {
      orb_high: orb.high.toFixed(2),
      buffer:   buffer.toFixed(4),
      adr_pct:  orb.adr_pct?.toFixed(2) ?? "n/a",
    });

    await enterLong(client, state, symbol, price, orb);
  }
}

// ── Step 3: enter long (ADR-sized, per-symbol R) ──────────────────────────────

async function enterLong(client, state, symbol, price, orb) {
  const rr          = (cfg.rr_by_symbol && cfg.rr_by_symbol[symbol]) ?? cfg.rr_default;
  const stopPrice   = orb.low;
  const stopDist    = price - stopPrice;
  const targetPrice = price + rr * stopDist;

  // ADR-anchored sizing: keep dollar-risk ≈ risk_per_trade_usd
  const sizedQty   = stopDist > 0 ? Math.floor(cfg.risk_per_trade_usd / stopDist) : 1;
  const notionalQty = Math.floor(cfg.notional / price);
  const qty = Math.max(1, Math.min(sizedQty, notionalQty));

  state.log("ORB", `${symbol} sizing (${rr}R target)`, {
    qty,
    entry:      price.toFixed(2),
    stop:       stopPrice.toFixed(2),
    target:     targetPrice.toFixed(2),
    risk_usd:   (stopDist * qty).toFixed(2),
    reward_usd: (stopDist * qty * rr).toFixed(2),
  });

  await t(client, "signal-submit", {
    source: "technical", symbol, asset_class: "equity",
    direction: "long", confidence: 0.80,
    urgency: "immediate", horizon: 180,
    rationale: `ORB v2 long breakout above $${orb.high.toFixed(2)}. ADR ${orb.adr_pct?.toFixed(2) ?? "n/a"}%, NR pctile ${orb.range_percentile?.toFixed(2) ?? "exempt"}. Entry $${price.toFixed(2)}, stop $${stopPrice.toFixed(2)}, target $${targetPrice.toFixed(2)} (${rr}R).`,
  });

  await t(client, "execution-sor-route", {
    symbol, side: "buy", total_qty: qty,
    notional_usd: cfg.notional, urgency: "immediate",
    signal_source: "technical",
  });

  const preview = await t(client, "orders-preview", {
    symbol, side: "buy", qty,
    order_type: "market", time_in_force: "day",
  });

  if (!preview.ok || !preview.data.policy.allowed) {
    const why = (preview.data?.policy?.violations || []).map(v => v.message || v.rule).join("; ");
    state.log("EXEC", `${symbol} blocked: ${why || preview.error?.message}`);
    return;
  }

  const submit = await t(client, "orders-submit", { approval_token: preview.data.policy.approval_token });
  if (!submit.ok) { state.log("EXEC", `${symbol} submit failed: ${submit.error?.message}`); return; }

  const fillPrice = (preview.data.preview.estimated_price || 0) > 0
    ? preview.data.preview.estimated_price
    : price;

  state.log("EXEC", `✓ BUY ${qty} ${symbol} @ ~$${fillPrice.toFixed(2)}`, {
    stop:     stopPrice.toFixed(2),
    target:   targetPrice.toFixed(2),
    rr:       `${rr}R`,
    order_id: submit.data.order.id,
  });

  await t(client, "execution-record-fill", {
    alpaca_order_id: submit.data.order.id,
    symbol, side: "buy", qty,
    fill_price: fillPrice, expected_price: price,
    venue: "alpaca", algo_type: "market",
  });

  openPositions.set(symbol, { qty, entry: fillPrice, stop: stopPrice, target: targetPrice, rr, order_id: submit.data.order.id });
  state.traded.add(symbol);
  state.positionsOpened++;
  state.fills.push({ symbol, qty, price: fillPrice, stop: stopPrice, target: targetPrice, rr, order_id: submit.data.order.id, time: new Date().toISOString() });
}

// ── Step 4: monitor open positions ────────────────────────────────────────────

async function monitorPositions(client, state) {
  for (const [symbol, pos] of openPositions) {
    const overview = await t(client, "symbol-overview", { symbol });
    if (!overview.ok) continue;
    const price = overview.data.latest_price;

    state.log("MONITOR", `${symbol} $${price.toFixed(2)}  stop=$${pos.stop.toFixed(2)}  target=$${pos.target.toFixed(2)} (${pos.rr}R)`);

    if (price >= pos.target) {
      state.log("EXIT", `${symbol} target (${pos.rr}R) hit @ $${price.toFixed(2)}`);
      await closePosition(client, state, symbol, "target");
    } else if (price <= pos.stop) {
      state.log("EXIT", `${symbol} stop hit @ $${price.toFixed(2)}`);
      await closePosition(client, state, symbol, "stop");
    }
  }
}

async function closePosition(client, state, symbol, reason) {
  const res = await t(client, "positions-close", { symbol });
  if (res.ok) {
    state.log("EXIT", `${symbol} closed (${reason})`, { order_id: res.data.order?.id });
  } else {
    state.log("EXIT", `${symbol} close failed: ${res.error?.message}`);
  }
  openPositions.delete(symbol);
}

// ── Main scan entrypoint ──────────────────────────────────────────────────────

export async function scan(client, state) {
  cachedRegime = null; // reset each scan day

  await captureRanges(client, state);

  if (orbRanges.size === 0) {
    state.log("ORB", "No ranges captured — abort");
    return;
  }

  if (pollHandle) return;

  state.log("ORB", `${orbRanges.size} ranges ready. Polling every ${cfg.poll_interval_ms / 60_000} min. Entry closes ${cfg.entry_cutoff_et.hour}:00 ET. Force-exit ${cfg.time_exit_et.hour}:${String(cfg.time_exit_et.minute).padStart(2,"0")} ET.`);

  await checkBreakouts(client, state);

  pollHandle = setInterval(async () => {
    try {
      await checkBreakouts(client, state);
      await monitorPositions(client, state);
    } catch (err) {
      state.log("ORB", `Poll error: ${err.message}`);
    }
  }, cfg.poll_interval_ms);

  const msToExit = msUntilET(cfg.time_exit_et.hour, cfg.time_exit_et.minute);
  setTimeout(async () => {
    clearInterval(pollHandle);
    pollHandle = null;
    for (const symbol of openPositions.keys()) {
      state.log("EXIT", `${symbol} force-close at session end`);
      await closePosition(client, state, symbol, "session_end").catch(() => {});
    }
  }, msToExit);
}

export function onStop(state) {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  orbRanges.clear();
  openPositions.clear();
  cachedRegime = null;

  state.log("SUMMARY", `Positions opened: ${state.positionsOpened}`);
  for (const f of state.fills) {
    state.log("FILL", `${f.symbol} ×${f.qty} @ $${f.price?.toFixed(2)}  stop=$${f.stop?.toFixed(2)}  target=$${f.target?.toFixed(2)} (${f.rr}R)`);
  }
}
