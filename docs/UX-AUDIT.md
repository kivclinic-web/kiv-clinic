# KIV Clinic — UX Audit

Scope: the frontend SPA in `frontend/assets/` (Preact + htm over a single, slow Apps Script endpoint).
Lens: the app is used all day by clinic staff over a backend that **cold-starts at ~20–30s** and has a
**~1.5s hard floor on every call, warm**. Writes go through the same slow path. The data hook
(`core.js useApi`) is stale-while-revalidate: it paints cache instantly, then silently re-fetches.

The recurring failure across this app is **dishonest feedback about time and freshness**: a 1.5s wait,
a 30s cold start, a silent background refresh, and a silently-failed refresh all look *identical* to the
user (or invisible). For a tool people make medical and stock decisions on, that erodes trust fast.

---

## 1. Top findings (prioritized)

### F1. The `stale` flag is computed but never shown — background refreshes are completely invisible — **MAJOR (the headline issue)**
`core.js:83-92` produces a `stale` boolean ("for a subtle hint", per its own comment, `core.js:63`) but
**no screen ever reads it**. Verified: `stale` appears only inside `useApi`’s own body; zero consumers in
`app.js`, `screens-*.js`, `forms.js`.
- **Problem:** On every revisit the user sees cached data instantly with no indication that (a) it may be
  seconds-to-days old, or (b) a refresh is in flight. With `localStorage` persistence, a cache entry can
  survive across sessions — staff can stare at *yesterday’s* dashboard/stock and never know.
- **Why it hurts here:** Decisions ride on this data. The consultation composer’s "X in stock" numbers
  (`screens-clinical.js:24-27`) come straight from a possibly-stale `medicines.list`; a clinician can be
  blocked by a phantom shortage or surprised by `OUT_OF_STOCK` on save against numbers the UI showed as fine.
- **Remedy:** Actually render `stale`: a thin top progress bar / a subtle "Refreshing…" chip / dim-and-disable
  while revalidating, plus a "Updated 2 min ago" timestamp on data-heavy screens (dashboard, inventory,
  pet record). Stamp each SWR payload with a fetch time and surface it.

### F2. Background-refresh failures are swallowed — the app silently serves stale data as if fresh — **BLOCKER (trust)**
`core.js:90-92`: when a background revalidation throws and cached data exists, the hook sets
`{ ...v, stale:false, error:null }` — it **discards the error and clears the loading hint**.
- **Problem:** If the network drops or the backend errors during a refresh, the user is shown old data with
  **no error, no stale marker, nothing.** They believe they’re looking at live data.
- **Why it hurts here:** Cold starts and flaky mobile networks make background-fetch failures *routine*, not
  rare. Stale stock counts, stale "vaccinations due", stale appointment statuses presented as current is a
  clinical-safety problem, not a cosmetic one.
- **Remedy:** Keep the cached data on screen (correct) but **set a non-blocking error/stale state** so the UI
  can show a quiet "Couldn’t refresh — showing last known data. Retry" banner. Never zero out the error
  *and* the stale flag together.

### F3. Cold start (20–30s) is indistinguishable from a 1.5s wait — no "waking up" messaging anywhere — **MAJOR**
Skeletons (`SkeletonKpis`/`SkeletonRows`, `core.js:54-55`) and spinners (`Spinner`, `:52`) animate
identically whether the call takes 1.5s or 30s. There is no elapsed-time escalation, no "Waking the server,
this can take ~30s after idle" copy.
- **Worst at login:** `app.js:48` shows only "Signing in…" on a button. A first sign-in of the day hits a
  cold container — the user waits 20–30s at a frozen-looking button with no reassurance, no progress, no
  timeout. Many will assume it hung and reload (throwing away the warm-up and restarting the clock).
- **Also bad:** first-ever visit to any uncached screen after an idle gap = 20–30s of shimmer with no context.
- **Remedy:** Time-aware feedback. After ~3s show "Still working…", after ~8s "The server is waking up after
  idle — this can take up to 30 seconds." Apply to login and to first-load skeletons. Consider a determinate-ish
  progress affordance so the wait feels bounded.

### F4. The server is warmed once on load but never kept alive — mid-day lulls re-trigger 20–30s cold starts — **MAJOR**
`app.js:13-14,227`: `warmUp()` fires a single fire-and-forget ping at module load. There is **no interval
keep-alive**. Apps Script containers go cold after a few minutes idle.
- **Why it hurts here:** "Used all day" includes quiet stretches (lunch, between patients). The first action
  after any lull cold-starts with the F3 non-feedback. The one-time warm-up only helps the very first call.
