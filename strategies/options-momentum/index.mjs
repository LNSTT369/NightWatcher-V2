/**
 * OPTIONS MOMENTUM (Phase 5)
 *
 * Uses the same momentum-breakout signal logic to select candidates, but
 * instead of equity, buys OTM calls for leveraged exposure.
 *
 * Entry criteria: RSI 45–65 + MACD bullish + above 20-SMA + confidence ≥ 0.75.
 * Options selection: call near target_delta, DTE between min_dte and max_dte.
 * Stop: 50% premium loss. Target: 100% gain on premium.
 *
 * Requires options_enabled: true in policy config (default: false).
 * Run demo-v3-pipeline.mjs then enable options via: policy-update tool.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf-8"));

export const meta = {
  name: "Options Momentum",
  description: "Momentum breakout → OTM calls. Requires options_enabled in policy.",
  scanTimes: [
    { hour: 9, minute: 30 },
    { hour: 10, minute: 30 },
  ],
  stopTime: { hour: 15, minute: 30 },
};

async function t(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return { ok: false, _raw: res.content[0].text };
  }
}

export async function scan(client, state) {
  if (state.positionsOpened >= cfg.max_positions) {
    state.log("SCAN", `At max positions (${cfg.max_positions}) — skip`);
    return;
  }

  // Regime filter
  const regime = await t(client, "regime-detect", { force_refresh: false });
  if (regime.ok) {
    state.lastRegime = regime.data.regime;
    state.log("REGIME", regime.data.regime);
    if (!cfg.allowed_regimes.includes(regime.data.regime)) {
      state.log("REGIME", "Not in allowed list — skip");
      state.skippedRegime++;
      return;
    }
  }

  state.log("SCAN", `Scanning ${cfg.watchlist.join(", ")} for options momentum`);
  const candidates = [];

  for (const symbol of cfg.watchlist) {
    if (state.traded.has(symbol)) continue;

    const res = await t(client, "signals-get", { symbol, timeframe: "1Day" });
    if (!res.ok) continue;

    const tech = res.data.technicals;
    const sigs = res.data.signals;
    const rsi = tech?.rsi_14;
    const price = tech?.price;
    const sma20 = tech?.sma_20;
    const macdHist = tech?.macd?.histogram;

    const rsiOk = rsi != null && rsi >= cfg.rsi_min && rsi <= cfg.rsi_max;
    const aboveSma = sma20 != null && price != null && price > sma20;
    const macdBull = macdHist != null && macdHist > 0;
    const hasBullish = sigs?.some(s => s.direction === "bullish");

    if (!rsiOk || !hasBullish) continue;

    const rsiScore = 1 - Math.abs((rsi - 55) / 10);
    const confidence = Math.min(0.95, rsiScore * 0.75 + (aboveSma ? 0.1 : 0) + (macdBull ? 0.1 : 0) + 0.05);

    if (confidence < cfg.min_confidence) {
      state.log("SCAN", `${symbol} confidence ${confidence.toFixed(2)} below threshold ${cfg.min_confidence}`);
      continue;
    }

    candidates.push({ symbol, rsi, confidence, price, aboveSma, macdBull });
    state.log("CANDIDATE", `${symbol} conf=${confidence.toFixed(2)} rsi=${rsi.toFixed(1)}`);
  }

  if (!candidates.length) { state.emptyScan++; state.log("SCAN", "No candidates"); return; }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const pick = candidates[0];
  state.log("PICK", `${pick.symbol} conf=${pick.confidence.toFixed(2)}`);

  // Find a suitable call option
  const chain = await t(client, "options-chain", {
    symbol: pick.symbol,
    option_type: "call",
    min_dte: cfg.min_dte,
    max_dte: cfg.max_dte,
    target_delta: cfg.target_delta,
  });

  if (!chain.ok || !chain.data?.contracts?.length) {
    state.log("OPTIONS", `No contracts found for ${pick.symbol} — skip`);
    return;
  }

  const contract = chain.data.contracts[0];
  state.log("OPTIONS", `${pick.symbol} selected ${contract.symbol}`, {
    strike: contract.strike_price,
    expiry: contract.expiration_date,
    delta: contract.delta?.toFixed(3),
    ask: contract.ask?.toFixed(2),
  });

  await t(client, "signal-submit", {
    source: "technical", symbol: pick.symbol, asset_class: "option",
    direction: "long", confidence: pick.confidence,
    urgency: "session", horizon: cfg.max_dte * 24 * 60,
    rationale: `Options momentum. ${pick.symbol} RSI ${pick.rsi.toFixed(1)}. Call ${contract.symbol} delta ${contract.delta?.toFixed(2)}.`,
    regime_tags: state.lastRegime ? [state.lastRegime] : [],
    suggested_notional: cfg.notional_per_trade,
  });

  // Options order flow
  const qty = Math.max(1, Math.floor(cfg.notional_per_trade / ((contract.ask ?? 5) * 100)));

  const preview = await t(client, "options-order-preview", {
    symbol: contract.symbol,
    side: "buy",
    qty,
    order_type: "limit",
    limit_price: contract.ask,
    time_in_force: "day",
  });

  if (!preview.ok || !preview.data?.policy?.allowed) {
    const violations = (preview.data?.policy?.violations || []).map(v => v.message || v.rule).join("; ");
    const why = violations || preview.error?.message || preview._raw || "policy blocked";
    state.log("EXEC", `Options blocked: ${why}`);
    return;
  }

  const submit = await t(client, "options-order-submit", { approval_token: preview.data.policy.approval_token });
  if (!submit.ok) { state.log("EXEC", `Submit failed: ${submit.error?.message}`); return; }

  const premium = (contract.ask ?? 0) * 100 * qty;
  state.log("EXEC", `✓ BUY ${qty} × ${contract.symbol} @ $${contract.ask?.toFixed(2)} ($${premium.toFixed(0)} premium)`, {
    order_id: submit.data.order?.id,
  });

  state.traded.add(pick.symbol);
  state.positionsOpened++;
  state.fills.push({ symbol: pick.symbol, contract: contract.symbol, qty, premium, order_id: submit.data.order?.id, time: new Date().toISOString() });
}

export function onStop(state) {
  state.log("SUMMARY", `Options positions opened: ${state.positionsOpened}`);
  for (const f of state.fills) {
    state.log("FILL", `${f.symbol} → ${f.contract} ×${f.qty} premium=$${f.premium?.toFixed(0)}`);
  }
}
