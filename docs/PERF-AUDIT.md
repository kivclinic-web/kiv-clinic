# PERF-AUDIT.md — Latency audit of the Apps Script + Sheets backend

Status: analysis/plan only. No code changed. All recommendations hold the infra
constraints (single Google account; GitHub Pages + one Apps Script Web App + Sheets +
Drive; no external cache/DB/queue — only CacheService / PropertiesService / LockService)
and preserve every data-layer invariant in `docs/CONVENTIONS.md`.

---

## 1. Cost model & method

The dominant unit of latency on this stack is the **service-bridge round trip**: any call
that crosses from the V8 runtime into the Sheets service — `getDataRange().getValues()`,
`getRange(...).getValues()`, `getLastColumn()`, `appendRow(...)`, `setValues(...)` — costs
tens of milliseconds each, regardless of payload size, and they do not batch implicitly.
`PropertiesService.getProperty` and `CacheService.get/put` are also round trips but cheaper;
CacheService is the intended read cache. In-process CPU (hashing, sorting, JSON) and
`Utilities.*` digests do **not** cross the bridge and are not counted as round trips.

I counted by tracing every code path to its `Db.js` primitives. The key fact: **`readAll_`
(Db.js:35–49) is one full-tab `getDataRange().getValues()`**, and **`findById_`
(Db.js:52–56), `findBy_` (58–61), `checkUnique_` (141–144), `checkForeignKeys_` (128–138)
each call `readAll_`** — so every "find" is a full-tab bridge read. `update_` is even
heavier: `findById_` (1 readAll) + `headerIndex_` (`getLastColumn` + `getRange().getValues`,
Db.js:64–70) + `setValues` = 1 read-all **plus 3 more round trips**. `insert_` =
`headerIndex_` (2 round trips) + `appendRow`. Every mutation also appends an audit row
(Audit.js:4–21) = +1 write. Dataset assumed for estimates: **200 clients, 300 pets, 20
appointments today, 50 medicines**, with ~15 vaccinations due / ~8 overdue, ~5 follow-ups.

---

## 2. Findings table

Round-trip counts below are `getValues`/read round trips unless noted. "Hot" = runs on a
common per-request path; "occasional" = writes/admin/detail screens.

