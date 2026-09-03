export type TradeReviewSource = "autonomous" | "dashboard_manual";

export function foresightTradeSource(clientTag?: string | null, clientId?: string | null): TradeReviewSource | null {
  if (clientTag === "foresight-autotrader") return "autonomous";
  if (clientTag === "foresight-manual") return "dashboard_manual";
  // ORDER_FILL history exposes clientOrderID, not the trade client-extension
  // object. Preserve source attribution when the richer tag is unavailable.
  if (clientId?.startsWith("foresight-ui-")) return "dashboard_manual";
  if (clientId?.startsWith("foresight-")) return "autonomous";
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
