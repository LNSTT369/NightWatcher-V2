#!/usr/bin/env node
/**
 * NIGHTWATCHER V3 — Dashboard API Bridge
 *
 * HTTP server on port 3001 that connects to the MCP server (port 8787)
 * and serves the data the React dashboard expects.
 *
 * Endpoints:
 *   GET  /api/setup/status        — is MCP reachable + auth OK?
 *   GET  /api/status              — account, positions, clock, logs, signals
 *   GET  /api/portfolio/history   — Alpaca portfolio equity curve
 *   GET  /api/v3/regime           — market regime (ADX, ATR%, vol)
 *   GET  /api/v3/risk             — Kelly, Sharpe, VaR
 *   GET  /api/v3/signals          — alpha signals from D1
 *   POST /api/config              — save config (in-memory only for now)
 */

import http from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "logs");
const MCP_URL = "http://localhost:8787/mcp";
const PORT = 3001;

// ── MCP client (persistent connection with auto-reconnect) ────────────────────

let mcpClient = null;
let mcpConnecting = false;
let mcpReady = false;

async function connectMcp() {
  if (mcpReady && mcpClient) return mcpClient;
  if (mcpConnecting) {
    // Wait up to 3s for an in-progress connect
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      if (mcpReady && mcpClient) return mcpClient;
    }
    throw new Error("MCP connect timed out");
  }

  mcpConnecting = true;
  try {
    const transport = new SSEClientTransport(new URL(MCP_URL));
    const c = new Client({ name: "dashboard-api", version: "1.0" }, { capabilities: {} });
    await c.connect(transport);
    mcpClient = c;
    mcpReady = true;
    console.log("[dashboard-api] Connected to MCP server");
    return c;
  } catch (err) {
    mcpReady = false;
    mcpClient = null;
    throw err;
  } finally {
    mcpConnecting = false;
  }
}

async function callTool(name, args = {}) {
  try {
    const c = await connectMcp();
    const res = await c.callTool({ name, arguments: args });
    return JSON.parse(res.content[0].text);
  } catch (err) {
    // Reset so next call retries the connection
    if (err.message?.includes("connect") || err.message?.includes("ECONNREFUSED")) {
      mcpReady = false;
      mcpClient = null;
    }
    return { ok: false, error: { message: err.message } };
  }
}

// ── Activity log reader ───────────────────────────────────────────────────────