- **Remedy:** A lightweight periodic `?action=ping` (e.g. every 4 min while the tab is visible, gated on
  `document.visibilityState`) to keep the container warm during the working day. Also re-ping on
  `visibilitychange → visible`.

### F5. Clients/Pets search fires an API call on **every keystroke** with no debounce — **MAJOR (perceived speed + races)**
`screens-people.js:18` (`useLiveApi('clients.list', {search:q}, [q])`) and `:63` (Pets) re-run on each
keystroke because `q` is a dep. No debounce, no abort. Quick Add got this right (220ms debounce,
`app.js:78`) but the main search screens did not.
- **Problem:** Typing "Rover" = 5 sequential ~1.5s calls hammering the one slow endpoint. Responses can land
  **out of order** (`useApi` has no request-sequence guard; the last `.then` to resolve wins,
  `core.js:88-92`), so the list can settle on results for a stale prefix.
- **Why it hurts here:** Each call is 1.5s+ and the backend is a shared bottleneck — this is the single biggest
  self-inflicted load and the most visibly janky interaction.
- **Remedy:** Debounce the query (~250–300ms) like Quick Add; ignore responses whose query no longer matches
  the current input (sequence/AbortController guard in `useApi`).

### F6. Writes have no optimistic update; the list "doesn’t change" for 1.5s+ after a success toast — **MAJOR**
Every form uses `useMutation` → success toast → `refreshAll()` (e.g. `forms.js:16,37`). `refreshAll` emits
`kiv-refresh`, which triggers a **background** revalidation (`stale`, which is invisible — see F1). So after
"Client added", the modal closes, a 4.2s toast fires, and the Clients grid looks unchanged until a silent
~1.5s+ refetch returns.
- **Problem:** No immediate evidence the record exists. Combined with the transient toast (F11), a user who
  glanced away sees nothing happen and may **re-submit** (duplicate clients/appointments).
- **Why it hurts here:** The confirmation gap is the full network latency, every time.
- **Remedy:** Optimistically insert/update the new record into the relevant cache so it appears the instant the
  write resolves, then reconcile on refetch. At minimum show the destination list in a visible refreshing state.

### F7. Form reference dropdowns render empty (look broken) while their data loads — especially on cold start — **MAJOR**
`AppointmentForm`/`VaccinationForm`/`DewormingForm`/`Consultation` load pets, suppliers, vaccine types with
plain `useApi` and feed the result straight into `Select` (`forms.js:116-121,137-144`,
`screens-clinical.js:13-14`). While that 1.5–30s call is in flight the dropdown shows only
"— Select pet —", with no spinner, no "loading…", and the Save button stays enabled.
- **Problem:** Open "Book appointment" on a cold backend and it looks like the clinic *has no pets*. A user can
  even submit before options arrive → server `VALIDATION_ERROR`.
- **Remedy:** Show a loading placeholder in the option list ("Loading pets…"), disable Save until reference data
  is present, and surface a load error in-form instead of an empty menu.

### F8. Advertised shortcuts/affordances that do nothing — **MAJOR (each is a small betrayal of trust, and they compound)**
- **⌘K is a lie:** `app.js:119` renders a `⌘K` badge on the search box, but there is **no keydown handler for
  Cmd/Ctrl-K anywhere** (verified). The shortcut does nothing.
- **"ESC to close" in Quick Add is a lie:** the Quick Add overlay (`app.js:92-98`) uses a raw `.scrim`, not
  `Modal`, so it has **no Escape listener** (only `Modal` binds Escape, `core.js:145`). The visible "ESC"
  chip and "esc to close" footer don’t work.
- **Notifications bell is dead:** `app.js:121` has no `onClick`. Users will click it expecting reminders
  (which this app actually has, on the dashboard) and get nothing.
- **Appointments day strip looks interactive but isn’t:** `screens-clinical.js:105` renders seven `.kpi`-styled
  day tiles (hover-styled, today highlighted) that are **not buttons and filter nothing**. Strong false
  affordance on the screen where staff most expect to pick a day.
- **Remedy:** Wire ⌘K to open Quick Add; add an Escape handler to Quick Add; make the bell open the reminders/
  attention list (or remove it); make the day tiles filter the list (or restyle them as non-interactive).

