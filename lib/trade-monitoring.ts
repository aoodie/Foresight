export type TradeReviewSource = "autonomous" | "dashboard_manual";

export function tradeReviewSource(input: {
  managedByWorker: boolean;
  clientTag?: string | null;
  monitorDashboardTrades: boolean;
}): TradeReviewSource | null {
  if (input.managedByWorker) return "autonomous";
  if (input.monitorDashboardTrades && input.clientTag === "foresight-manual") return "dashboard_manual";
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
