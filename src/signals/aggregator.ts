import type { AlphaSignal, AggregatedSignal, SignalDirection } from "./types";
import { SOURCE_WEIGHTS } from "./types";
import { generateId, nowISO } from "../lib/utils";

// Exponential freshness decay: score falls to ~37% at TTL, ~5% at 3×TTL.
// This means a 60-second "immediate" signal is nearly worthless after 3 minutes.
function freshnessDecay(signal: AlphaSignal): number {
  const elapsedSeconds = (Date.now() - new Date(signal.generated_at).getTime()) / 1000;
  return Math.exp(-elapsedSeconds / signal.ttl_seconds);
}

function isExpired(signal: AlphaSignal): boolean {
  const elapsedMs = Date.now() - new Date(signal.generated_at).getTime();
  return elapsedMs > signal.ttl_seconds * 1000;
}

export interface AggregatorOptions {
  // Per-source weight overrides (e.g. for a specific external counterparty)
  sourceWeightOverrides?: Partial<Record<string, number>>;
}

export function aggregateSignals(
  signals: AlphaSignal[],
  options: AggregatorOptions = {}
): AggregatedSignal {
  const { sourceWeightOverrides = {} } = options;

  const symbol = signals[0]?.symbol ?? "";

  // Drop expired signals before processing
  const live = signals.filter((s) => !isExpired(s));

  if (live.length === 0) {
    return {
      aggregated_id: generateId(),
      symbol,
      final_direction: "neutral",
      final_confidence: 0,
      source_count: 0,
      conflict_detected: false,
      contributing_signals: [],
      created_at: nowISO(),
    };
  }

  // Detect directional conflict (ignore neutral-only signals)
  const directions = new Set(
    live.map((s) => s.direction).filter((d) => d !== "neutral")
  );
  const conflict_detected = directions.size > 1;

  if (conflict_detected) {
    return {
      aggregated_id: generateId(),
      symbol,
      final_direction: "neutral",
      final_confidence: 0,
      source_count: live.length,
      conflict_detected: true,
      contributing_signals: live,
      created_at: nowISO(),
    };
  }

  // score_i = confidence_i × freshness_decay_i × source_weight_i
  const scored = live.map((s) => {
    const weight = sourceWeightOverrides[s.source] ?? SOURCE_WEIGHTS[s.source] ?? 0.5;
    const decay = freshnessDecay(s);
    return { signal: s, score: s.confidence * decay * weight, weight };
  });

  const totalScore = scored.reduce((sum, { score }) => sum + score, 0);
  const maxPossibleScore = scored.reduce((sum, { weight }) => sum + weight, 0);

  // Normalize to [0, 0.95] — never assign perfect confidence
  const final_confidence =
    maxPossibleScore > 0
      ? Math.min(totalScore / maxPossibleScore, 0.95)
      : 0;

  const final_direction: SignalDirection =
    directions.size === 1
      ? (Array.from(directions)[0] as SignalDirection)
      : "neutral";

  return {
    aggregated_id: generateId(),
    symbol,
    final_direction,
    final_confidence,
    source_count: live.length,
    conflict_detected: false,
    contributing_signals: live,
    created_at: nowISO(),
  };
}

// Returns true if a signal is still within its TTL window
export function isSignalLive(signal: AlphaSignal): boolean {
  return !isExpired(signal);
}

// Current freshness score for a signal (1.0 = just created, 0.0 = expired)
export function signalFreshness(signal: AlphaSignal): number {
  if (isExpired(signal)) return 0;
  return freshnessDecay(signal);
}