### F9. Consultation save is bespoke (not `useMutation`) and silently drops the weight write — **MAJOR (data loss + inconsistency)**
`screens-clinical.js:36-49`: the composer hand-rolls `busy`/`try/catch` instead of `useMutation`, and the
weight sub-write is wrapped in `try { … } catch {}` (`:44`) that **swallows any failure**. It then toasts
"Consultation saved" and navigates away regardless.
- **Problem:** A failed weight write is lost with zero signal; the recorded weight the clinician typed never
  persists, but they’re told everything saved. Inconsistent feedback/validation vs. the rest of the app
  (no inline `fieldErrors`, no shared pattern).
- **Compounding:** on success it `go('pet/'+pid)` immediately. The pet timeline mounts *after* `refreshAll()`
  fired, reads stale cache, and shows the record **without the just-saved consultation** until a silent
  refetch lands — the user’s own write appears to be missing for a beat.
- **Remedy:** Route the consultation through `useMutation` for consistent inline errors; surface (don’t swallow)
  the weight failure; and seed/await the pet-record cache so the new consultation is visible on arrival.

### F10. Document upload: large base64 over the slow link, no progress, no size guard — **MAJOR**
`forms.js:220-235`: a file is read to base64 and POSTed through the same 1.5s-floor endpoint. Feedback is a
single "Uploading…" spinner; there’s no byte size check, no progress, and X-rays/PDFs can be multi-MB.
- **Why it hurts here:** This is the longest, most failure-prone write in the app (big payload + cold start +
  Apps Script execution limits), yet it has the least informative feedback. A 30s upload looks frozen; a
  too-large file only fails after the full round trip (`STORAGE_FULL`/timeout).
- **Remedy:** Client-side size cap with an upfront message; a determinate or at least time-escalating progress
  state; keep the modal’s controls clearly disabled and labeled during the upload.

### F11. Toasts are the *only* confirmation and they auto-vanish in 4.2s — **MINOR/MAJOR**
`core.js:47`: toasts self-dismiss after 4200ms and sit bottom-right (bottom, above the mobile nav, on phones,
`styles.css:257`). Because writes aren’t optimistic (F6), the toast is frequently the *sole* evidence an action
worked.
- **Problem:** During a multi-second save a user often looks away; they can miss the toast entirely and, seeing
  no list change, repeat the action. Error toasts use the same `aria-live="polite"` as success
  (`core.js:48`) so they’re not announced assertively.
- **Remedy:** Pair toasts with a durable signal (optimistic list change per F6, or an inline success state on the
  origin). Make error toasts `aria-live="assertive"` and/or sticky until dismissed.

### F12. No confirm on "Cancel visit"; appointment actions are immediate — **MINOR**
`screens-clinical.js:120-139`: "Cancel visit" fires `appointments.cancel` directly from the actions modal with
no confirmation, unlike deletes elsewhere which use `ConfirmDialog`. A mis-tap cancels a booking (and triggers a
slow round trip to undo).
- **Remedy:** Confirm cancellation, or provide an undo window.

### F13. Accessibility & focus gaps — **MINOR (compounding)**
- `Modal` (`core.js:144-151`) doesn’t trap focus or set initial focus; the `autofocus` prop on `Input`
  (`core.js:133`) is unreliable across Preact re-renders, so keyboard users often land outside the dialog.
- Icon-only controls lack labels: the appointment-row chevron button (`screens-clinical.js:114`) and the
  Quick Add tiles have no `aria-label`; the rx remove "x" (`:77`) too.
- Status is conveyed by color + dot (`.stat`, `styles.css:90-95`) with text, which is okay, but overdue chips on
  the dashboard vaccination list (`app.js:182`) render an **empty** `.stat` (color-only, no text).
- **Remedy:** Trap focus + autofocus first field in `Modal`; add `aria-label`s to icon buttons; give every status
  chip a text label.

### F14. Layout shift / skeleton mismatch — **MINOR**
`SkeletonKpis()` defaults to **8** tiles (`core.js:54`) but the dashboard renders **9** KPIs (8 defs + the
inventory-value card, `app.js:166-167`), so the grid reflows when data lands. Skeleton row heights don’t match
real row heights either. Small but constant jank on the most-visited screen.
- **Remedy:** Match skeleton count/shape to the real layout.

---

## 2. By flow

- **Sign-in (`app.js:21-56`):** No cold-start messaging or timeout on the slowest, first call of the day (F3).
  Identifier type auto-detected by `@` — fine. No "show password", no caps-lock hint. On wrong password the
  whole-form error is okay, but lockout copy (`AUTH_LOCKED`) only appears after the slow round trip.