| ID | Location | What it does now | Round trips (assumed dataset) | Severity | vs hypothesis |
|----|----------|------------------|-------------------------------|----------|----------------|
| F1 | Db.js:52–61, 35–49 | `findById_`/`findBy_` each do a full-tab `readAll_` (`getDataRange().getValues`) | 1 full read **per call** | Hot | **Confirmed** (H1) |
| F2 | Db.js:94–109 | `update_` = `findById_` (1 read) + `headerIndex_` (`getLastColumn`+`getRange` = 2 reads) + `setValues` (1 write) | 4 round trips per update | Hot (writes) | New (extends H1) |
| F3 | Db.js:73–91 | `insert_` = `headerIndex_` (2 reads) + `appendRow` (1 write) | 3 round trips per insert | Occasional | New |
| F4 | Auth.js:61–79 (`verifyToken_`→`isTokenRevoked_`) | Every authenticated request does `findBy_('revoked_tokens')` = full read of revoked_tokens | 1 full read **per requireAuth_** | Hot (every request) | **Confirmed** (H3) |
| F5 | Domain_Appointments.js:120–128 (`enrichAppt_`) | Per appointment: `findById_('pets')` + `findById_('clients')` = 2 full reads each | 20 appts → **40 reads**; called twice (widgets+reminders) | Hot | **Confirmed** (H2) |
| F6 | Domain_Vaccinations.js:41–66 (`vaccinationStatusList_`) | Per due/overdue vaccine: `findById_('pets')` | ~15 due → 15 reads; ~8 overdue → 8 reads; recomputed 3×/dashboard | Hot | **Confirmed** (H2) |
| F7 | Domain_Vaccinations.js:111–119 + 102–109 (`dewormingsDueList_`→`dewormingDueForPet_`) | `readAll_('pets')` then **per pet** `findBy_('dewormings')` = full read of dewormings | 300 pets → **~250–300 reads** (worst single offender) | Hot (reminders) | **Confirmed** (H2), severity understated |
| F8 | Domain_Clients.js:145–162 (`petsGet_`) | `findById_('clients')` called **twice** (line 154 ternary), plus `findBy_` ×5 + `dewormingDueForPet_` re-reads dewormings | ~10 reads, 1 wasted duplicate | Occasional | **Confirmed** (H2) |
| F9 | Domain_Reports.js:6–22 (`dashboardKpis_`) | Composes 6 sub-handlers, **each re-runs `requireAuth_`** (→ F4) and re-reads overlapping tables; medicines read 3× (low/expiring/value) | ~35 reads in one endpoint | Hot | **Confirmed** (H4) |
| F10 | Domain_Reports.js:24–33, 59–68 (`dashboardWidgets_`,`remindersAll_`) | Re-call `todaysAppointments_`+`enrichAppt_`, vacc lists, dewormings — overlapping with kpis; 3 separate HTTP endpoints | widgets ~75, reminders ~383 reads | Hot | **Confirmed** (H4) |
| F11 | Domain_Inventory.js:61–79 | `medicinesLowStock_`/`medicinesExpiring_`/`inventoryValue_` each `readAll_('medicines')` independently | 3 full medicines reads where 1 suffices | Hot (dashboard) | **Confirmed** (H4) |
| F12 | Config.js:49–53 (`prop_`) | `PropertiesService.getProperty` per call; `TOKEN_SECRET` re-read on every `verifyToken_`/`signToken_`, not memoized | 1 prop round trip per auth/sign | Hot | **Confirmed** (H6) |
| F13 | Audit.js:4–21 | Every mutation appends an audit row inline (`appendRow`) on the hot path | +1 write per mutation | Occasional | **Confirmed** (H7) |
| F14 | Db.js:7–17 | `getSpreadsheet_` memoizes the `openById` handle (good); but `getSheetByName` re-resolved each `getSheet_` (cheap metadata, minor) | ~1 cheap call per table touch | Low | Partial refute of "nothing cached" — handle *is* cached |
| F15 | Code.js:103–128 | Idempotency uses CacheService (good) — the **only** CacheService use; no read caching anywhere despite CONVENTIONS.md | — | — | **Confirmed** (H5) |
| F16 | Domain_Consultations.js:7–95 | FEFO create re-reads medicines many times: precheck `findById` per line + `fefoBatches_` (readAll) per demand key + per-line `findById`+`fefoBatches_`+per-batch `update_` | M lines → 10–20+ medicines reads under lock | Occasional | New |
| F17 | Auth.js:14–21 (`hashPassword_`, HASH_ITERATIONS=100000) | 100k SHA-256 iterations **in-process** (Utilities, no bridge) | 0 round trips; ~1–3 s CPU on login only | Occasional | See §6 — not a bridge cost |

Hypothesis scorecard: H1 confirmed; H2 confirmed (F7 worse than stated); H3 confirmed;
H4 confirmed; H5 confirmed; H6 confirmed; H7 confirmed. Refinement: H "nothing cached" is
partially wrong — the spreadsheet *handle* is memoized (F14) and idempotency uses
CacheService (F15); what's missing is **read** caching and request-scoped memoization.

---

## 3. Per-request bridge-read budget (today → after)

Counts are full-table `getValues` reads unless noted. Writes/prop reads called out separately.

### (a) Login (`auth.login`, Auth.js:92–124)
- **Today:** `findBy_('auth_users')` (1 read) + success `update_` → `findById_('auth_users')` (1 read) + `headerIndex_` (2 reads) + `setValues` (1 write) + audit `appendRow` (1 write); `prop_(TOKEN_SECRET)` (1 prop) + `prop_(SPREADSHEET_ID)`+`openById` once. Hashing = 100k in-process iterations (no bridge).
  → **~4 read round trips + 2 writes + 2 prop reads.** Wall-clock dominated by in-process hashing, not the bridge.
