#!/usr/bin/env node
/**
 * NIGHTWATCHER V3 — Market Hours Runner
 *
 * Strategy:
 *   At 9:30 AM ET: scan watchlist → pick highest-confidence breakout signal
 *   → regime filter → Kelly size → SOR → TWAP execution
 *   At 10:30 AM ET: second scan (avoids morning noise)
 *   At 3:59 PM ET: hard stop, log session summary
 *
 * Watchlist: liquid megacaps with tight spreads and reliable technicals.
 * Signal: RSI 40–65 + MACD bullish crossover + price above 20-day SMA.
 * Regimes allowed: trending_bull, low_volatility (avoids trading into crisis/high-vol).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = "http://localhost:8787/mcp";

// ─── Strategy Config ──────────────────────────────────────────────────────────

const WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "SPY", "QQQ"];

const SIGNAL_CONFIG = {
  rsi_min: 40,           // not oversold
  rsi_max: 65,           // not overbought — room to run
  min_confidence: 0.60,  // minimum signal confidence to trade
  max_positions: 2,      // max new positions per session
  notional_per_trade: 500, // USD per trade (paper demo sizing)
};

const ALLOWED_REGIMES = ["trending_bull", "low_volatility", "range_bound"];

// Scan times in ET (hour, minute). Scans happen at open + mid-morning.
const SCAN_TIMES_ET = [
  { hour: 9, minute: 30 },   // market open
  { hour: 10, minute: 30 },  // mid-morning (avoids first-hour noise)
];

const STOP_TIME_ET = { hour: 15, minute: 59 }; // 3:59 PM ET hard stop

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg, data) {
  const ts = new Date().toISOString();
  const extra = data ? " " + JSON.stringify(data) : "";
  console.log(`[${ts}] [${tag}] ${msg}${extra}`);
}

function hr(label) {
  console.log(`\n${"═".repeat(60)}`);
  if (label) console.log(`  ${label}`);
  console.log("═".repeat(60));
}

// Returns ms until the next occurrence of (hour:minute) in US/Eastern (EDT = UTC-4)
function msUntilET(hour, minute) {
  const now = new Date();
  // May–Nov = EDT (UTC-4)
  const month = now.getUTCMonth() + 1;
  const offsetMin = (month >= 3 && month <= 11) ? 4 * 60 : 5 * 60;

  // Current ET time
  const etNow = new Date(now.getTime() - offsetMin * 60_000);

  // Build target ET time (today)
  const target = new Date(etNow);
  target.setUTCHours(hour, minute, 0, 0);

  // Convert target back to UTC
  let targetUTC = new Date(target.getTime() + offsetMin * 60_000);

  // If already past today's target, schedule for tomorrow
  if (targetUTC <= now) {
    targetUTC = new Date(targetUTC.getTime() + 24 * 3600 * 1000);
  }

  return targetUTC.getTime() - now.getTime();
}

function etTimeString(hour, minute) {
  const h = hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${h}:${String(minute).padStart(2, "0")} ${ampm} ET`;
}

// ─── MCP Tool Caller ──────────────────────────────────────────────────────────

async function tool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

// ─── Core Pipeline ────────────────────────────────────────────────────────────

async function scanAndTrade(client, sessionState) {
  hr(`SCAN — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET`);

  if (sessionState.positionsOpened >= SIGNAL_CONFIG.max_positions) {
    log("SCAN", `Max positions reached (${SIGNAL_CONFIG.max_positions}) — skipping scan`);
    return;
  }

  // ── 1. Regime check ─────────────────────────────────────────────────────
  log("REGIME", "Detecting market regime...");
  const regime = await tool(client, "regime-detect", { force_refresh: false });

  if (regime.ok) {
    const r = regime.data.regime;
    log("REGIME", `Detected: ${r}`, {
      adx: regime.data.adx,
      vol_pct: regime.data.realized_vol_pct,
    });
    if (!ALLOWED_REGIMES.includes(r)) {
      log("REGIME", `⚠ Regime "${r}" not in allowed list — skipping scan`);
      sessionState.skippedRegime++;
      return;
    }
    sessionState.lastRegime = r;
  } else {
    log("REGIME", "⚠ Regime detect failed — proceeding without filter");
  }

  // ── 2. Technical signal scan ─────────────────────────────────────────────
  log("SCAN", `Scanning ${WATCHLIST.length} symbols: ${WATCHLIST.join(", ")}`);

  const candidates = [];

  for (const symbol of WATCHLIST) {
    if (sessionState.traded.has(symbol)) {
      log("SCAN", `${symbol} already traded this session — skip`);
      continue;
    }

    const res = await tool(client, "signals-get", { symbol, timeframe: "1Day" });
    if (!res.ok) {
      log("SCAN", `${symbol} signals-get failed — skip`);
      continue;
    }

    const { technicals, signals } = res.data;

    // Filter: RSI in sweet spot + at least one bullish signal detected
    const rsi = technicals?.rsi;
    const hasBullishSignal = signals?.some(s => s.direction === "bullish");
    const price = technicals?.price;
    const sma20 = technicals?.sma20;

    const rsiOk = rsi && rsi >= SIGNAL_CONFIG.rsi_min && rsi <= SIGNAL_CONFIG.rsi_max;
    const aboveSma = sma20 && price && price > sma20;

    if (!hasBullishSignal || !rsiOk) {
      log("SCAN", `${symbol} filtered out`, {
        rsi: rsi?.toFixed(1),
        bullish_signal: hasBullishSignal,
        above_sma20: aboveSma,
      });
      continue;
    }

    // Confidence = blend of: RSI position in range + above SMA bonus
    const rsiScore = 1 - Math.abs((rsi - 52.5) / 12.5); // peaks at RSI=52.5
    const smaBonus = aboveSma ? 0.1 : 0;
    const confidence = Math.min(0.95, Math.max(0.60, rsiScore * 0.8 + smaBonus + 0.1));

    candidates.push({ symbol, rsi, confidence, signals, price, aboveSma });
    log("SCAN", `${symbol} → candidate`, {
      rsi: rsi.toFixed(1),
      price,
      confidence: confidence.toFixed(2),
      signal_count: signals.length,
    });
  }

  if (candidates.length === 0) {
    log("SCAN", "No candidates passed filters this cycle");
    sessionState.emptyScan++;
    return;
  }

  // ── 3. Pick top candidate ────────────────────────────────────────────────
  candidates.sort((a, b) => b.confidence - a.confidence);
  const pick = candidates[0];

  if (pick.confidence < SIGNAL_CONFIG.min_confidence) {
    log("SCAN", `Top candidate ${pick.symbol} confidence ${pick.confidence.toFixed(2)} below threshold — skip`);
    return;
  }

  log("PICK", `Selected ${pick.symbol}`, {
    confidence: pick.confidence.toFixed(2),
    rsi: pick.rsi.toFixed(1),
    price: pick.price,
  });

  // ── 4. Submit + aggregate signal ─────────────────────────────────────────
  const sigRes = await tool(client, "signal-submit", {
    source: "technical",
    symbol: pick.symbol,
    asset_class: "equity",
    direction: "long",
    confidence: pick.confidence,
    urgency: "session",
    horizon: 120,
    rationale: `Technical breakout: RSI ${pick.rsi.toFixed(1)}, ${pick.aboveSma ? "above" : "near"} 20-day SMA, bullish signals: ${pick.signals.map(s => s.type).join(", ")}`,
    regime_tags: sessionState.lastRegime ? [sessionState.lastRegime] : [],
    suggested_notional: SIGNAL_CONFIG.notional_per_trade,
  });

  if (!sigRes.ok) { log("SIGNAL", "Submit failed — abort"); return; }
  log("SIGNAL", "Submitted", { id: sigRes.data.signal_id });

  const aggRes = await tool(client, "signal-aggregate", { symbol: pick.symbol });
  if (!aggRes.ok || aggRes.data.final_direction !== "long") {
    log("SIGNAL", "Aggregation returned non-long — abort");
    return;
  }
  log("SIGNAL", "Aggregated", {
    direction: aggRes.data.final_direction,
    confidence: aggRes.data.final_confidence.toFixed(3),
    conflict: aggRes.data.conflict_detected,
  });

  // ── 5. Kelly sizing (best-effort) ────────────────────────────────────────
  const kellyRes = await tool(client, "risk-kelly-size", {
    symbol: pick.symbol,
    kelly_fraction_cap: 0.25,
    lookback_trades: 100,
  });
  if (kellyRes.ok) {
    log("KELLY", `${pick.symbol}`, {
      recommended_pct_equity: kellyRes.data.recommended_pct_equity,
      edge: kellyRes.data.is_positive_edge,
    });
  } else {
    log("KELLY", "No journal history yet — using fixed notional");
  }

  // ── 6. SOR routing ───────────────────────────────────────────────────────
  const sorRes = await tool(client, "execution-sor-route", {
    symbol: pick.symbol,
    side: "buy",
    total_qty: 3,
    notional_usd: SIGNAL_CONFIG.notional_per_trade,
    urgency: "session",
    signal_source: "technical",
    signal_confidence: pick.confidence,
  });
  if (!sorRes.ok) { log("SOR", "Failed — abort"); return; }
  log("SOR", "Routing decision", {
    venue: sorRes.data.venue,
    algo: sorRes.data.algo,
    rationale: sorRes.data.rationale,
  });

  // ── 7. TWAP schedule ─────────────────────────────────────────────────────
  const schedRes = await tool(client, "execution-twap", {
    symbol: pick.symbol,
    side: "buy",
    total_qty: 3,
    duration_minutes: 30,
    interval_minutes: 10,
    start_time_iso: new Date().toISOString(),
  });
  if (!schedRes.ok) { log("TWAP", "Failed — abort"); return; }
  log("TWAP", `Schedule: ${schedRes.data.slices} slices over ${schedRes.data.duration_minutes} min`);
  for (const c of schedRes.data.children) {
    log("TWAP", `  child[${c.slice_index}] qty=${c.qty}  not_before=${c.not_before_iso}`);
  }

  // ── 8. Execute child[0] ──────────────────────────────────────────────────
  const child = schedRes.data.children[0];
  log("EXEC", `Preview BUY ${child.qty} ${pick.symbol}`);

  const preview = await tool(client, "orders-preview", {
    symbol: pick.symbol,
    side: "buy",
    qty: child.qty,
    order_type: "market",
    time_in_force: "day",
  });

  if (!preview.ok) {
    log("EXEC", `Preview failed: ${preview.error?.message}`);
    return;
  }
  if (!preview.data.policy.allowed) {
    const violations = (preview.data.policy.violations || []).map(v => v.message || v.rule).join("; ");
    log("EXEC", `Policy rejected: ${violations}`);
    return;
  }

  log("EXEC", "Policy approved", {
    estimated_price: preview.data.preview.estimated_price,
    estimated_cost: preview.data.preview.estimated_cost,
  });

  const submit = await tool(client, "orders-submit", {
    approval_token: preview.data.policy.approval_token,
  });

  if (!submit.ok) {
    log("EXEC", `Submit failed: ${submit.error?.message}`);
    return;
  }

  log("EXEC", `✓ ORDER SUBMITTED`, {
    order_id: submit.data.order.id,
    symbol: pick.symbol,
    status: submit.data.order.status,
  });

  // ── 9. Record fill ───────────────────────────────────────────────────────
  const fillPrice = preview.data.preview.estimated_price;
  await tool(client, "execution-record-fill", {
    alpaca_order_id: submit.data.order.id,
    symbol: pick.symbol,
    side: "buy",
    qty: child.qty,
    fill_price: fillPrice,
    expected_price: fillPrice,
    venue: "alpaca",
    algo_type: "twap",
    dark_pool_pct: 0,
    aggregated_signal_id: aggRes.data.aggregated_signal_id,
  });

  const quality = await tool(client, "execution-slippage-calc", {
    side: "buy",
    fill_price: fillPrice,
    expected_price: fillPrice,
  });

  if (quality.ok) {
    log("QUALITY", "Fill grade", {
      slippage_bps: quality.data.slippage_vs_expected_bps,
      grade: quality.data.fill_grade,
    });
  }

  // Track session state
  sessionState.traded.add(pick.symbol);
  sessionState.positionsOpened++;
  sessionState.fills.push({
    symbol: pick.symbol,
    qty: child.qty,
    price: fillPrice,
    order_id: submit.data.order.id,
    time: new Date().toISOString(),
  });

  log("SESSION", `Positions opened this session: ${sessionState.positionsOpened}/${SIGNAL_CONFIG.max_positions}`);
}

// ─── Session Summary ──────────────────────────────────────────────────────────

function printSummary(sessionState) {
  hr("SESSION SUMMARY — 3:59 PM ET");
  log("SUMMARY", `Positions opened: ${sessionState.positionsOpened}`);
  log("SUMMARY", `Empty scans: ${sessionState.emptyScan}`);
  log("SUMMARY", `Regime skips: ${sessionState.skippedRegime}`);
  log("SUMMARY", `Last regime: ${sessionState.lastRegime ?? "unknown"}`);
  for (const f of sessionState.fills) {
    log("FILL", `${f.symbol} ×${f.qty} @ $${f.price?.toFixed(2)}  [${f.order_id}]`);
  }
  hr("NIGHTWATCHER V3 — session complete");
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  hr("NIGHTWATCHER V3 — Market Runner");
  console.log("  Strategy: Technical breakout scan at open + mid-morning");
  console.log(`  Watchlist: ${WATCHLIST.join(", ")}`);
  console.log(`  Signal:   RSI ${SIGNAL_CONFIG.rsi_min}–${SIGNAL_CONFIG.rsi_max} + bullish crossover + above 20-SMA`);
  console.log(`  Regimes:  ${ALLOWED_REGIMES.join(", ")}`);
  console.log(`  Sizing:   Kelly (fallback: $${SIGNAL_CONFIG.notional_per_trade} fixed)`);
  console.log(`  Algo:     SOR → TWAP (3 slices × 10 min)`);
  console.log(`  Scans:    ${SCAN_TIMES_ET.map(t => etTimeString(t.hour, t.minute)).join(", ")}`);
  console.log(`  Stop:     ${etTimeString(STOP_TIME_ET.hour, STOP_TIME_ET.minute)}`);

  // Connect to MCP
  log("SYSTEM", "Connecting to MCP server...");
  const transport = new SSEClientTransport(new URL(MCP_URL));
  const client = new Client({ name: "v3-market-runner", version: "1.0" }, { capabilities: {} });
  await client.connect(transport);
  log("SYSTEM", "Connected");

  const verify = await tool(client, "auth-verify");
  if (!verify.ok) throw new Error("Alpaca auth failed");
  log("SYSTEM", `Alpaca verified — paper=${verify.data.paper} account=${verify.data.account_number}`);

  // Session state
  const sessionState = {
    positionsOpened: 0,
    emptyScan: 0,
    skippedRegime: 0,
    lastRegime: null,
    traded: new Set(),
    fills: [],
  };

  // Schedule stop at 3:59 PM ET
  const msToStop = msUntilET(STOP_TIME_ET.hour, STOP_TIME_ET.minute);
  log("SYSTEM", `Stop scheduled at ${etTimeString(STOP_TIME_ET.hour, STOP_TIME_ET.minute)} (in ${(msToStop / 3600_000).toFixed(2)}h)`);
  const stopTimer = setTimeout(() => {
    printSummary(sessionState);
    process.exit(0);
  }, msToStop);
  stopTimer.unref();

  // Schedule each scan
  for (const t of SCAN_TIMES_ET) {
    const ms = msUntilET(t.hour, t.minute);
    const label = etTimeString(t.hour, t.minute);
    log("SYSTEM", `Scan scheduled at ${label} (in ${(ms / 3600_000).toFixed(2)}h)`);
    setTimeout(async () => {
      log("SYSTEM", `⏰ Scan firing — ${label}`);
      try {
        await scanAndTrade(client, sessionState);
      } catch (err) {
        log("ERROR", `Scan error: ${err.message}`);
      }
    }, ms);
  }

  console.log("\n  Waiting for market open...\n");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