- **Must-reset-password (`app.js:34-41,49-54`):** Reasonable. Client-side checks for length/match are instant
  (good). But it reuses `pw` (the temp password) as `old` silently — if the user changed the email field after
  login the linkage is invisible. Minor.
- **Today dashboard (`app.js:149-199`):** Single `dashboard.summary` call (good batching), ~3–5s cold. Hero
  copy switches to "Loading your day…"/"Could not load" — decent. But staleness is invisible (F1/F2), skeleton
  count mismatches (F14), and the empty vaccination-due status dot has no label (F13).
- **Clients (`screens-people.js:16-58`):** Per-keystroke search (F5). Good empty/error states. Delete is
  admin-only with confirm (good). Adding a client doesn’t visibly appear in the grid until silent refetch (F6).
- **Pets (`:61-77`):** Same per-keystroke search issue (F5).
- **Pet medical record (`:81-150`):** Full-screen "Loading pet record…" blocks on `pets.get`; timeline is a
  second call. Rich and well-built. Risks: arriving here right after saving a consultation shows stale data
  briefly (F9); background refresh failures are invisible (F2); document delete is correctly hard-delete-with-
  scary-confirm (good) but uses a raw `api` call + manual toast instead of `useMutation` (inconsistent).
- **Consultation composer (`screens-clinical.js:11-90`):** Strong inline over-stock UX (disables Save, red bar).
  But stock numbers may be stale (F1), the save path is bespoke and drops the weight write silently (F9), and the
  pet/medicine selects are empty during load (F7).
- **Appointments (`:92-141`):** Decorative day strip masquerades as a filter (F8). Type filter is instant
  (client-side) — good. Cancel has no confirm (F12). Reschedule uses `datetime-local` with tz conversion — okay.
- **Vaccinations/Deworming (`:144-176`):** Clear tables, good empty states. Rows navigate to the pet. Fine,
  modulo the global staleness theme.
- **Inventory (`screens-ops.js:10-53`):** Tabs re-fetch per mode (`[mode]` dep) — acceptable. Total value in the
  header shows "—" then pops in (minor shift). Stale counts here are the highest-stakes instance of F1.
- **Reports (`:55-72`):** "Export PDF" is really `window.print()` (`:67`) — label over-promises; relies on print
  CSS (which exists). No date range (today only).
- **Settings/Users/Storage (`:74-119`):** Clinic info edit uses `useMutation` (good). User enable/disable uses a
  raw `api` call with a generic "User updated" toast and no confirm for disabling an admin. New-user one-time
  password reveal + copy is a nice pattern (`forms.js:194-217`).
- **Quick Add (`app.js:72-99`):** Debounced search (good, the model the rest of the app should copy). But ESC
  doesn’t close it despite saying so (F8), and the result fetches swallow errors (`.catch(()=>[])`, `:81-83`) so
  a failed search looks like "no matches".
- **Create/edit/delete forms (`forms.js`):** Consistent `useMutation` pattern with inline field errors and a
  busy SaveButton — the **best-feedback part of the app**. Gaps: empty reference dropdowns during load (F7),
  no optimistic list reflection (F6), number fields accept negatives/blank without inline guards.

---

## 3. Quick wins vs. larger efforts

**Quick wins (hours):**
- Debounce Clients/Pets search (F5) — copy the Quick Add pattern.
- Wire ⌘K → Quick Add; add Escape to Quick Add; make the bell do something or remove it; make/derecognize the
  appointment day tiles (F8).
- Stop swallowing the consultation weight error and the Quick Add search errors (F9, Quick Add).
- Add a confirm to "Cancel visit" (F12).
- Fix skeleton KPI count to 9 and label the empty status dot (F14, F13).
- Add `aria-label`s to icon-only buttons; make error toasts assertive (F11/F13).

**Medium (a day or two):**
- Render the `stale` flag and add "Updated X ago" timestamps (F1); surface swallowed background errors (F2).
- Time-escalating wait copy on login and first-load skeletons (F3).
- Periodic visibility-gated keep-alive ping (F4).
- Loading/disabled states for form reference dropdowns (F7).
- Focus trap + reliable initial focus in `Modal` (F13).

**Larger (design + plumbing):**
- Optimistic writes with cache reconciliation so actions feel instant and confirmations are durable (F6, F11).
- A real upload experience: size guards + progress + resumability where possible (F10).
- A coherent freshness model (per-entity cache TTL, version-stamped SWR cache, request-sequence guards) so the
  whole app stops presenting unknown-age data as live (F1/F2/F5).