- **After:** memoize `auth_users` readAll for the execution (F1 fix) so the post-check `update_` reuses it → **2 read round trips** (auth_users once; header read folded into a cached header map) + 2 writes. Hashing unchanged (security).
  → **~2 reads.** (Login is infrequent; this is minor — see §6 on hashing.)

### (b) Dashboard — all 3 endpoints together (kpis + widgets + reminders.all)
- **Today (≈ 440–490 read round trips across 3 HTTP requests + 3 × 302):**
  - `revoked_tokens` (F4): 16 reads (every `requireAuth_` in every composed sub-handler — kpis 6, widgets 5, reminders 5).
  - `enrichAppt_` pet+client N+1 (F5): ~100 reads (widgets 50 + reminders 50).
  - `dewormingsDueList_` N+1 (F7): ~250 reads (reminders).
  - vaccination N+1 pets (F6): ~61 reads.
  - appointments: 5; vaccinations: 5; medicines: 5 (F11).
- **After (single `dashboard.summary` endpoint, 1 HTTP + 1 × 302):**
  - Auth via CacheService revocation set (F4 fix): **0** table reads (1 cheap cache get).
  - Request-scoped `readAll_` memo (F1 fix) → each table read **once**: appointments 1, pets 1, clients 1, vaccinations 1, medicines 1, dewormings 1, vaccine_types 1.
  - N+1s replaced by in-memory lookup maps (F5/F6/F7 fix): 0 extra reads.
  → **~7 read round trips total, in ONE HTTP round trip.**

  **Headline: ~440–490 reads over 3 requests → ~7 reads over 1 request (~98% fewer bridge reads, 3→1 HTTP round trips).**

### (c) Typical list screen (`pets.list`, Domain_Clients.js:119–142)
- **Today:** `requireAuth_`→`revoked_tokens` (1) + `readAll_('clients')` (1) + `readAll_('pets')` (1) = **3 reads.** (Note: petsList already uses a `clientsById` map — the correct pattern, no N+1.)
- **After:** revocation check moves to CacheService (0 table reads) → `clients` (1) + `pets` (1) = **2 reads.** `clients.list` similarly 2 → 1.

---

## 4. Optimization plan (prioritized)

Each item: change · impact · risk to invariants · cache-invalidation concern.

**P1 — Request-scoped `readAll_` memoization.** Cache each tab's read for the lifetime of one
`doPost` execution in a plain object keyed by tab name; clear/bypass after any write to that
tab. Implement inside `Db.js` (`readAll_`, with a per-execution `__readCache`), and have
`insert_`/`update_`/`softDelete_` invalidate the affected tab's entry.
*Impact:* **High** — collapses every duplicate `findById_`/`findBy_`/composed-handler read to
one per tab; the single biggest lever for the dashboard (F1, F9, F10, F11). *Risk:* must
invalidate on write so read-after-write within an execution stays correct (critical for FEFO
deduction F16 where quantities change mid-execution — invalidate `medicines` after each
`update_`). Read-by-header preserved (cache stores row objects, not indices). *Invalidation:*
execution-scoped only; no cross-request staleness.

**P2 — Single unified dashboard endpoint (`dashboard.summary`).** One handler that reads each
needed table once (via P1) and derives kpis + widgets + reminders together; frontend calls it
once. *Impact:* **High** — 3 HTTP round trips (+3 × 302) → 1, and removes the cross-handler
re-reads/re-auth (F9/F10/F11). ~440→~7 reads. *Risk:* low; pure composition, no invariant
touched. Keep the old endpoints during migration. *Invalidation:* none.

