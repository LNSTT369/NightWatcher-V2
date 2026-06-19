// Venue-agnostic TWAP/VWAP order slicing.
// Input: total_qty, side, duration_minutes, interval_minutes, optional start_time_iso.
// Output: AlgoSchedule with child orders [{qty, not_before_iso}].

export interface ChildOrder {
  slice_index: number;
  qty: number;
  not_before_iso: string;
  weight: number; // fraction of total_qty assigned to this slice
}

export interface AlgoSchedule {
  algo: "twap" | "vwap";
  symbol: string;
  side: "buy" | "sell";
  total_qty: number;
  slices: number;
  duration_minutes: number;
  interval_minutes: number;
  start_time_iso: string;
  end_time_iso: string;
  children: ChildOrder[];
}

export interface AlgoInput {
  symbol: string;
  side: "buy" | "sell";
  total_qty: number;
  duration_minutes: number;
  interval_minutes: number;
  start_time_iso?: string; // defaults to now
}

// Standard U-shaped intraday volume profile (30-min ET buckets, 9:30–16:00).
// Weights sum to 1.0. Source: academic consensus on intraday volume patterns.
const VOLUME_PROFILE: ReadonlyArray<{ etHour: number; etMinute: number; weight: number }> = [
  { etHour: 9, etMinute: 30, weight: 0.16 },
  { etHour: 10, etMinute: 0, weight: 0.10 },
  { etHour: 10, etMinute: 30, weight: 0.08 },
  { etHour: 11, etMinute: 0, weight: 0.07 },
  { etHour: 11, etMinute: 30, weight: 0.06 },
  { etHour: 12, etMinute: 0, weight: 0.05 },
  { etHour: 12, etMinute: 30, weight: 0.05 },
  { etHour: 13, etMinute: 0, weight: 0.06 },
  { etHour: 13, etMinute: 30, weight: 0.06 },
  { etHour: 14, etMinute: 0, weight: 0.06 },
  { etHour: 14, etMinute: 30, weight: 0.07 },
  { etHour: 15, etMinute: 0, weight: 0.08 },
  { etHour: 15, etMinute: 30, weight: 0.10 },
] as const;

// Approximate DST: EDT (UTC-4) for months 3–11, EST (UTC-5) otherwise.
function getVolumeWeightForSlotMs(slotMs: number): number {
  const d = new Date(slotMs);
  const month = d.getUTCMonth() + 1;
  const offsetMs = (month >= 3 && month <= 11 ? 4 : 5) * 3600 * 1000;
  const etMs = slotMs - offsetMs;
  const etHour = new Date(etMs).getUTCHours();
  const etMin = new Date(etMs).getUTCMinutes();
  const etMinutes = etHour * 60 + etMin;

  for (const bucket of VOLUME_PROFILE) {
    const start = bucket.etHour * 60 + bucket.etMinute;
    if (etMinutes >= start && etMinutes < start + 30) return bucket.weight;
  }
  // Outside market hours: flat weight
  return 1 / VOLUME_PROFILE.length;
}

export function buildTwapSchedule(input: AlgoInput): AlgoSchedule {
  const startMs = input.start_time_iso ? new Date(input.start_time_iso).getTime() : Date.now();
  const n = Math.max(1, Math.floor(input.duration_minutes / input.interval_minutes));
  const baseQty = Math.floor(input.total_qty / n);
  const remainder = input.total_qty - baseQty * n;
  const intervalMs = input.interval_minutes * 60 * 1000;

  const children: ChildOrder[] = Array.from({ length: n }, (_, i) => ({
    slice_index: i,
    qty: i === n - 1 ? baseQty + remainder : baseQty,
    not_before_iso: new Date(startMs + i * intervalMs).toISOString(),
    weight: (i === n - 1 ? baseQty + remainder : baseQty) / input.total_qty,
  }));

  return {
    algo: "twap",
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    total_qty: input.total_qty,
    slices: n,
    duration_minutes: input.duration_minutes,
    interval_minutes: input.interval_minutes,
    start_time_iso: new Date(startMs).toISOString(),
    end_time_iso: new Date(startMs + input.duration_minutes * 60 * 1000).toISOString(),
    children,
  };
}

export function buildVwapSchedule(input: AlgoInput): AlgoSchedule {
  const startMs = input.start_time_iso ? new Date(input.start_time_iso).getTime() : Date.now();
  const n = Math.max(1, Math.floor(input.duration_minutes / input.interval_minutes));
  const intervalMs = input.interval_minutes * 60 * 1000;

  // Collect raw weights for each slot, then normalize to sum = 1
  const rawWeights = Array.from({ length: n }, (_, i) =>
    getVolumeWeightForSlotMs(startMs + i * intervalMs)
  );
  const totalRaw = rawWeights.reduce((a, b) => a + b, 0);
  const weights = rawWeights.map((w) => w / totalRaw);

  // Integer-share allocation: round each slice, give remainder to last
  let allocated = 0;
  const children: ChildOrder[] = Array.from({ length: n }, (_, i) => {
    const weight = weights[i]!;
    const qty =
      i === n - 1
        ? Math.max(0, input.total_qty - allocated)
        : Math.max(1, Math.round(input.total_qty * weight));
    if (i < n - 1) allocated += qty;
    return {
      slice_index: i,
      qty,
      not_before_iso: new Date(startMs + i * intervalMs).toISOString(),
      weight,
    };
  });

  return {
    algo: "vwap",
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    total_qty: input.total_qty,
    slices: n,
    duration_minutes: input.duration_minutes,
    interval_minutes: input.interval_minutes,
    start_time_iso: new Date(startMs).toISOString(),
    end_time_iso: new Date(startMs + input.duration_minutes * 60 * 1000).toISOString(),
    children,
  };
}
