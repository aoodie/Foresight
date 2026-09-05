# Quant engine contract

`lib/quant` is a broker- and UI-independent TypeScript library. Import its context,
registry, decision and replay functions from Node, a notebook bridge, an HTTP
adapter or another application. No strategy imports React, Cloudflare or OANDA.

Bars carry open, close and availability times in UTC milliseconds. A decision
can see only completed bars whose close and availability are at or before its
as-of time. Higher bars obey the same rule. Confirmed pivots retain their actual
confirmation time. External indicator evidence never creates a trading signal;
unverified historical evidence is excluded.

The four 1.0.0 strategy definitions are new research versions, not a relabeling
of the older scanner. Registry definitions and parameters are frozen. Version
changes require a new registry entry and new validation. Both live context and
historical replay call `decide`. Replay fills at the next open, charges explicit
costs, assumes the stop wins an ambiguous stop/target bar, and closes unresolved
positions at the end of the dataset with a distinct reason. R is measured from
actual simulated entry to original stop, not from a future-adjusted target.

Non-repainting tests cover prefix consistency, higher timeframe completion,
future availability, backfilled timestamps, pivot confirmation and unverified
external features. Passing these tests does not establish profitability or make
a research strategy eligible for automatic live trading.

The scanner and background trader attach `quantObservations` through
`observeLiveStrategies`, which uses the same single-timeframe inputs and
`decide` function as replay. These observations do not replace the legacy
scanner's execution rules. The dashboard exposes their reasons separately.

The strategy library, quant research, strategy health, risk and system health
pages share the new workspace. Journal diagnosis groups completed trades by
recorded version, market condition, market, timeframe and session. Missing
entry evidence remains unknown; later reviews cannot rewrite original context.

Model roles support Responses, compatible Chat Completions and Anthropic
Messages transports. Role keys are encrypted at rest. Changing a provider URL
requires a new key so existing credentials cannot be forwarded accidentally.
Provider availability is established when a request is made.

Research uses fixed candidate windows, chronological evaluation, a final
holdout and doubled-cost stress tests. Reusing a dataset raises a holdout
warning. These safeguards reduce overfitting risk; they cannot eliminate it.
Promotion remains disabled pending prospective paper evidence. LuxAlgo
historical features require explicit non-repainting verification.