**P3 — Lookup maps instead of `findById`-in-loops.** In `enrichAppt_` (F5),
`vaccinationStatusList_` (F6), `dewormingsDueList_` (F7): read `pets`/`clients`/`dewormings`
once into `{id: row}` / `{pet_id: [rows]}` maps and resolve in memory. *Impact:* **High** —
removes ~100 (F5) + ~61 (F6) + ~250 (F7) reads. *Risk:* low; same data, fewer reads. Largely
free once P1 lands, but the maps also remove the per-item lookups P1 alone wouldn't (P1 makes
the readAll cheap; maps make the per-row resolution O(1) with zero extra reads). *Invalidation:* none.

**P4 — CacheService for reference/static tables with write-invalidation.** Cache rarely-changing
tables — `vaccine_types`, `suppliers`, `clinic_info`, and optionally `clients`/`medicines` — in
`CacheService.getScriptCache()` as JSON (TTL ~300–600 s). On any write to those tabs, delete the
cache key. *Impact:* **Med** — turns cross-request reads into a cheap cache hit; helps list
screens and dashboards across users. *Risk:* med — **must** invalidate on every
insert/update/delete to the cached tab or readers see stale rows (correctness regress). Apply
only to low-churn tables; keep high-churn (appointments) on P1 only. *Invalidation:* explicit
key delete in `insert_`/`update_`/`softDelete_` for cached tabs; TTL as a backstop. Cache 100 KB
value limit — paginate/limit what's cached.

**P5 — Remove the revoked-tokens read from the hot path (F4).** Replace the per-request
`findBy_('revoked_tokens')` full read with a **CacheService-backed revocation set**: on
`logout_`/revoke, `put('revoked:'+jti, '1', ttl=token_remaining_lifetime)` (≤ TOKEN_TTL = 8 h)
**and** still append to the `revoked_tokens` sheet (durable audit). `verifyToken_` checks
`cache.get('revoked:'+jti)` — a cheap cache get instead of a full-table read. *Impact:* **High**
— removes 1 full read from **every** authenticated request (16 across one dashboard today).
*Risk/tradeoff:* CacheService is best-effort and can evict before TTL; if a jti is evicted, a
revoked token could be accepted until `exp`. Mitigations that keep correctness: (a) tokens are
already short-lived (8 h) bounding the window; (b) on cache miss for a *recently-issued-looking*
token, optionally fall back to the sheet read only when a cheap "any revocations since X?"
marker is set; (c) seed the cache from the sheet on cold start. State the tradeoff explicitly:
we trade a tiny, time-bounded revocation-propagation risk for removing a read from every
request. The durable sheet remains the source of truth for audits and cache rebuild.

**P6 — Per-execution property/handle caching (F12).** Memoize `prop_` results in an object for
the execution (esp. `TOKEN_SECRET`, `SPREADSHEET_ID`). The spreadsheet handle is already cached
(F14, Db.js:7–11) — extend the same pattern to properties. *Impact:* **Low–Med** — removes
repeated `getProperty` round trips when a request signs/verifies or touches many tables. *Risk:*
none (properties are stable within a request). *Invalidation:* execution-scoped.

**P7 — Audit-write strategy on the hot path (F13).** Audit is already wrapped in try/catch and
non-fatal (Audit.js:17–20). Keep it for mutations (correctness/compliance requires the trail),
but: (a) never audit on read paths (already true); (b) for multi-row mutations under one lock
(FEFO deduction writes one audit row per batch, F16/Consultations.js:90), **batch the audit
rows into a single `setValues`/`appendRow`-of-range** instead of one `appendRow` per line.
*Impact:* **Med** for consultations, low elsewhere. *Risk:* low — same rows, fewer writes; keep
ordering. *Invalidation:* none.

**P8 — Header-map caching to cut `update_`/`insert_` overhead (F2/F3).** `headerIndex_` does
`getLastColumn` + `getRange().getValues` on every write. Header rows change only via migrations,
so cache the per-tab header array in CacheService (or Script Properties, keyed by
schema_version) and skip the two reads per write. *Impact:* **Med** on write-heavy flows
(consultations, bulk ops) — removes 2 round trips per insert/update. *Risk:* low **provided**
the cache key includes `schema_version` so a migration invalidates it; read-by-header preserved
(we cache the header *names*, not fixed indices). *Invalidation:* bump on `schema_version`.

