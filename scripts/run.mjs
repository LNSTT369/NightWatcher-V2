#!/usr/bin/env node
/**
 * NIGHTWATCHER V3 — Universal Strategy Runner
 *
 * Usage:
 *   node scripts/run.mjs <strategy-name>
 *
 * Examples:
 *   node scripts/run.mjs momentum-breakout
 *   node scripts/run.mjs orb
 *
 * Each strategy lives in strategies/<name>/index.mjs and exports:
 *   meta       — { name, description, scanTimes, stopTime }
 *   scan()     — called at each scanTime (ET)
 *   onStop()   — called at stopTime before exit
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { fileURLToPath } from "url";
import path from "path";
import { appendFileSync, mkdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_URL = "http://localhost:8787/mcp";

// ── Arg parsing ───────────────────────────────────────────────────────────────

const strategyName = process.argv[2];
if (!strategyName) {
  console.error("Usage: node scripts/run.mjs <strategy-name>");
  console.error("Available strategies: momentum-breakout, orb, vwap-reversion, gap-and-go, mean-reversion, futures-hedge, options-momentum");
  process.exit(1);
}

// ── Timezone helpers ─────────────────────────────────────────────────────────

function msUntilET(hour, minute) {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const offsetMin = (month >= 3 && month <= 11) ? 240 : 300;
  const etNow = new Date(now.getTime() - offsetMin * 60_000);
  const target = new Date(etNow);
  target.setUTCHours(hour, minute, 0, 0);
  let targetUTC = new Date(target.getTime() + offsetMin * 60_000);
  if (targetUTC <= now) targetUTC = new Date(targetUTC.getTime() + 86_400_000);
  return targetUTC.getTime() - now.getTime();
}

function etLabel(h, m) {
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hr}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}

function fmtMs(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ── Session state ─────────────────────────────────────────────────────────────

function makeState(strategyName) {
  const logsDir = path.join(__dirname, "..", "logs");
  mkdirSync(logsDir, { recursive: true });
  const activityLog = path.join(logsDir, `${strategyName}-activity.jsonl`);

  return {
    strategyName,
    startTime: new Date().toISOString(),
    positionsOpened: 0,
    emptyScan: 0,
    skippedRegime: 0,
    lastRegime: null,
    traded: new Set(),
    fills: [],
    tradeTaken: false,   // used by single-trade strategies (e.g. ORB)
    trade: null,
    exitReason: null,
    orb: null,
    pollHandle: null,
    log(tag, msg, data) {
      const ts = new Date().toISOString();
      const extra = data ? "  " + JSON.stringify(data) : "";
      console.log(`[${ts}] [${strategyName.toUpperCase()}] [${tag}] ${msg}${extra}`);
      // Write structured entry to JSONL for dashboard-api
      try {
        const entry = JSON.stringify({ timestamp: ts, agent: strategyName.toUpperCase(), action: tag, message: msg, ...(data || {}) });
        appendFileSync(activityLog, entry + "\n");
      } catch { /* non-fatal */ }
    },
  };
}

// ── MCP connection with auto-reconnect ───────────────────────────────────────

let activeClient = null;
let reconnecting = false;

async function connectMcp(label) {
  while (true) {
    try {
      const transport = new SSEClientTransport(new URL(MCP_URL));
      const client = new Client({ name: `v3-${label}`, version: "1.0" }, { capabilities: {} });
      await client.connect(transport);
      const r = await client.callTool({ name: "auth-verify", arguments: {} });
      const auth = JSON.parse(r.content[0].text);
      if (!auth.ok) throw new Error("Alpaca auth failed");
      console.log(`  [${new Date().toISOString()}] MCP connected — paper=${auth.data.paper}  account=${auth.data.account_number}`);
      activeClient = client;
      reconnecting = false;
      return client;
    } catch (err) {
      console.error(`  [${new Date().toISOString()}] MCP connect failed: ${err.message} — retrying in 10s`);
      await new Promise(r => setTimeout(r, 10_000));
    }
  }
}

// Returns a proxy that auto-reconnects on tool call failure
function makeClientProxy(label) {
  return {
    callTool: async (args) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!activeClient) await connectMcp(label);
          return await activeClient.callTool(args);
        } catch (err) {
          console.error(`  [${new Date().toISOString()}] Tool "${args.name}" failed (attempt ${attempt + 1}): ${err.message}`);
          activeClient = null;
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 5_000));
            await connectMcp(label);
          }
        }
      }
      throw new Error(`Tool "${args.name}" failed after 3 attempts`);
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const stratPath = path.join(__dirname, "..", "strategies", strategyName, "index.mjs");
  let strategy;
  try {
    strategy = await import(stratPath);
  } catch (err) {
    console.error(`Strategy "${strategyName}" not found at ${stratPath}`);
    console.error("Available: momentum-breakout, orb, vwap-reversion, gap-and-go, mean-reversion, futures-hedge, options-momentum");
    process.exit(1);
  }

  const { meta, scan, onStop } = strategy;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(`║  NIGHTWATCHER V3 — ${meta.name.padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  ${meta.description}`);
  console.log(`  Scans:  ${meta.scanTimes.map(t => etLabel(t.hour, t.minute)).join("  |  ")}`);
  console.log(`  Stop:   ${etLabel(meta.stopTime.hour, meta.stopTime.minute)}`);
  console.log();

  console.log(`  Connecting to ${MCP_URL}...`);
  await connectMcp(strategyName);

  const client = makeClientProxy(strategyName);
  const state = makeState(strategyName);

  // Schedule stop
  const msStop = msUntilET(meta.stopTime.hour, meta.stopTime.minute);
  console.log(`  Stop:   ${etLabel(meta.stopTime.hour, meta.stopTime.minute)} (in ${fmtMs(msStop)})`);

  const stopTimer = setTimeout(() => {
    console.log(`\n[${new Date().toISOString()}] ⏹  STOP — ${etLabel(meta.stopTime.hour, meta.stopTime.minute)}`);
    onStop(state);
    process.exit(0);
  }, msStop);
  stopTimer.unref();

  // Schedule each scan
  for (const scanTime of meta.scanTimes) {
    const ms = msUntilET(scanTime.hour, scanTime.minute);
    console.log(`  Scan:   ${etLabel(scanTime.hour, scanTime.minute)} (in ${fmtMs(ms)})`);

    setTimeout(async () => {
      console.log(`\n[${new Date().toISOString()}] ⏰  SCAN — ${etLabel(scanTime.hour, scanTime.minute)}`);
      try {
        await scan(client, state);
      } catch (err) {
        state.log("ERROR", err.message);
      }
    }, ms);
  }

  console.log("\n  Waiting...\n");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
