export const MAX_RISK_PERCENT = 2;
export const MAX_ABSOLUTE_UNITS = 1_000_000;
export const MIN_RISK_REWARD = 1.5;

export function pipSize(instrument: string) {
  if (instrument.endsWith("_JPY")) return 0.01;
  if (instrument.startsWith("XAU_")) return 0.1;
  if (instrument.startsWith("US30_")) return 1;
  return 0.0001;
}

export function instrumentPricePrecision(instrument: string) {
  if (instrument.endsWith("_JPY")) return 3;
  if (instrument.startsWith("XAU_")) return 3;
  if (instrument.startsWith("US30_")) return 1;
  return 5;
}

export type ProtectedOrderCheck =
  | { ok: true; stopDistance: number; targetDistance: number; riskReward: number }
  | { ok: false; error: string };

export function validateProtectedOrder(input: {
  instrument: string;
  units: number;
  entry: number;
  stopLoss: number | null | undefined;
  takeProfit: number | null | undefined;
  maxUnits?: number;
  minRiskReward?: number;
}): ProtectedOrderCheck {
  const maxUnits = Math.max(1, Math.floor(input.maxUnits ?? MAX_ABSOLUTE_UNITS));
  if (!Number.isSafeInteger(input.units) || input.units === 0) {
    return { ok: false, error: "Order units must be a non-zero whole number." };
  }
  if (Math.abs(input.units) > maxUnits) {
    return { ok: false, error: `Order size exceeds the ${maxUnits.toLocaleString()} unit safety limit.` };
  }
  if (!Number.isFinite(input.entry) || input.entry <= 0) {
    return { ok: false, error: "A valid live execution price is required." };
  }
  if (!Number.isFinite(input.stopLoss) || Number(input.stopLoss) <= 0 || !Number.isFinite(input.takeProfit) || Number(input.takeProfit) <= 0) {
    return { ok: false, error: "Every order must have a valid broker-side stop loss and take profit." };
  }

  const stopLoss = Number(input.stopLoss);
  const takeProfit = Number(input.takeProfit);
  const long = input.units > 0;
  const levelsOrdered = long
    ? stopLoss < input.entry && input.entry < takeProfit
    : takeProfit < input.entry && input.entry < stopLoss;
  if (!levelsOrdered) {
    return { ok: false, error: `For a ${long ? "long" : "short"} order, stop, live entry and target are not in the required order.` };
  }

  const stopDistance = Math.abs(input.entry - stopLoss);
  const targetDistance = Math.abs(takeProfit - input.entry);
  if (stopDistance < pipSize(input.instrument)) {
    return { ok: false, error: "The stop loss is less than one pip or point from the live entry." };
  }
  const riskReward = targetDistance / stopDistance;
  const minimum = input.minRiskReward ?? MIN_RISK_REWARD;
  if (!Number.isFinite(riskReward) || riskReward + 1e-9 < minimum) {
    return { ok: false, error: `The live risk/reward is ${Number.isFinite(riskReward) ? riskReward.toFixed(2) : "invalid"}; at least ${minimum.toFixed(2)} is required.` };
  }
  return { ok: true, stopDistance, targetDistance, riskReward };
}

export function calculateRiskSizedUnits(input: {
  equity: number;
  riskPercent: number;
  stopDistance: number;
  lossConversionFactor: number;
  maxUnits?: number;
}) {
  if (!Number.isFinite(input.equity) || input.equity <= 0) return null;
  if (!Number.isFinite(input.riskPercent) || input.riskPercent <= 0 || input.riskPercent > MAX_RISK_PERCENT) return null;
  if (!Number.isFinite(input.stopDistance) || input.stopDistance <= 0) return null;
  if (!Number.isFinite(input.lossConversionFactor) || input.lossConversionFactor <= 0) return null;

  const riskAmount = input.equity * input.riskPercent / 100;
  const cashRiskPerUnit = input.stopDistance * input.lossConversionFactor;
  const units = Math.min(
    Math.max(1, Math.floor(input.maxUnits ?? MAX_ABSOLUTE_UNITS)),
    Math.floor(riskAmount / cashRiskPerUnit),
  );
  return units >= 1 ? { units, riskAmount, cashRiskPerUnit } : null;
}

export type SizeLockScope = "none" | "daily" | "weekly";

export function positionRiskAmount(input: {
  units: number;
  stopDistance: number;
  lossConversionFactor: number;
}) {
  if (!Number.isSafeInteger(input.units) || input.units <= 0) return null;
  if (!Number.isFinite(input.stopDistance) || input.stopDistance <= 0) return null;
  if (!Number.isFinite(input.lossConversionFactor) || input.lossConversionFactor <= 0) return null;
  return input.units * input.stopDistance * input.lossConversionFactor;
}

export function standardLots(instrument: string, units: number) {
  if (instrument.startsWith("XAU_") || instrument.startsWith("US30_")) return null;
  return Math.abs(units) / 100_000;
}

export function positionSizeLockPeriod(scope: SizeLockScope, now = new Date()) {
  if (scope === "none") return null;
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (scope === "daily") return day.toISOString().slice(0, 10);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - weekday + 1);
  return `${day.toISOString().slice(0, 10)}-week`;
}

export function resolveLockedPositionSize(input: {
  riskSafeUnits: number;
  lockedUnits?: number | null;
}) {
  if (!Number.isSafeInteger(input.riskSafeUnits) || input.riskSafeUnits <= 0) return { ok: false as const, reason: "No valid risk-safe size is available." };
  if (input.lockedUnits == null) return { ok: true as const, units: input.riskSafeUnits, created: true };
  if (!Number.isSafeInteger(input.lockedUnits) || input.lockedUnits <= 0) return { ok: false as const, reason: "The stored fixed position size is invalid." };
  if (input.lockedUnits > input.riskSafeUnits) {
    return { ok: false as const, reason: `The fixed size of ${input.lockedUnits.toLocaleString()} units exceeds the current risk-safe limit of ${input.riskSafeUnits.toLocaleString()} units.` };
  }
  return { ok: true as const, units: input.lockedUnits, created: false };
}

export function hasTriggerConfirmation(strategies: Array<{ id: string; status: string }> | null | undefined) {
  return strategies?.some((strategy) => strategy.id !== "trend-continuation" && (strategy.status === "confirmed" || strategy.status === "selected")) ?? false;
}