**P9 — Column-narrowed reads — DEFER / mostly reject.** Reading only needed columns
(`getRange(2,1,n,k)`) would shrink payloads, but it is **risky with read-by-header**: it
reintroduces positional assumptions and breaks the "defend against manual reordering" guarantee
(Db.js:63). Bridge cost is dominated by *call count*, not payload, so narrowing a single
`getValues` yields little. *Recommendation:* skip; rely on P1–P3 (fewer calls) instead. Only
consider for genuinely wide+hot tables, and only by resolving the column index from the cached
header map at runtime (never a hardcoded index).

**P10 — Frontend stale-while-revalidate / payload caching.** In `useApi` (core.js:60–65), cache
the last successful payload in memory (and optionally `localStorage`) per action+params and
render it immediately while revalidating in the background; the dashboard and list screens
benefit most. Also collapse the dashboard's 3 hooks (app.js:150–151,185) into one
`dashboard.summary` call (pairs with P2). *Impact:* **Med** perceived latency (instant paint),
**High** for the 3→1 request reduction. *Risk:* none to backend invariants; show a subtle
"updating" state to avoid acting on stale data. *Invalidation:* on `kiv-refresh`
(core.js:40) and after mutations, force revalidate.

**Also worth doing (smaller):**
- **F8 duplicate read:** in `petsGet_` (Domain_Clients.js:154) call `findById_('clients')`
  once into a variable; and reuse the already-read dewormings for `dewormingDueForPet_` instead
  of re-reading (P1 covers this automatically). Low effort, removes 1–2 reads per pet page.
- **Warm-up ping** (mitigates cold start, see §6): a time-driven trigger hitting `doGet?ping`
  every few minutes keeps the instance warm during clinic hours — uses only Apps Script's own
  triggers (allowed). Note: warm-up cannot beat the 6 min/trigger and quota limits; scope it to
  business hours.

---

## 5. Sequencing — biggest win, lowest risk

**Do first (captures ~80% of the gain, all low-risk):**
1. **P1 (request-scoped readAll memo)** — foundational; instantly de-dupes every composed
   handler and makes P2/P3 trivial. One change in `Db.js`.
2. **P2 + P3 (unified `dashboard.summary` + lookup maps)** — turns the ~440-read / 3-HTTP
   dashboard into ~7 reads / 1 HTTP. Highest user-visible win.
3. **P5 (CacheService revocation set)** — removes a full read from *every* authenticated
   request; benefits all flows, not just the dashboard.

Those three move the dashboard from **~440–490 reads / 3 round trips → ~7 reads / 1 round trip**
and every list/detail screen drops its per-request revoked-tokens read.

**Then (incremental):** P6 (prop memo), P8 (header-map cache for writes), P7 (batched audit in
FEFO), P4 (reference-table CacheService), P10 (frontend SWR).

**Optional polish:** F8 cleanup, warm-up trigger.

**Explicitly not now:** P9 (column narrowing) — risk to read-by-header outweighs the marginal
gain.

---

## 6. Things that look slow but aren't worth touching

- **The /exec 302 redirect** (every POST): unavoidable platform behavior of Apps Script Web
  Apps; `fetch(..., {redirect:'follow'})` (api.js:41) already handles it. Correct framing: don't
  fight the 302 — **reduce the number of POSTs** (P2/P10) so you pay it fewer times. One extra
  redirect on one request beats three.
