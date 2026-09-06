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

## Automatic condition-aware research

The Quant Lab checks EUR/USD, GBP/USD and USD/JPY on hourly completed prices,
using a rolling 90-day midpoint dataset and a fixed 2-basis-point round-trip
cost estimate. The initial four `1.0.0-conditions-v1` hypotheses restrict entry eligibility
to explicit market conditions. Automatic research now uses the discovery search
described below. The same restriction runs inside `decide` for
both replay and the latest observation. Original 1.0.0 definitions are unchanged.

Three consecutive completed hourly periods must agree on conditions. Stale
prices block recommendations. Candidate ranking uses earlier forward windows;
the reserved final period is used only for acceptance checks. A recommendation
also requires at least 30 reserved-period trades in the current condition.
No ranking on held-out results, automatic live promotion or order submission
occurs. News-driven adaptation requires a future verified news feed; price-only
classification cannot establish the cause of a move.

Every market has a persisted hourly due time and a five-minute exclusive lease.
Failed checks retry after 15 minutes. A lease token prevents an expired runner
from overwriting its replacement. Completed summaries are appended to
`quant_automatic_history`. Overlapping hourly samples are explicitly labelled
as repeated monitoring, not independent evidence. Automatic research uses no
LLM requests and does not increase model usage.

The browser heartbeat requests due work while the website is open; authenticated
autotrader heartbeat events also request due work through `waitUntil`. These are
triggers, not a cloud cron service. With neither driver active, checks resume on
the next trigger. An optional Codex recurring task can open the lab and request
due checks while Codex's local scheduler is available. The UI exposes enable,
pause, check-now, running, last-completed and failure states.

## Model output compatibility

| Connection mode | Provider request | Local handling |
| --- | --- | --- |
| `responses` | Responses API structured schema | Contract validation |
| `chat_completions` | Chat Completions strict schema | Contract validation |
| `chat_json` | Chat Completions `json_object`, `max_tokens` | Contract validation |
| `chat_text` | Chat Completions without `response_format` | Parse JSON/fenced JSON, then contract validation |
| `anthropic` | Native Messages, JSON contract in prompt | Parse JSON/fenced JSON, then contract validation |

The strategy and review contracts validate required fields, choices, types,
number bounds and array lengths regardless of provider. Prose surrounding a
decision, invalid data and truncated JSON are rejected rather than guessed.
Normal conversation remains free text. Save a role in Connections and use
“Test saved model connection” to make one small provider request. Background
trader deployments use `LLM_PROTOCOL` with the same mode names.

Provider references: [DeepSeek JSON mode](https://api-docs.deepseek.com/guides/json_mode/)
and [Gemini compatible API](https://ai.google.dev/gemini-api/docs/openai).

## Automatic strategy discovery

`discovery.ts` generates 24 immutable rule combinations from six entry concepts,
confirmation filters, four lookbacks and bounded stop/target/holding settings.
The rule vocabulary uses only completed price observations. It executes through
the same `decide` function as replay, without evaluating generated code.
Each generated version and its complete rules are retained in the report.

The first 80% of history, minus a 50-period gap, is the development region.
Candidates need enough trades and positive results in both chronological halves
of that region. One finalist per condition is selected there, before looking at
the reserved final 20%. Final checks include 30 trades in that condition, positive
net results, doubled costs and a bounded decline. These are screening gates,
not statistical proof. The 24 trials and up to five finalists still create
selection bias; prospective paper evidence is required before live eligibility.

The search runs at most daily when new completed prices exist. Hourly monitoring
reuses the discoveries and changes its recommendation according to the latest
stable condition. No new prices means no repeated search. The report includes
all rejected candidates and can be downloaded from each market's discovery panel.
This is bounded rule discovery; it does not invent arbitrary indicators, expand
its search budget automatically, or change live trading rules.
