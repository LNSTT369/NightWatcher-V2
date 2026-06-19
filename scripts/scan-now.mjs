#!/usr/bin/env node
/**
 * Fire an immediate scan for one or more strategies, bypassing scheduled times.
 *
 * Usage:
 *   node scripts/scan-now.mjs momentum-breakout orb mean-reversion options-momentum
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { fileURLToPath } from "url";
import path from "path";
import { appendFileSync, mkdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_URL = "http://localhost:8787/mcp";

const strategyNames = process.argv.slice(2);
if (!strategyNames.length) {
  console.error("Usage: node scripts/scan-now.mjs <strategy> [strategy2 ...]");
  process.exit(1);
}

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
    tradeTaken: false,
    trade: null,
    exitReason: null,
    orb: null,
    log(tag, msg, data) {
      const ts = new Date().toISOString();
      console.log(`  [${ts}] [${tag}] ${msg}`);
      if (data) {
        try {
          appendFileSync(activityLog, JSON.stringify({ ts, tag, msg, ...data }) + "\n");
        } catch { /* non-fatal */ }
      }
    },
  };
}

async function connectMcp(label) {
  const transport = new SSEClientTransport(new URL(MCP_URL));
  const client = new Client({ name: `scan-now-${label}`, version: "1.0" }, { capabilities: {} });
  await client.connect(transport);
  const r = await client.callTool({ name: "auth-verify", arguments: {} });
  const auth = JSON.parse(r.content[0].text);
  if (!auth.ok) throw new Error("Alpaca auth failed");
  console.log(`  MCP connected — paper=${auth.data.paper}  account=${auth.data.account_number}`);
  return {
    callTool: async (args) => client.callTool(args),
  };
}

async function runStrategy(name) {
  console.log(`\n━━━ ${name} ━━━`);
  const stratPath = path.join(__dirname, "..", "strategies", name, "index.mjs");
  const strategy = await import(stratPath);
  const { scan } = strategy;
  const client = await connectMcp(name);
  const state = makeState(name);
  console.log(`  [${new Date().toISOString()}] ⏰  SCAN NOW`);
  await scan(client, state);
  console.log(`  [${new Date().toISOString()}] ✓  Done`);
}

for (const name of strategyNames) {
  try {
    await runStrategy(name);
  } catch (err) {
    console.error(`  [ERROR] ${name}: ${err.message}`);
  }
}
