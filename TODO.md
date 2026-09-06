# Foresight improvement backlog

Updated: 2026-09-06. This is a planned backlog, not a claim of completed work.
Priority order: trustworthy records → reproducible research → prospective paper
evidence → controlled promotion → wider strategy coverage.

## P0 — Trustworthy trading records and execution

- [ ] Record an immutable signal snapshot: strategy ID/version/parameters, market
  condition, candle cutoff, timeframe, original reasoning and invalidation.
- [ ] Add a trade timeline linking signal, quote, order intent, broker submission,
  fill, management decisions and exit; retain separate event timestamps.
- [ ] Reconcile uncertain execution intents automatically against broker records;
  resolve fills/rejections without duplicate orders, including after restart.
- [ ] Report journal completeness; preserve unknown historical fields instead of
  inventing reasons, versions or market conditions.
- [ ] Calculate per-account exposure using current broker equity, all positions,
  currency conversion and directional shared-currency exposure.
- [ ] Add integration tests for partial fills, rejected orders, timeouts,
  disconnections, restarts and out-of-order broker events.

## P1 — Quant Lab

Existing foundation: four versioned research strategies, historical candle
cache/import, shared decision/replay logic, chronological evaluation, final
holdout, cost stress checks and exportable research runs. Research observations
are available in the scanner; legacy rules still drive live execution.

- [ ] Consolidate learning/research entry points into one Quant Lab with a clear
  experiment list, new experiment form, result comparison and paper-test view.
- [ ] Make experiments reproducible: save hypothesis, code/strategy version,
  dataset fingerprint, data source, parameters, costs and evaluation boundaries.
- [ ] Add a data-quality report for gaps, duplicates, timezone/session alignment,
  unfinished bars and coverage; distinguish scheduled closures from missing data.
- [ ] Support historical bid/ask, variable spreads, financing, account conversion,
  session restrictions and execution-delay/slippage scenarios.
- [ ] Run longer experiments as durable jobs with progress, cancellation and
  restart recovery, instead of relying on one HTTP request.
- [ ] Compare baseline and candidate on identical data and assumptions; show
  drawdown, after-cost results, sample size and uncertainty in plain English.
- [ ] Add robustness checks across time periods, instruments, sessions and nearby
  parameter values; retain failed experiments as well as successful ones.
- [ ] Register every trial and detect overlapping/reused evaluation data; add
  uncertainty estimates and selection-bias checks appropriate to the sample.
- [ ] Reserve fresh future evaluation periods. Repeatedly viewed holdouts must
  not be presented as unseen evidence.
- [ ] Add prospective paper trading with immutable signals, simulated fills,
  costs and outcomes; use the same versioned decision and management rules.

## P1 — Strategy library and lifecycle

Current 1.0.0 research prototypes: trend pullback, range breakout, failed breakout
recovery (liquidity reclaim), and strong directional move (imbalance continuation).
They are not validated profitable strategies. They currently share generic risk
parameters and broad condition labels; suitability requires further testing.

- [ ] Give each strategy a complete contract: intended market behaviour, entry,
  exit, invalidation, holding period, market/timeframe support and risk rules.
- [ ] Review each prototype's implementation against that contract; make range
  boundaries and other rule descriptions accurately reflect selected parameters.
- [ ] Make preferred/avoided conditions strategy-specific; test condition filters
  before enforcing them. Avoid presenting a descriptive label as a proven edge.
- [ ] Add exact version and parameter identity to every research/paper/live event;
  keep released versions immutable and old versions available for open trades.
- [ ] Implement lifecycle states: draft → research → paper → eligible for live →
  paused/retired. Persist evidence, approval and reasons for each transition.
- [ ] Define promotion criteria before experiments, including evidence quantity,
  unseen performance, execution realism, risk limits and prospective results.
- [ ] Connect approved versions to a shared execution adapter; verify parity
  across replay, paper and live decision/management paths before activation.
- [ ] Add rollback and pause controls; preserve original rules for existing trades.
- [ ] Research additional hypotheses individually: range mean reversion and
  session opening-range breakout. Register each before searching parameters.
- [ ] Evaluate LuxAlgo as an optional feature source: establish access/licensing,
  timestamp availability and non-repainting evidence; compare with/without it
  under identical conditions. Keep unverified history out of backtests.

## P2 — Evidence-based self-improvement

- [ ] Diagnose execution costs, entry timing, stop placement and condition mismatch
  using recorded observations; distinguish association from a supported cause.
- [ ] Turn each diagnosis into a persisted, falsifiable hypothesis and controlled
  experiment with a baseline, success criteria and trial budget.
- [ ] Compare candidate and current strategy prospectively; record why a proposed
  change was rejected, retained or promoted.
- [ ] Monitor drift and degradation with predetermined thresholds and adequate
  samples; alert or pause according to explicit policy rather than recent losses.
- [ ] Keep AI proposals separate from deterministic calculations and promotion
  authority. Never claim these safeguards eliminate overfitting.

## P2 — Model connections, UI and reliability

- [ ] Add provider connection/capability tests, structured-output validation,
  deadlines, bounded retries and explicitly configured fallback behaviour.
- [ ] Wire fast and reasoning roles to defined tasks; record model, latency, cost
  and outcome so role selection can be evaluated.
- [ ] Refocus the dashboard on what is happening, why to wait, what could go wrong
  and what changed; keep detailed indicators available on demand.
- [ ] Show research status, missing evidence, last successful sync and data age
  consistently across pages; improve mobile navigation and empty/error states.
- [ ] Persist the full selected-pair workspace and prevent late responses from
  overwriting a newly selected market; verify rapid-switch behaviour.
- [ ] Add runtime health checks, alerting, migration/recovery procedures and
  browser-level checks for connection, research and journal workflows.

## Next delivery milestone

- [ ] Complete one end-to-end path: versioned strategy → immutable signal → paper
  order/fill → complete journal → evidence-backed diagnosis → registered experiment.
- [ ] Demonstrate recovery after interruption and identical strategy decisions
  across historical replay and prospective observation before widening scope.
