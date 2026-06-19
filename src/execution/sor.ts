// Smart Order Router (SOR) — venue and algo selection.
// Phase 4 stub: always routes to Alpaca. Institutional venue wired in when Richard's firm
// API credentials + REST spec arrive (Phase 1 dependency). Decision logic is complete;
// only the venue assignment changes when institutional is live.

export type Venue = "alpaca" | "institutional";
export type AlgoType = "market" | "limit" | "twap" | "vwap";

export interface SorInput {
  symbol: string;
  side: "buy" | "sell";
  total_qty: number;
  notional_usd: number;
  urgency: "immediate" | "session" | "swing";
  signal_source?: "llm" | "technical" | "l2_microstructure" | "dark_pool" | "external" | "manual";
  signal_confidence?: number; // 0–1
}

export interface SorDecision {
  venue: Venue;
  algo: AlgoType;
  rationale: string;
  dark_pool_eligible: boolean;
  // True when institutional routing would be preferred but isn't connected yet.
  requires_institutional: boolean;
  routing_notes: string[];
  // Suggested params for the chosen algo
  suggested_duration_minutes?: number;
  suggested_interval_minutes?: number;
}

// Thresholds for routing decisions
const DARK_POOL_THRESHOLD_USD = 25_000;  // orders above this qualify for dark pool routing
const BLOCK_ORDER_THRESHOLD_USD = 100_000; // block orders — strongly prefer institutional when live

export function routeOrder(input: SorInput): SorDecision {
  const notes: string[] = [];
  const isDarkPoolEligible = input.notional_usd >= DARK_POOL_THRESHOLD_USD;
  const isBlockOrder = input.notional_usd >= BLOCK_ORDER_THRESHOLD_USD;

  if (isBlockOrder) {
    notes.push(`Block order (≥$${(BLOCK_ORDER_THRESHOLD_USD / 1000).toFixed(0)}k) — institutional dark pool preferred when connected`);
  } else if (isDarkPoolEligible) {
    notes.push(`Large order (≥$${(DARK_POOL_THRESHOLD_USD / 1000).toFixed(0)}k) — qualifies for dark pool routing`);
  }

  // Dark pool signal from upstream (Richard's firm L2/dark pool feed)
  if (input.signal_source === "dark_pool") {
    notes.push("Dark pool signal source — routing for minimal market footprint");
  }

  // Immediate urgency: speed > cost, always market order
  if (input.urgency === "immediate") {
    notes.push("Immediate urgency — no slicing, market order for fastest fill");
    return {
      venue: "alpaca",
      algo: "market",
      rationale: "Immediate urgency: speed prioritized over market impact cost",
      dark_pool_eligible: isDarkPoolEligible,
      requires_institutional: false,
      routing_notes: notes,
    };
  }

  // Large notional + session/swing → VWAP to minimize market impact
  if (isDarkPoolEligible) {
    const durationMins = input.urgency === "swing" ? 390 : 120; // full day vs. 2h
    notes.push(`VWAP slicing over ${durationMins} minutes reduces market impact for size`);
    if (isBlockOrder) {
      notes.push("Institutional dark pool would reduce cost further — connect when API is live");
    }
    return {
      venue: "alpaca",
      algo: "vwap",
      rationale: isBlockOrder
        ? "Block order: VWAP via Alpaca (institutional dark pool preferred when available)"
        : "Large position: VWAP over session minimizes information leakage",
      dark_pool_eligible: isDarkPoolEligible,
      requires_institutional: isBlockOrder,
      routing_notes: notes,
      suggested_duration_minutes: durationMins,
      suggested_interval_minutes: 15,
    };
  }

  // Swing urgency + smaller size → TWAP for disciplined entry over time
  if (input.urgency === "swing") {
    notes.push("Swing trade: TWAP provides consistent fill cadence without intraday concentration");
    return {
      venue: "alpaca",
      algo: "twap",
      rationale: "Swing trade: TWAP for predictable, evenly-spaced fills over the session",
      dark_pool_eligible: false,
      requires_institutional: false,
      routing_notes: notes,
      suggested_duration_minutes: 120,
      suggested_interval_minutes: 15,
    };
  }

  // Default: standard market order
  notes.push("Standard size and urgency — no slicing needed");
  return {
    venue: "alpaca",
    algo: "market",
    rationale: "Standard order: size and urgency do not require algorithmic execution",
    dark_pool_eligible: false,
    requires_institutional: false,
    routing_notes: notes,
  };
}
