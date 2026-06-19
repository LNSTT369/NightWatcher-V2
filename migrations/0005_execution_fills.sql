-- Execution quality tracking: every fill gets measured against expected price
CREATE TABLE execution_fills (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trade_id TEXT REFERENCES trades(id),
  alpaca_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL NOT NULL,
  fill_price REAL,
  expected_price REAL,
  vwap_at_fill REAL,
  slippage_bps REAL,
  fill_latency_ms INTEGER,
  partial_fill_pct REAL NOT NULL DEFAULT 100,
  venue TEXT NOT NULL DEFAULT 'alpaca',
  algo_type TEXT NOT NULL DEFAULT 'market',
  dark_pool_pct REAL NOT NULL DEFAULT 0,
  signal_id TEXT,
  aggregated_signal_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_execution_fills_symbol     ON execution_fills(symbol);
CREATE INDEX idx_execution_fills_created_at ON execution_fills(created_at);
CREATE INDEX idx_execution_fills_trade_id   ON execution_fills(trade_id);
CREATE INDEX idx_execution_fills_venue      ON execution_fills(venue);