function readActivityLogs(maxEntries = 150) {
  if (!existsSync(LOGS_DIR)) return [];
  const entries = [];
  try {
    const files = readdirSync(LOGS_DIR).filter(f => f.endsWith("-activity.jsonl"));
    for (const file of files) {
      const raw = readFileSync(path.join(LOGS_DIR, file), "utf-8").trim();
      if (!raw) continue;
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
  } catch { /* LOGS_DIR may not exist yet */ }
  return entries
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(-maxEntries);
}

// ── Default V3 config (returned to dashboard) ─────────────────────────────────

const DEFAULT_CONFIG = {
  mcp_url: MCP_URL,
  data_poll_interval_ms: 5000,
  analyst_interval_ms: 60_000,
  max_position_value: 10_000,
  max_positions: 5,
  min_sentiment_score: 0.3,
  min_analyst_confidence: 0.6,
  sell_sentiment_threshold: -0.1,
  take_profit_pct: 0.15,
  stop_loss_pct: 0.05,
  position_size_pct_of_cash: 0.1,
  llm_model: "none",
  llm_max_tokens: 1024,
  starting_equity: 100_000,
};

let savedConfig = { ...DEFAULT_CONFIG };

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleSetupStatus(req, res) {
  let configured = false;
  let paper = false;
  let account_number = null;
  try {
    const auth = await callTool("auth-verify");
    configured = auth.ok === true;
    paper = auth.data?.paper ?? false;
    account_number = auth.data?.account_number ?? null;
  } catch { /* MCP not up */ }
  json(res, 200, { ok: true, data: { configured, paper, account_number } });
}

async function handleStatus(req, res) {
  const [portfolio, clockRes, signalsRes] = await Promise.all([
    callTool("portfolio-get"),
    callTool("market-clock"),
    callTool("signal-list", { limit: 50 }),
  ]);

  const logs = readActivityLogs();

  const account = portfolio.ok ? {
    equity: portfolio.data.account.equity,
    cash: portfolio.data.account.cash,
    buying_power: portfolio.data.account.buying_power,
    portfolio_value: portfolio.data.account.equity,
  } : null;

  const positions = portfolio.ok
    ? portfolio.data.positions.map(p => ({
        symbol: p.symbol,
        qty: p.qty,
        side: (p.qty ?? 0) >= 0 ? "long" : "short",
        market_value: p.market_value,
        unrealized_pl: p.unrealized_pl,
        current_price: p.current_price,
      }))
    : [];

  const clock = clockRes.ok ? {
    is_open: clockRes.data.is_open,
    next_open: clockRes.data.next_open,
    next_close: clockRes.data.next_close,
  } : null;

  // Map alpha signals to the legacy Signal shape the dashboard uses
  const signals = signalsRes.ok
    ? (signalsRes.data.signals || []).map(s => ({
        symbol: s.symbol,
        source: s.source,
        sentiment: s.direction === "long" ? s.confidence : s.direction === "short" ? -s.confidence : 0,
        volume: 0,
        reason: s.rationale,
        score: s.confidence,
      }))
    : [];

  json(res, 200, {
    ok: true,
    data: {
      account,
      positions,
      clock,
      config: savedConfig,
      signals,
      logs,
      costs: { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 },
      lastAnalystRun: 0,
      lastResearchRun: 0,
      signalResearch: {},
      positionResearch: {},
    },
  });
}

async function handlePortfolioHistory(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const period = url.searchParams.get("period") || "1D";
  const timeframe = url.searchParams.get("timeframe") || "15Min";
  const result = await callTool("portfolio-history", { period, timeframe });
  json(res, 200, result);
}

async function handleV3Regime(req, res) {
  const result = await callTool("regime-detect");
  json(res, 200, result);
}

async function handleV3Risk(req, res) {
  const [kelly, sharpe, varRes] = await Promise.all([
    callTool("risk-kelly-size"),
    callTool("risk-sharpe"),
    callTool("risk-var"),
  ]);
  json(res, 200, {
    ok: true,
    data: {
      kelly:  kelly.ok  ? kelly.data  : null,
      sharpe: sharpe.ok ? sharpe.data : null,
      var:    varRes.ok ? varRes.data  : null,
    },
  });
}

async function handleV3Signals(req, res) {
  const result = await callTool("signal-list", { limit: 50 });
  // Normalize to the AlphaSignal shape the dashboard expects.
  // signal-list returns a minimal row (id, source, symbol, direction,
  // confidence, urgency, status, created_at) — patch missing fields.
  if (result.ok && Array.isArray(result.data?.signals)) {
    result.data.signals = result.data.signals.map(s => ({
      signal_id:          s.signal_id   ?? s.id ?? "",
      source:             s.source      ?? "manual",
      generated_at:       s.generated_at ?? s.created_at ?? new Date().toISOString(),
      ttl_seconds:        s.ttl_seconds  ?? 3600,
      symbol:             s.symbol       ?? "",
      direction:          s.direction    ?? "neutral",
      confidence:         Number(s.confidence ?? 0),
      urgency:            s.urgency      ?? "session",
      horizon:            s.horizon      ?? 0,
      rationale:          s.rationale    ?? "",
      regime_tags:        Array.isArray(s.regime_tags) ? s.regime_tags : [],
      suggested_notional: s.suggested_notional ?? undefined,
      suggested_pct_equity: s.suggested_pct_equity ?? undefined,
    }));
  }
  json(res, 200, result);
}

async function handleV3Strategies(req, res) {
  const strategiesDir = path.join(__dirname, "..", "strategies");
  const result = [];

  let strategyNames = [];
  try {
    strategyNames = readdirSync(strategiesDir).filter(
      name => existsSync(path.join(strategiesDir, name, "index.mjs"))
    );
  } catch { /* strategies dir missing */ }

  const today = new Date().toDateString();

  for (const name of strategyNames) {
    const activityFile = path.join(LOGS_DIR, `${name}-activity.jsonl`);
    let lastActivity = null;
    let lastAction = null;
    let fillsToday = 0;

    if (existsSync(activityFile)) {
      try {
        const raw = readFileSync(activityFile, "utf-8").trim();
        const lines = raw ? raw.split("\n") : [];
        const entries = lines.reduce((acc, line) => {
          try { acc.push(JSON.parse(line)); } catch { /* skip */ }
          return acc;
        }, []);

        if (entries.length) {
          const last = entries[entries.length - 1];
          lastActivity = last.timestamp;
          lastAction = last.action + (last.message ? ` — ${last.message}` : "");
        }

        fillsToday = entries.filter(e => {
          if (e.action !== "EXEC") return false;
          return new Date(e.timestamp).toDateString() === today;
        }).length;
      } catch { /* unreadable */ }
    }

    // Strategy is "active" if it logged something in the last 8 hours
    const status = lastActivity && (Date.now() - new Date(lastActivity).getTime()) < 8 * 3_600_000
      ? "active"
      : "idle";

    result.push({ name, status, lastActivity, lastAction, fillsToday });
  }

  json(res, 200, { ok: true, data: { strategies: result } });
}

async function handleConfigPost(req, res) {
  try {
    const body = await readBody(req);
    const config = JSON.parse(body);
    savedConfig = { ...savedConfig, ...config };
    json(res, 200, { ok: true, data: savedConfig });
  } catch (err) {
    json(res, 400, { ok: false, error: { message: err.message } });
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }

  try {
    if (pathname === "/api/setup/status")           return await handleSetupStatus(req, res);
    if (pathname === "/api/status")                 return await handleStatus(req, res);
    if (pathname === "/api/portfolio/history")      return await handlePortfolioHistory(req, res);
    if (pathname === "/api/v3/regime")              return await handleV3Regime(req, res);
    if (pathname === "/api/v3/risk")                return await handleV3Risk(req, res);
    if (pathname === "/api/v3/signals")             return await handleV3Signals(req, res);
    if (pathname === "/api/v3/strategies")          return await handleV3Strategies(req, res);
    if (pathname === "/api/config" && req.method === "POST") return await handleConfigPost(req, res);

    json(res, 404, { ok: false, error: { message: "Not found" } });
  } catch (err) {
    console.error("[dashboard-api] Unhandled:", err.message);
    json(res, 500, { ok: false, error: { message: err.message } });
  }
});

server.listen(PORT, () => {
  console.log(`\n[dashboard-api] Listening on http://localhost:${PORT}`);
  console.log(`[dashboard-api] MCP target: ${MCP_URL}`);
  console.log(`[dashboard-api] Logs dir:   ${LOGS_DIR}\n`);
});

// Attempt initial MCP connection (non-fatal)
connectMcp().catch(err => {
  console.warn(`[dashboard-api] MCP not ready yet: ${err.message} — will retry per request`);
  mcpReady = false;
  mcpClient = null;
});
