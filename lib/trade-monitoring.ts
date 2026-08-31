export type TradeReviewSource = "autonomous" | "dashboard_manual";

export function foresightTradeSource(clientTag?: string | null): TradeReviewSource | null {
  if (clientTag === "foresight-autotrader") return "autonomous";
  if (clientTag === "foresight-manual") return "dashboard_manual";
  return null;
}

export function tradeReviewSource(input: {
  managedByWorker: boolean;
  clientTag?: string | null;
  monitorDashboardTrades: boolean;
}): TradeReviewSource | null {
  if (input.managedByWorker) return "autonomous";
  if (input.monitorDashboardTrades && foresightTradeSource(input.clientTag) === "dashboard_manual") return "dashboard_manual";
  return null;
}

export function canAutoCloseReviewedTrade(input: {
  source: TradeReviewSource;
  autoCloseAutonomous: boolean;
  autoCloseDashboardManual: boolean;
}) {
  if (!input.autoCloseAutonomous) return false;
  return input.source === "autonomous" || input.autoCloseDashboardManual;
}
