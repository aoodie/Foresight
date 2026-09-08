# Foresight audit and hardening

Audit date: 2026-09-07. Scope: website API routes, broker execution and recovery,
journal persistence, model transports and secrets, automatic research, historical
data validation, selected browser-state paths, dependencies, and release checks.
This is a source and test-based review, not a certification or a live-trading test.

## Confirmed issues fixed

| Area | Finding and correction |
| --- | --- |
| Access | Any authenticated Sites user previously satisfied the owner check. API routes now require the configured owner identity. The Worker checks cross-site origins, requires JSON writes, limits streamed request bodies, and prevents private API response caching. |
| Model credentials | The legacy connection route could forward the existing key to a changed provider URL. Changing providers now requires a new key. HTTPS/public-hostname validation, rejected redirects, deadlines, bounded responses and sanitized provider errors reduce credential and resource exposure. |
| Broker records | Reconciliation searched across accounts and broker-ID updates could affect several records. Queries now scope to account/environment; ambiguous legacy events fail instead of altering multiple accounts. Journal identity cannot be reassigned. |
| Journal validation | The previous allowlist rejected scalping, gold and US30. The validated contract supports the UI's markets and styles and rejects invalid prices, timestamps, statuses, excessive notes and metadata. Missing updates return 404 so delivery can retry. |
| Execution | Successful execution results cannot be downgraded by a later failure. Corrupt saved results retain the duplicate-order block. Newly linked uncertain intents resolve from matching broker evidence during reconciliation. Orders and closes have deadlines and do not follow redirects. Confirmation must be the boolean true. |
| Profit/loss | Transaction-level profit/loss was added to its already-included trade allocations. The aggregate is now used once, with allocations only as fallback. Crossed and nonpositive quotes are rejected. |
| Research | Malformed stored JSON no longer breaks job selection. A pause is checked within the claim statement. Empty/short history fails clearly; malformed prior discovery records are not reused. |
| Data | Cached history is revalidated. Duplicate, overlapping, incomplete, wrong-duration and out-of-range history is rejected. CSV timestamps require explicit timezone offsets. Discovery exports include gaps and quality caveats. |
| Model output | Incomplete Responses results are rejected even when some text is present. Local structured-output validation remains mandatory for strategy/review decisions. |
| UI | Saving cached analysis tolerates full or disabled browser storage. |
| Dependencies | Next, Vite, Vinext and the Cloudflare toolchain were updated together. A targeted esbuild override removes the deprecated development-loader advisory; database migration generation was verified. |
| Delivery | CI runs dependency audit, type checking, lint, production build and regression tests on pushes and pull requests. |

## Deployment requirements

Set `FORESIGHT_OWNER_EMAIL` to the verified Site owner in Sites runtime settings.
API access fails closed if this value is missing. Keep the Site owner-private.
Identity headers are trusted only behind the Sites authentication gateway: do not
expose the raw Worker as a public origin that accepts caller-supplied identity.
Secrets remain in encrypted database records or runtime secrets, not source.
The API CSP intentionally covers API responses; it is not a full HTML script CSP.

## Validation

JPY follow-up: the order preview now shares the risk-sizing function used by
server execution; requires a fresh quote for the selected instrument; and shows
up to five decimals of standard lots with exact broker units. Journal and position
views use units as the display source instead of rounding small lots to zero.
Regression tests compare USD/JPY, EUR/JPY and GBP/JPY in both directions under
USD, GBP and JPY account-conversion examples. Broker quote selection matches the
requested instrument before using its conversion factors.

- Regression cases cover owner/cross-site rejection, body size, journal inputs,
  account collisions, immutable execution outcomes, broker evidence recovery,
  corrupt job data, cache validity, CSV timezones, P&L accounting and model failures.
- Local built-Worker HTTP checks: missing/wrong identity 401; foreign origin 403;
  invalid journal/order input 400; invalid worker authentication 401. Each has
  `Cache-Control: private, no-store`.
- Broker writes are mocked in tests. No live order or close is used for validation.
- Existing migrations are applied to a fresh SQLite database in persistence tests.
- Final dependency scan reports zero known vulnerabilities. This does not imply
  absence of undisclosed vulnerabilities. The pinned esbuild override was checked
  with a clean dependency installation and migration generation.

Production follow-up: the edge runtime rejects `redirect: error` before sending
a request. All protected transports use `redirect: manual` and reject non-success
responses, including redirects. This preserves credential protection while allowing
normal broker/model requests. Owner sign-in and journal reads were verified in
production, including exact units for historical JPY entries.

## Remaining work and limits

1. Research remains idea-screening quality. Midpoint bars and fixed estimated
   costs do not establish executable profits. Historical bid/ask, financing,
   verified session/holiday calendars, realistic fills and fresh prospective paper
   evidence remain outstanding. Daily overlapping evaluation periods are not
   independent or unseen evidence; overfitting is not eliminated.
2. Research and live scanner rules still have distinct execution paths. Do not
   automatically promote generated strategies until their prospective execution
   and management parity is demonstrated.
3. Per-order sizing is enforced, but an atomic account-wide portfolio risk budget
   shared between browser orders and every worker is still required. The risk
   page's recorded cash risk is not current broker exposure.
4. Intents created before the new journal link cannot all be resolved automatically.
   A reservation with no broker evidence stays blocked. Rejection reconciliation,
   full broker-event ordering and crash testing across multiple worker processes
   remain follow-up work. Do not clear uncertain reservations to force retries.
5. Hosted provider URLs require HTTPS/public DNS names. This is not a DNS-rebinding
   defense or a destination allowlist. An operator-controlled outbound proxy would
   be needed for strict network destination enforcement.
6. Automatic research is driven by browser/background-worker/desktop heartbeats;
   it is not an independent always-on scheduler. Pause prevents new claims; a
   previously claimed check may finish. Long research still runs within one request.
7. Full browser workflow coverage, disaster-recovery restore drills, append-only
   transaction bundles and a comprehensive HTML content-security policy remain.
8. The standalone autotrader source was updated and tested here; publishing the
   website does not redeploy an independently running autotrader process.

The checked-in TODO list remains a product backlog. This hardening pass does not
mark partially implemented research or lifecycle milestones as complete.
