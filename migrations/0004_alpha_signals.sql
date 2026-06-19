-- Alpha signals: individual signals emitted by any source
CREATE TABLE alpha_signals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'equity',
  direction TEXT NOT NULL,
  confidence REAL NOT NULL,
  urgency TEXT NOT NULL,
  horizon_mins INTEGER NOT NULL DEFAULT 60,
  suggested_notional REAL,
  suggested_pct_equity REAL,
  rationale TEXT NOT NULL DEFAULT '',
  regime_tags TEXT NOT NULL DEFAULT '[]',
  supporting_data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  aggregated_signal_id TEXT,
  generated_at TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 300,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_alpha_signals_symbol      ON alpha_signals(symbol);
CREATE INDEX idx_alpha_signals_status      ON alpha_signals(status);
CREATE INDEX idx_alpha_signals_source      ON alpha_signals(source);
CREATE INDEX idx_alpha_signals_expires_at  ON alpha_signals(expires_at);
CREATE INDEX idx_alpha_signals_created_at  ON alpha_signals(created_at);

-- Aggregated signals: the resolved output after conflict detection + scoring
CREATE TABLE aggregated_signals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  symbol TEXT NOT NULL,
  final_direction TEXT NOT NULL,
  final_confidence REAL NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  conflict_detected INTEGER NOT NULL DEFAULT 0,
  contributing_signal_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_aggregated_signals_symbol     ON aggregated_signals(symbol);
CREATE INDEX idx_aggregated_signals_created_at ON aggregated_signals(created_at);
