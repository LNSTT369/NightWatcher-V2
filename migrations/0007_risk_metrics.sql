CREATE TABLE risk_metric_snapshots (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  snapshot_type TEXT NOT NULL,   -- 'kelly' | 'sharpe' | 'var' | 'correlation'
  symbol TEXT,                   -- null for portfolio-level metrics
  symbol_b TEXT,                 -- second symbol for correlation
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Kelly fields
  kelly_fraction REAL,
  recommended_pct_equity REAL,
  win_rate REAL,
  avg_win_pct REAL,
  avg_loss_pct REAL,
  odds_ratio REAL,
  edge REAL,

  -- Sharpe fields
  sharpe_ratio REAL,
  annualized_return_pct REAL,
  annualized_vol_pct REAL,
  n_observations INTEGER,

  -- VaR fields
  var_usd REAL,
  var_pct REAL,
  cvar_usd REAL,
  cvar_pct REAL,
  confidence REAL,

  -- Correlation fields
  pearson_r REAL,
  is_over_threshold INTEGER,     -- boolean

  raw_json TEXT NOT NULL         -- full result JSON for auditability
);

CREATE INDEX idx_risk_metrics_type ON risk_metric_snapshots(snapshot_type);
CREATE INDEX idx_risk_metrics_symbol ON risk_metric_snapshots(symbol);
CREATE INDEX idx_risk_metrics_computed ON risk_metric_snapshots(computed_at);