- **Cold start (~20–30 s after idle):** platform behavior; cannot be engineered away within the
  infra. Only mitigation is a warm-up ping via a time-driven trigger during clinic hours
  (allowed — Apps Script's own triggers). Don't restructure code for it; it's an availability
  pattern, not a code-path cost.
- **`HASH_ITERATIONS = 100000` (Auth.js:14–21):** Verified — the loop calls
  `Utilities.computeDigest`, which runs **in-process in the V8 runtime; it does NOT cross the
  Sheets/service bridge.** So it is **0 round trips** — pure CPU (~1–3 s) and **only on login /
  password change**, not on any per-request hot path (`verifyToken_` uses HMAC, not the
  stretch loop). Correct framing: it's a deliberate, infrequent security cost, not a latency
  flaw to optimize. Leave it. If login wall-clock ever becomes a real complaint, it can be tuned
  **down** (e.g. 50k) as a security/latency tradeoff — but it should never be removed, and it is
  **not** part of the dashboard/list latency budget. Do not "optimize" it by caching hashes or
  reducing it for security reasons.
- **`getSheetByName` per `getSheet_`** (Db.js:14) and the spreadsheet `openById` (Db.js:9): the
  expensive `openById` is already memoized (`__ssCache`); `getSheetByName` on the cached handle
  is cheap metadata. Not worth a change beyond what P1 already gives.

---

### Appendix — invariant safety checklist for the proposed changes
- Read-by-header preserved: P1/P3 store row objects (header-keyed), P8 caches header *names*
  keyed by `schema_version` — no fixed-index reads introduced (P9 rejected for this reason).
- Writes still under `LockService`; P1 invalidates the read cache on write so read-after-write
  inside a locked mutation (FEFO) stays correct.
- Idempotency (`requestId`), soft-delete, admin-only deletes, salted+stretched hashing,
  server-side validation: untouched.
- Audit trail: retained for all mutations (P7 only batches the writes, never drops them).
- Revocation/logout semantics: durable `revoked_tokens` sheet remains source of truth; P5's
  CacheService set is an accelerator with an explicit, time-bounded tradeoff (§4 P5).
- No new infrastructure: only CacheService / PropertiesService / LockService / time triggers.

---

## 7. Implementation status (shipped 2026-06-28)

Shipped in commit `a9ec72d` and deployed (Apps Script version 3 on the stable deployment ID;
frontend via GitHub Pages):

- **P1 — request-scoped `readAll_` memoization** (`Db.js`): per-execution cache, invalidated in
  `insert_`/`update_`/`softDelete_`; `readAll_` returns shallow array copies so caller `sort`/`filter`
  can't corrupt the cache.
- **P2+P3 — `dashboard.summary`** (`Domain_Reports.js`, route in `Code.js`): one handler reads each
  table once, builds `petsById`/`clientsById`/`dewormingsByPet` maps, derives kpis+widgets+reminders.
  Legacy `dashboard.kpis`/`dashboard.widgets`/`reminders.all` kept for compatibility.
- **P5 — CacheService revoked-token set** (`Auth.js`): `revokedSet_()` rebuilt from the sheet on
  cache miss (600 s TTL); `logout_` invalidates the key. Sheet stays source of truth.
- **P6 — per-execution `prop_` cache** (`Config.js`).
- **P10 — frontend stale-while-revalidate** (`core.js useApi`): instant paint from memory+localStorage,
  background revalidate, skeleton only on first-ever load; `app.js` Today screen now makes one call.

**Measured (warm, demo dataset):** dashboard **~9.5 s across 3 sequential calls → ~3.5 s in 1 call**;
revisits paint instantly from SWR cache (no blocking request). Note: an individual warm request floors
at ~2.5–3.5 s of fixed Apps Script + 302 overhead regardless of work, so **reducing request count is the
dominant lever** at this dataset size; the read-count cuts (P1/P3) prevent the N+1 blow-up as data grows.

**Deferred (not yet implemented):** P4 (reference-table CacheService), P7 (batched audit in FEFO),
P8 (header-map cache for writes), P6-extension, warm-up time-trigger during clinic hours. P9 (column
narrowing) rejected. These help writes / cross-request / cold-start but won't move the warm per-request
floor much.
