#!/usr/bin/env node

/**
 * NIGHTWATCHER - Simple Trading Agent
 * 
 * COPY THIS FILE and modify it for your own strategy.
 * 
 * The file has three sections:
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SECTION 1: DATA SOURCE (line ~150)                             │
 * │  - StockTwitsAgent class - fetches sentiment data               │
 * │  - CUSTOMIZE: Add Reddit, Twitter, news APIs, etc.              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  SECTION 2: TRADING STRATEGY (line ~380)                        │
 * │  - runTradingLogic() method - decides when to buy/sell          │
 * │  - CUSTOMIZE: Change buy/sell rules, add indicators, etc.       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  SECTION 3: HARNESS (line ~450+)                                │
 * │  - MCP connection, order execution, dashboard API               │
 * │  - PROBABLY DON'T TOUCH unless you know what you're doing       │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * MIT License - Free for personal and commercial use
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .dev.vars
function loadEnvFile() {
  const envPath = path.join(__dirname, ".dev.vars");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_PATH = path.join(process.cwd(), "nightwatcher-config.json");
const LOG_PATH = path.join(process.cwd(), "nightwatcher-logs.json");

const DEFAULT_CONFIG = {
  mcp_url: process.env.MCP_URL || "http://localhost:8787/mcp",

  // Polling intervals
  data_poll_interval_ms: 60_000,      // Data gatherer polls every 60s
  analyst_interval_ms: 120_000,        // Trading logic runs every 2 min

  // Trading parameters
  max_position_value: 2000,            // Max $ per position
  max_positions: 3,                    // Max concurrent positions (crypto)
  max_stock_positions: 3,              // Max concurrent stock positions
  min_sentiment_score: 0.25,           // Minimum bullish sentiment to buy (0-1, roughly % bullish - 50%)
  min_volume: 10,                      // Minimum message volume

  // Risk management
  take_profit_pct: 8,                  // Auto-sell at this % profit
  stop_loss_pct: 4,                    // Auto-sell at this % loss
  position_size_pct_of_cash: 20,       // Max % of cash per position

  // Account config
  starting_equity: 100000,             // Starting equity for P&L calculation

  // Crypto trading (24/7 markets)
  crypto_enabled: false,               // Enable crypto trading
  crypto_symbols: ["BTC/USD", "ETH/USD", "SOL/USD"],  // Cryptos to monitor
  crypto_momentum_threshold: 2.0,      // Min % price change to trigger signal
  crypto_max_position_value: 1000,     // Max $ per crypto position
  crypto_take_profit_pct: 10,          // Take profit for crypto
  crypto_stop_loss_pct: 5,             // Stop loss for crypto
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...saved };
    }
  } catch (e) {
    console.error("Failed to load config:", e.message);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================================
// Activity Logger
// ============================================================================

class ActivityLogger {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.costTracker = { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 };
    this.stats = {
      signalsGathered: 0,
      signalsResearched: 0,
      buySignals: 0,
      twitterConfirmations: 0,
      lastUpdated: Date.now()
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(LOG_PATH)) {
        const data = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
        this.entries = data.entries || [];
        this.costTracker = data.costTracker || this.costTracker;
        this.stats = data.stats || this.stats;
      }
    } catch (e) {
      console.error("Failed to load logs:", e.message);
    }
  }

  save() {
    const data = { entries: this.entries.slice(-this.maxEntries), costTracker: this.costTracker, stats: this.stats };
    fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2));
  }

  increment(stat, amount = 1) {
    const lastDate = new Date(this.stats.lastUpdated).toDateString();
    const currDate = new Date().toDateString();
    if (lastDate !== currDate) {
      this.stats.signalsGathered = 0;
      this.stats.signalsResearched = 0;
      this.stats.buySignals = 0;
      this.stats.twitterConfirmations = 0;
    }
    if (this.stats[stat] !== undefined) {
      this.stats[stat] += amount;
      this.stats.lastUpdated = Date.now();
    }
  }

  log(agent, action, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      agent,
      action,
      ...details,
    };
    this.entries.push(entry);
    console.log(`[${entry.timestamp}] [${agent}] ${action}`, details.symbol ? `(${details.symbol})` : "");

    if (this.entries.length % 10 === 0) {
      this.save();
    }
    return entry;
  }

  getRecentLogs(limit = 50) {
    return this.entries.slice(-limit);
  }

  getCosts() {
    return this.costTracker;
  }
}

// ============================================================================
// ============================================================================
//
//   SECTION 1: DATA SOURCE
//
//   This is where signals come from. Currently uses StockTwits (free, no API key).
//   
//   TO CUSTOMIZE: Add your own data sources here. Examples:
//   - News APIs (NewsAPI, Polygon, Alpha Vantage)
//   - Your own proprietary signals
//
//   Each source should return signals in this format:
//   { symbol, source, sentiment (-1 to 1), volume, reason }
//
// ============================================================================
// ============================================================================

class StockTwitsAgent {
  constructor(logger) {
    this.logger = logger;
    this.name = "StockTwits";
    this.mcp = null;
  }

  async callTool(name, args = {}) {
    if (!this.mcp) throw new Error("MCP client not available");
    const result = await this.mcp.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  }

  async getTrending() {
    try {
      const res = await fetch("https://api.stocktwits.com/api/2/trending/symbols.json");
      if (!res.ok) return [];
      const data = await res.json();
      this.logger.log(this.name, "fetched_trending", { count: data.symbols?.length || 0 });
      return data.symbols || [];
    } catch (err) {
      this.logger.log(this.name, "error", { message: err.message });
      return [];
    }
  }

  async getStream(symbol) {
    try {
      const res = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json?limit=30`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    } catch (err) {
      return [];
    }
  }

  analyzeSentiment(messages) {
    let bullish = 0, bearish = 0;

    for (const msg of messages) {
      const sentiment = msg.entities?.sentiment?.basic;
      if (sentiment === "Bullish") bullish++;
      else if (sentiment === "Bearish") bearish++;
    }

    const total = messages.length;
    return {
      bullish,
      bearish,
      total,
      score: total > 0 ? (bullish - bearish) / total : 0,
    };
  }

  async gatherSignals() {
    const signals = [];
    const trending = await this.getTrending();

    for (const sym of trending.slice(0, 10)) {
      const messages = await this.getStream(sym.symbol);
      const sentiment = this.analyzeSentiment(messages);

      if (sentiment.total >= 5) {
        this.logger.increment("signalsGathered");
        let isCatalyst = false;
        let score = 0;
        let enhancedReason = `StockTwits: ${sentiment.bullish}B/${sentiment.bearish}b (${(sentiment.score * 100).toFixed(0)}%)`;

        // Quality score based purely on sentiment data (no LLM gate — llm-prompt is not in MCP)
        // Score 0-10 based on: % bullish, message volume, and net sentiment
        const bullishRatio = sentiment.bullish / Math.max(sentiment.total, 1);
        const volumeBonus = Math.min(sentiment.total / 50, 1); // max bonus at 50+ messages
        score = Math.round((bullishRatio * 6 + sentiment.score * 3 + volumeBonus) * 1.1);
        score = Math.max(0, Math.min(10, score));
        isCatalyst = score >= 4; // Lower threshold than before

        if (isCatalyst) {
          enhancedReason += ` | Quality score: ${score}/10`;
          signals.push({
            symbol: sym.symbol,
            source: "stocktwits",
            sentiment: sentiment.score,
            volume: sentiment.total,
            bullish: sentiment.bullish,
            bearish: sentiment.bearish,
            reason: enhancedReason,
          });
          this.logger.log(this.name, "signal_accepted", { symbol: sym.symbol, score, sentiment: sentiment.score.toFixed(2), volume: sentiment.total });
        } else {
          this.logger.log(this.name, "filtered_noise", { 
            symbol: sym.symbol, 
            score, 
            bullish: sentiment.bullish, 
            total: sentiment.total,
            reason: `Score ${score} < 4` 
          });
        }
      }
      await sleep(300);
    }

    this.logger.log(this.name, "gathered_signals", { count: signals.length });
    return signals;
  }
}

// ============================================================================
// Crypto Agent - Momentum-based crypto trading (24/7)
// ============================================================================

class CryptoAgent {
  constructor(logger, config, mcpClient) {
    this.logger = logger;
    this.config = config;
    this.mcp = mcpClient;
    this.name = "Crypto";
    this.priceCache = new Map(); // Track prices for momentum
  }

  async callTool(name, args = {}) {
    const result = await this.mcp.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  }

  async getQuote(symbol) {
    try {
      // Use symbol-overview instead of market-quote
      const result = await this.callTool("symbol-overview", { symbol });
      if (result.ok) {
        const data = result.data;
        // Map symbol-overview output to what we expect (price, etc)
        // symbol-overview returns { latest_price, prev_close, ... }
        return {
          price: data.latest_price,
          prev_close: data.prev_close || data.daily_bar?.o, // Fallback if prev_close matching logic differs
          last: data.latest_price,
          close: data.latest_price
        };
      }
      return null;
    } catch (err) {
      this.logger.log(this.name, "quote_error", { symbol, error: err.message });
      return null;
    }
  }

  async gatherSignals() {
    if (!this.config.crypto_enabled) return [];

    const signals = [];
    const symbols = this.config.crypto_symbols || ["BTC/USD", "ETH/USD"];

    for (const symbol of symbols) {
      const quote = await this.getQuote(symbol);
      if (!quote) continue;

      const price = quote.price || quote.last || quote.close;
      const prevClose = quote.prev_close || quote.previous_close;

      if (!price) continue;

      // Calculate momentum (% change)
      let momentum = 0;
      if (prevClose && prevClose > 0) {
        momentum = ((price - prevClose) / prevClose) * 100;
      }

      // Store for tracking
      const lastPrice = this.priceCache.get(symbol);
      this.priceCache.set(symbol, { price, timestamp: Date.now() });

      // Calculate short-term momentum if we have previous data
      let shortTermMomentum = 0;
      if (lastPrice && lastPrice.price > 0) {
        shortTermMomentum = ((price - lastPrice.price) / lastPrice.price) * 100;
      }

      // Generate signal based on momentum
      const threshold = this.config.crypto_momentum_threshold || 2.0;
      const hasSignificantMove = Math.abs(momentum) >= threshold || Math.abs(shortTermMomentum) >= threshold * 0.5;

      // For crypto, always generate a signal if price is available (so dashboard shows it)
      // But only mark as bullish/buy-worthy if momentum exceeds threshold
      const isBullish = momentum > 0 || shortTermMomentum > 0;
      const effectiveMomentum = Math.abs(momentum) > Math.abs(shortTermMomentum) ? momentum : shortTermMomentum;

      // Sentiment scales with momentum: 2% move = 0.4 sentiment, 5% = 1.0
      const rawSentiment = hasSignificantMove && isBullish ? Math.min(Math.abs(effectiveMomentum) / 5, 1) : 0.1;

      signals.push({
        symbol,
        source: "crypto_momentum",
        sentiment: rawSentiment,
        volume: 100,
        bullish: isBullish ? 1 : 0,
        bearish: isBullish ? 0 : 1,
        reason: `Crypto: ${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}% (24h)${shortTermMomentum !== 0 ? `, ${shortTermMomentum >= 0 ? '+' : ''}${shortTermMomentum.toFixed(2)}% (recent)` : ''}`,
        isCrypto: true,
        momentum: effectiveMomentum,
        price,
      });

      await sleep(200);
    }

    this.logger.log(this.name, "gathered_signals", { count: signals.length });
    return signals;
  }
}

// ============================================================================
// Trading Executor
// ============================================================================

class TradingExecutor {
  constructor(mcpClient, logger, config) {
    this.mcp = mcpClient;
    this.logger = logger;
    this.config = config;
    this.name = "Executor";
    this.lastTrades = new Map();
  }

  async callTool(name, args = {}) {
    const result = await this.mcp.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  }

  async executeBuy(symbol, confidence, reasonText = "", isCrypto = false) {
    // Cooldown check (5 min)
    const lastTrade = this.lastTrades.get(symbol);
    if (lastTrade && Date.now() - lastTrade < 300_000) {
      this.logger.log(this.name, "skipped_cooldown", { symbol });
      return null;
    }

    const account = await this.callTool("accounts-get");
    if (!account.ok) return null;

    // Calculate position size - use crypto-specific limits if applicable
    const sizePct = this.config.position_size_pct_of_cash;
    const maxPositionValue = isCrypto
      ? this.config.crypto_max_position_value
      : this.config.max_position_value;

    const positionSize = Math.min(
      account.data.cash * (sizePct / 100) * confidence,
      maxPositionValue
    );

    // Lower minimum for crypto (can buy fractional)
    const minSize = isCrypto ? 10 : 100;
    if (positionSize < minSize) {
      this.logger.log(this.name, "skipped_size", { symbol, size: positionSize, isCrypto });
      return null;
    }

    this.logger.log(this.name, "preview_buy", { symbol, size: positionSize.toFixed(2), isCrypto });

    // Crypto uses GTC (good-til-canceled) since it trades 24/7
    const timeInForce = isCrypto ? "gtc" : "day";

    const preview = await this.callTool("orders-preview", {
      symbol,
      side: "buy",
      notional: Math.round(positionSize * 100) / 100,
      order_type: "market",
      time_in_force: timeInForce,
    });

    if (!preview.ok) {
      this.logger.log(this.name, "preview_failed", { symbol, error: preview.error?.message });
      return null;
    }

    if (!preview.data.policy.allowed) {
      const violationMsgs = (preview.data.policy.violations || []).map(v => v.message || v.rule).join("; ");
      this.logger.log(this.name, "policy_rejected", { symbol, violations: violationMsgs });
      return null;
    }

    const submit = await this.callTool("orders-submit", {
      approval_token: preview.data.policy.approval_token,
    });

    if (submit.ok) {
      this.lastTrades.set(symbol, Date.now());
      this.logger.log(this.name, "buy_executed", {
        symbol,
        status: submit.data.order.status,
        size: positionSize.toFixed(2),
        reason: reasonText,
        isCrypto,
      });
      return submit.data.order;
    } else {
      this.logger.log(this.name, "buy_failed", { symbol, error: submit.error?.message });
      return null;
    }
  }

  async executeSell(symbol, reason) {
    this.logger.log(this.name, "sell_initiated", { symbol, reason });

    const result = await this.callTool("positions-close", { symbol });

    if (result.ok) {
      this.logger.log(this.name, "sell_executed", { symbol, reason });
      return result.data.order;
    } else {
      this.logger.log(this.name, "sell_failed", { symbol, error: result.error?.message });
      return null;
    }
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

class SimpleOrchestrator {
  constructor() {
    this.config = loadConfig();
    this.logger = new ActivityLogger();
    this.signalCache = [];
    this.lastAnalystRun = 0;

    this.stocktwits = new StockTwitsAgent(this.logger);
    this.crypto = null; // Initialized after MCP connection
    this.executor = null;
    this.mcp = null;
  }

  async connect() {
    const url = this.config.mcp_url;
    console.log(`Connecting to MCP server at ${url}...`);

    try {
      const transport = new SSEClientTransport(new URL(url));
      this.mcp = new Client({ name: "nightwatcher", version: "1.0" }, { capabilities: {} });
      await this.mcp.connect(transport);
      this.executor = new TradingExecutor(this.mcp, this.logger, this.config);
      this.crypto = new CryptoAgent(this.logger, this.config, this.mcp);
      this.stocktwits.mcp = this.mcp;
      this.logger.log("System", "connected", { url });
      return true;
    } catch (err) {
      console.error("Connection error:", err);
      this.logger.log("System", "connection_failed", { error: err.message });
      return false;
    }
  }

  async getAccountState() {
    const [account, positions, clock] = await Promise.all([
      this.executor.callTool("accounts-get"),
      this.executor.callTool("positions-list"),
      this.executor.callTool("market-clock"),
    ]);
    return {
      account: account.ok ? account.data : null,
      positions: positions.ok ? positions.data.positions : [],
      clock: clock.ok ? clock.data : null,
    };
  }

  async runDataGatherers() {
    this.logger.log("System", "gathering_data");

    const stocktwitsSignals = await this.stocktwits.gatherSignals();
    const cryptoSignals = await this.crypto.gatherSignals();

    this.signalCache = [...stocktwitsSignals, ...cryptoSignals];

    this.logger.log("System", "data_gathered", {
      stocktwits: stocktwitsSignals.length,
      crypto: cryptoSignals.length,
      total: this.signalCache.length,
    });

    return this.signalCache;
  }

  // ==========================================================================
  // ==========================================================================
  //
  //   SECTION 2: TRADING STRATEGY  
  //
  //   This is the brain - decides when to buy and sell.
  //
  //   TO CUSTOMIZE:
  //   - Change the buy conditions (sentiment thresholds, volume, etc.)
  //   - Change the sell conditions (take profit, stop loss, etc.)
  //   - Add technical indicators using MCP's "technicals-get" tool
  //   - Add LLM analysis using MCP's "symbol-research" tool
  //   - Require multiple data sources to agree before trading
  //
  // ==========================================================================
  // ==========================================================================

  async runTradingLogic(cryptoOnly = false) {
    const { account, positions, clock } = await this.getAccountState();

    if (!account) {
      this.logger.log("System", "skipped_trading", { reason: "No account data" });
      return;
    }

    // For stock trading, check market hours. Crypto trades 24/7.
    const marketOpen = clock?.is_open;

    if (!cryptoOnly && !marketOpen) {
      this.logger.log("System", "market_closed");
      // Still process crypto if enabled
      if (this.config.crypto_enabled) {
        await this.runTradingLogic(true);
      }
      return;
    }

    const heldSymbols = new Set(positions.map(p => p.symbol));

    // Separate stock and crypto positions
    const cryptoSymbols = new Set(this.config.crypto_symbols || []);
    const stockPositions = positions.filter(p => !cryptoSymbols.has(p.symbol));
    const cryptoPositions = positions.filter(p => cryptoSymbols.has(p.symbol));

    // ========================================================================
    // STEP 1: Check existing positions for exit signals
    // ========================================================================
    for (const pos of positions) {
      const isCrypto = cryptoSymbols.has(pos.symbol);

      // Skip non-crypto if we're in crypto-only mode
      if (cryptoOnly && !isCrypto) continue;
      // Skip crypto if we're in stock mode and market is open
      if (!cryptoOnly && isCrypto) continue;

      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100;

      // Use crypto-specific or stock-specific thresholds
      const takeProfit = isCrypto ? this.config.crypto_take_profit_pct : this.config.take_profit_pct;
      const stopLoss = isCrypto ? this.config.crypto_stop_loss_pct : this.config.stop_loss_pct;

      // Take profit
      if (plPct >= takeProfit) {
        this.logger.log("System", "take_profit_triggered", { symbol: pos.symbol, pnl: plPct.toFixed(2), isCrypto });
        await this.executor.executeSell(pos.symbol, `Take profit at +${plPct.toFixed(1)}%`);
        continue;
      }

      // Stop loss
      if (plPct <= -stopLoss) {
        this.logger.log("System", "stop_loss_triggered", { symbol: pos.symbol, pnl: plPct.toFixed(2), isCrypto });
        await this.executor.executeSell(pos.symbol, `Stop loss at ${plPct.toFixed(1)}%`);
        continue;
      }
    }

    // ========================================================================
    // STEP 2: Look for new buy opportunities
    // ========================================================================

    // Separate signals by type
    const stockSignals = this.signalCache.filter(s => !s.isCrypto);
    const cryptoSignals = this.signalCache.filter(s => s.isCrypto);

    // Process stock signals (only if market open and not crypto-only mode)
    if (!cryptoOnly && marketOpen && stockPositions.length < (this.config.max_stock_positions ?? this.config.max_positions)) {
      const stockCandidates = stockSignals
        .filter(s => !heldSymbols.has(s.symbol))
        .filter(s => s.sentiment >= this.config.min_sentiment_score)
        .filter(s => s.volume >= this.config.min_volume)
        .sort((a, b) => b.sentiment - a.sentiment);

      this.logger.log("System", "stock_buy_candidates", { count: stockCandidates.length });

      for (const signal of stockCandidates.slice(0, 3)) {
        if (stockPositions.length >= (this.config.max_stock_positions ?? this.config.max_positions)) break;

        const confidence = Math.min(1, Math.max(0.5, signal.sentiment + 0.3));

        this.logger.log("System", "considering_buy", {
          symbol: signal.symbol,
          sentiment: signal.sentiment.toFixed(2),
          volume: signal.volume,
          type: "stock",
        });
        this.logger.increment("buySignals");

        const result = await this.executor.executeBuy(signal.symbol, confidence, signal.reason);

        if (result) {
          heldSymbols.add(signal.symbol);
          break; // One buy per cycle
        }
      }
    }

    // Process crypto signals (24/7, separate position limit)
    if (this.config.crypto_enabled) {
      const maxCryptoPositions = Math.min(this.config.crypto_symbols?.length || 3, 3);

      if (cryptoPositions.length < maxCryptoPositions) {
        const cryptoCandidates = cryptoSignals
          .filter(s => !heldSymbols.has(s.symbol))
          .filter(s => s.sentiment > 0) // Only bullish momentum
          .sort((a, b) => b.momentum - a.momentum);

        this.logger.log("System", "crypto_buy_candidates", { count: cryptoCandidates.length });

        for (const signal of cryptoCandidates.slice(0, 2)) {
          if (cryptoPositions.length >= maxCryptoPositions) break;

          // Crypto uses momentum as confidence
          const confidence = Math.min(1, Math.max(0.5, signal.sentiment));

          this.logger.log("System", "considering_buy", {
            symbol: signal.symbol,
            momentum: signal.momentum?.toFixed(2),
            type: "crypto",
          });
          this.logger.increment("buySignals");

          const result = await this.executor.executeBuy(
            signal.symbol,
            confidence,
            signal.reason,
            true // isCrypto flag
          );

          if (result) {
            heldSymbols.add(signal.symbol);
            cryptoPositions.push({ symbol: signal.symbol }); // Track locally
            break; // One crypto buy per cycle
          }
        }
      }
    }

    this.lastAnalystRun = Date.now();
  }

  // ==========================================================================
  // ==========================================================================
  //
  //   SECTION 3: HARNESS (you probably don't need to modify this)
  //
  //   This handles:
  //   - MCP server connection
  //   - Scheduling data gathering and trading loops
  //   - Dashboard API for the React frontend
  //   - Logging and config persistence
  //
  // ==========================================================================
  // ==========================================================================

  async run() {
    console.log("\n========================================");
    console.log("  NIGHTWATCHER - Simple Trading Agent");
    console.log("========================================\n");

    if (!(await this.connect())) {
      console.error("Failed to connect. Make sure MCP server is running: npm run dev");
      process.exit(1);
    }

    // Initial state
    const { account, positions, clock } = await this.getAccountState();
    if (account) {
      console.log(`Equity: $${account.equity.toFixed(2)} | Cash: $${account.cash.toFixed(2)} | Positions: ${positions.length}`);
    }
    console.log(`Market: ${clock?.is_open ? "OPEN" : "CLOSED"}\n`);

    // Save config
    saveConfig(this.config);

    // Run initial data gathering
    await this.runDataGatherers();

    if (clock?.is_open) {
      await this.runTradingLogic();
    }

    // Schedule recurring runs
    console.log(`Data gathering: every ${this.config.data_poll_interval_ms / 1000}s`);
    console.log(`Trading logic: every ${this.config.analyst_interval_ms / 1000}s`);
    if (this.config.crypto_enabled) {
      console.log(`Crypto trading: ENABLED (24/7)`);
      console.log(`Crypto symbols: ${this.config.crypto_symbols?.join(", ")}`);
    }
    console.log();

    // Data gatherers (runs 24/7)
    setInterval(async () => {
      try {
        await this.runDataGatherers();
      } catch (err) {
        this.logger.log("System", "error", { phase: "data_gathering", error: err.message });
      }
    }, this.config.data_poll_interval_ms);

    // Trading logic - handles both stocks (market hours) and crypto (24/7)
    setInterval(async () => {
      try {
        await this.runTradingLogic();
      } catch (err) {
        this.logger.log("System", "error", { phase: "trading", error: err.message });
      }
    }, this.config.analyst_interval_ms);

    // Save state periodically
    setInterval(() => {
      this.logger.save();
      saveConfig(this.config);
    }, 60_000);
  }

  getStatus() {
    return {
      config: this.config,
      signals: this.signalCache,
      logs: this.logger.getRecentLogs(100),
      costs: this.logger.getCosts(),
      lastAnalystRun: this.lastAnalystRun,
      overnightActivity: this.logger.stats,
      // NIGHTWATCHER doesn't have advanced features
      signalResearch: {},
      positionResearch: {},
      stalenessAnalysis: {},
      positionTracking: {},
      optionsEnabled: false,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HTTP API for Dashboard
// ============================================================================

function startDashboardAPI(orchestrator) {
  const PORT = orchestrator.config.dashboard_port || process.env.DASHBOARD_PORT || 3001;

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    try {
      if (url.pathname === "/api/status") {
        const { account, positions, clock } = await orchestrator.getAccountState();
        const status = orchestrator.getStatus();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          data: {
            account,
            positions,
            clock,
            ...status,
          },
        }));
      } else if (url.pathname === "/api/portfolio/history") {
        const period = url.searchParams.get("period") || "1D";
        const timeframe = url.searchParams.get("timeframe") || "15Min";
        try {
          const resTool = await orchestrator.executor.callTool("portfolio-history", { period, timeframe });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(resTool));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } else if (url.pathname === "/api/v3/regime") {
        try {
          const result = await orchestrator.executor.callTool("regime-detect", { force_refresh: false });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } else if (url.pathname === "/api/v3/risk") {
        try {
          const [kelly, sharpe, varResult] = await Promise.allSettled([
            orchestrator.executor.callTool("risk-kelly-size", { kelly_fraction_cap: 0.25, lookback_trades: 100 }),
            orchestrator.executor.callTool("risk-sharpe", { risk_free_annual_pct: 5.0, lookback_trades: 200 }),
            orchestrator.executor.callTool("risk-var", { confidence: "0.95", lookback_trades: 200 }),
          ]);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            data: {
              kelly: kelly.status === "fulfilled" && kelly.value.ok ? kelly.value.data : null,
              sharpe: sharpe.status === "fulfilled" && sharpe.value.ok ? sharpe.value.data : null,
              var: varResult.status === "fulfilled" && varResult.value.ok ? varResult.value.data : null,
            },
          }));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } else if (url.pathname === "/api/v3/signals") {
        try {
          const result = await orchestrator.executor.callTool("signal-list", { limit: 20 });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } else if (url.pathname === "/api/config" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: orchestrator.config }));
      } else if (url.pathname === "/api/config" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
          try {
            const newConfig = JSON.parse(body);
            orchestrator.config = { ...orchestrator.config, ...newConfig };
            saveConfig(orchestrator.config);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, data: orchestrator.config }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      } else if (url.pathname === "/api/logs") {
        const limit = parseInt(url.searchParams.get("limit") || "100");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: orchestrator.logger.getRecentLogs(limit) }));
      } else if (url.pathname === "/api/costs") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: orchestrator.logger.getCosts() }));
      } else if (url.pathname === "/api/setup/status") {
        const hasAlpaca = !!(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET);
        const hasOpenAI = !!process.env.OPENAI_API_KEY;
        const startingEquity = orchestrator.config.starting_equity || 100000;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          data: {
            configured: hasAlpaca,
            has_alpaca: hasAlpaca,
            has_openai: hasOpenAI,
            starting_equity: startingEquity,
            paper_mode: process.env.ALPACA_PAPER === "true"
          }
        }));
      } else if (url.pathname === "/api/setup/keys" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
          try {
            const { alpaca_key, alpaca_secret, openai_key, paper_mode, starting_equity } = JSON.parse(body);

            // Build .dev.vars content
            let envContent = "";
            if (alpaca_key) envContent += `ALPACA_API_KEY=${alpaca_key}\n`;
            if (alpaca_secret) envContent += `ALPACA_API_SECRET=${alpaca_secret}\n`;
            envContent += `ALPACA_PAPER=${paper_mode !== false ? "true" : "false"}\n`;
            if (openai_key) envContent += `OPENAI_API_KEY=${openai_key}\n`;
            envContent += `KILL_SWITCH_SECRET=nightwatcher_kill_${Date.now()}\n`;

            // Write to .dev.vars
            const envPath = path.join(__dirname, ".dev.vars");
            fs.writeFileSync(envPath, envContent);

            // Update config with starting equity
            if (starting_equity) {
              orchestrator.config.starting_equity = starting_equity;
              saveConfig(orchestrator.config);
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              message: "Configuration saved. Please restart the agent."
            }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  server.listen(PORT, () => {
    console.log(`Dashboard API: http://localhost:${PORT}`);
    console.log(`  GET  /api/status  - Full status`);
    console.log(`  GET  /api/config  - Get config`);
    console.log(`  POST /api/config  - Update config`);
    console.log(`  GET  /api/logs    - Activity logs\n`);
  });
}

// ============================================================================
// Entry Point
// ============================================================================

const orchestrator = new SimpleOrchestrator();
startDashboardAPI(orchestrator);
orchestrator.run().catch(console.error);
