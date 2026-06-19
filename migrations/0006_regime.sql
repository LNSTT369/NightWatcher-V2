-- Phase 2: Regime snapshots
CREATE TABLE IF NOT EXISTS regime_snapshots (
  id              TEXT PRIMARY KEY,
  regime          TEXT NOT NULL,           -- trending_bull | trending_bear | range_bound | high_volatility | low_volatility | crisis
  confidence      REAL NOT NULL,
  detected_at     TEXT NOT NULL,
  expires_at      TEXT NOT NULL,

  -- Raw classification inputs (audit trail)
  spy_return_20d  REAL,
  adx             REAL,
  atr_pct         REAL,
  realized_vol_20d REAL,

  -- Risk overrides derived from regime
  confidence_threshold_override REAL,
  position_size_multiplier      REAL NOT NULL DEFAULT 1.0,
  signal_ttl_override_seconds   INTEGER,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_regime_snapshots_detected_at ON regime_snapshots (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_regime_snapshots_regime ON regime_snapshots (regime);
