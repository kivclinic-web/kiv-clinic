# KIV Clinic — UI Layer Build Brief

> Hand this file (plus `KIV Clinic.dc.html`, the working prototype) to your Claude Code session.
> It is the design + UX contract for building the production frontend. The **prototype is the
> visual source of truth**; this document explains the system, rules, and how each screen binds to
> the existing Apps Script API.

---

## 0. What you're building

The frontend for a **Veterinary Clinic Management System**. Backend already exists: a Google Apps
Script Web App over Google Sheets/Drive (see `docs/API-CONTRACT.md`, `docs/DATA-MODEL.md`). There is
**no UI yet**. Build a **responsive SPA** (desktop + mobile, equal weight) that ships on **GitHub
Pages** and talks to the single POST endpoint.

Two roles: **Administrator** (full) and **Manager** (operational, no user-management/settings, no
deletes). The UI must reflect role at render time — hide admin-only actions and delete buttons for
managers (the server also enforces this; never rely on the client alone).

**Hard rule from the client:** zero onboarding. A non-technical front-desk user must understand every
screen on sight. Prefer obvious labels over clever affordances.

---

## 1. Tech approach

- **Stack:** React (or Preact) SPA, single bundle, static-hosted. No SSR, no router library needed
  beyond hash routing. Match the prototype's component structure 1:1 where possible.
- **API client:** one `api(action, payload)` helper. POST `Content-Type: text/plain`, body = JSON
  string of `{ action, token, requestId, payload }`. Parse the `{ ok, data | error }` envelope.
  Generate a UUID `requestId` for every mutation (idempotency). Store the session token in memory +
  `localStorage`; attach to every authed call. Handle the stable error codes
  (`AUTH_INVALID`, `FORBIDDEN`, `VALIDATION_ERROR`, `CONFLICT`, `OUT_OF_STOCK`, `STORAGE_FULL`, …)
  with inline, human messages — never raw codes.
- **State/data:** lightweight fetch-on-mount per screen + a small cache for reference data
  (`vaccine_types`, `suppliers`, medicine list). Optimistic UI only where safe; otherwise show a
  pending state and reconcile on response.
- **Loading/empty/error:** every list and KPI needs all three states. Skeletons match the card shape.

---

## 2. Visual system (extract exact tokens from the prototype's `<style>`)

**Mood:** calm-clinical + friendly/pet-warm. Soft warm neutrals, generous whitespace, rounded
geometry, one confident teal. Trustworthy, never sterile, never "admin panel."

- **Color**
  - Background `#F2EFE8` (warm paper) · Surface `#FFFFFF` · Surface-2 `#FAF8F2`
  - Ink `#1A2420` · Soft text `#5E6B63` · Faint `#8B958D` · Border `#E6E0D4`
  - **Primary teal `#0E7C6E`**, deep `#0A5A50`, tint `#E0F0EB`
  - Status: amber `#B07C2C`/tint `#F6EBD4` (warning, due-soon) · red `#BB493B`/tint `#F6E1DB`
    (overdue, expiring, low-stock, danger) · violet `#6E5BB0`/tint `#ECE7F6` (grooming, vaccines) ·
    blue `#3A6E96` (info)
  - Accents share chroma; vary hue. Don't introduce new hues.
- **Type:** Display/headings **Bricolage Grotesque** (600–800). UI/body **Hanken Grotesk** (400–700).
  Numbers tabular. Body 15px, never below 13px; KPI numbers 30px display. Minimum mobile hit target 44px.
- **Shape & depth:** cards radius 18px, inputs/pills 11–13px, avatars 11–18px. Borders + very soft
  shadows (`0 1px 2px rgba(20,40,30,.03)`); lift on hover (`translateY(-2px)` + soft shadow). No heavy
  drop shadows, no gradient backgrounds (the one gradient is the logo mark only).
- **Iconography:** thin (1.9) line icons, rounded caps. Inline SVG. No emoji.
- **Color-coding is a system, use it everywhere:** appointment/record types carry a consistent color
  (OPD = teal, Surgery = red, Grooming = violet, Follow-up = amber, Vaccination = blue). Status dots:
  done = teal, in-progress = amber (pulsing ring), waiting = grey, overdue/cancel = red.

---

## 3. Navigation & layout

- **Desktop (≥820px):** fixed left **sidebar** (Clinic group: Today, Clients, Pets, Appointments ·
  Operations group: Consultations, Vaccinations, Inventory, Reports, Settings) with live count badges
  (pending appts, vaccinations due, low-stock). Sticky top bar = global search + **Quick add** + bell.
  User chip pinned bottom. **Settings + User management appear only for Administrator.**
- **Mobile (<820px):** sidebar collapses to a **bottom tab bar** (Today, Clients, Visits, Stock) plus
  a floating **+ FAB** for Quick add. Top bar keeps search (icon-only) + quick-add. Tables scroll
  horizontally; secondary columns (`.hidesm`) drop; two-column forms stack.
- Replicate the responsive breakpoints from the prototype (1080 / 820 / 560).

---

## 4. Signature interactions (build these — they make it not "another webpage")

1. **Quick Add command bar** (the ⌘K / + button, also the FAB on mobile). One overlay that is BOTH a
   universal search (clients, pets, medicines — fuzzy, by name or mobile) AND a launcher of labeled
   action tiles (New consultation, Book appointment, Add client, Record vaccination, Add to inventory,
   Upload document). **Crucially: it's tile-first, not keyboard-cryptic** — a non-technical user clicks
   a clearly-labeled card; power users type. This is the spine of the whole app: every "create" flow is
   reachable here in one gesture. Wire search to live API results; tiles deep-link into the relevant
   create screen.
2. **Smart "Today" dashboard** — not a wall of charts. A time-aware greeting + a one-sentence plain-
   language summary ("You have 8 appointments today — 3 follow-ups and 2 vaccinations due"), then the
   KPI strip, a **vertical time-rail of today's schedule** with live status, and a **"Needs attention"**
   column that surfaces the real risks (overdue vaccinations, low/expiring stock, overdue deworming) as
   tappable cards that jump straight to the fix. Derived from `dashboard.kpis` + `dashboard.widgets`.
3. **Pet medical timeline** — the pet profile is a single **chronological timeline** of everything
   (consultations, vaccinations, weights, dewormings, documents), color-dotted by type, with filter
   chips. Left rail = vitals (photo/initial, owner, age, sex, weight-trend sparkline) + a **Reminders**
   block (next vaccination, next deworming) and a one-tap **New consultation**. This replaces the PRD's
   scattered "last 3 consultations / vaccination history / weight history" with one legible story.

---

## 5. Screen-by-screen (map to API actions)

Each screen exists in the prototype. Build to match; wire to these actions.

- **Login** — `auth.login` → token/role/`must_reset`. First-run admin via `auth.bootstrapAdmin`.
  Force password change when `must_reset`. Throttle/lockout messaging from `AUTH_LOCKED`.
- **Today / Dashboard** — `dashboard.kpis`, `dashboard.widgets`. KPI cards: today's/completed/pending
  appts, follow-ups today, vaccinations due, overdue, low stock, expiring, inventory value. Each KPI
  links to its filtered list. Alert cards deep-link.
- **Clients** — `clients.list` (search by name/mobile), card grid showing linked pets. Add/edit via
  Quick add → form; **enforce unique mobile** (surface `CONFLICT` inline on the mobile field). Detail
  shows all pets. Delete = admin-only.
- **Pets** — `pets.list` / `pets.byClient`. Card grid (species, breed, sex, age, owner). Add pet is
  FK-bound to a client. Opens the timeline.
- **Pet record (timeline)** — `pets.get`, `consultations.byPet` (latest 3+), `vaccinations.byPet`,
  `petWeights.list`, `dewormings.byPet`, `documents.byPet`. Vitals rail + filterable timeline +
  reminders. Weight rail = sparkline from `pet_weights`. "Upload document" → `documents.upload`
  (base64 → Drive). Document delete is **admin-only hard delete** — confirm destructively
  ("cannot be recovered").
- **Appointments** — `appointments.list` (active = rolling **last 7 days**; older via `archiveList`).
  Week strip + type filter + day time-rail. Create/edit/reschedule/cancel actions. Show only the
  latest week by default; make "archived" reachable but secondary. Status set drives the dots.
- **Consultation composer** — `consultations.create` writes the consultation + prescription line items
  and **deducts stock atomically (FEFO, idempotent)**. Diagnosis / treatment / clinical notes /
  follow-up (None · 5 days · 1 week → auto-generates a Follow-up appointment) / weight. Prescription
  rows pick a medicine (show live stock + a stock bar; block/zero-guard on `OUT_OF_STOCK`). Optional
  printable Rx via `consultations.prescriptionDoc`. Attach documents inline.
- **Vaccinations** — `vaccinations.dueList` / `overdueList` / `byPet`; create via
  `vaccinations.create` with **auto due date** from `vaccine_types`. Plus **deworming** reminders
  (`dewormings.dueList`, q3m for pets >6 mo). Overdue = red, due = amber, upcoming = grey.
- **Inventory** — `medicines.list` with tabs: Medicines · Low stock (`lowStock`, qty < 3 → yellow) ·
  Expiry alerts (`expiring`, <6 mo → red) · Suppliers (`suppliers.list`). Show batch, stock, expiry,
  supplier, per-row value; header shows total `inventoryValue`. Row left-edge flag dot encodes status.
- **Reports** — `reports.daily`: patients seen, OPD/Surgery/Grooming counts, vaccinations administered,
  follow-ups, low-stock, expiring, inventory value. Export-to-PDF button (print stylesheet).
- **Settings (admin)** — `settings.get/update` (clinic info), `users.create/list/update/disable`
  (generated password shown **once** — copy-to-clipboard), and **storage usage** (`storage.usage`)
  with the warn-threshold bar.

---

## 6. Business rules the UI must honor (server enforces; UI must not fight them)

- Unique client mobile → inline conflict on the field, not a toast.
- Follow-up interval is **only** 5 days or 1 week (segmented control, no free date).
- Active appointments = last 7 days; archive is explicit/secondary.
- Pet history surfaces latest 3 consultations prominently (timeline can lazy-load older).
- Prescribing deducts stock — show the deduction consequence before save; handle `OUT_OF_STOCK`.
- Inventory flags are **derived**: qty < 3 → yellow, expiry < 6 mo → red. Compute-on-display matching
  server; never store flags client-side.
- **Deletes are Administrator-only**; document deletes are **permanent** (destructive confirm).
- Reminders are **in-app first** (+ optional email). No WhatsApp/SMS anywhere in the UI.
- Show reminders intuitively wherever they make sense (dashboard, pet rail, badges) — per PRD §15.

---

## 7. Build order (suggested)

1. App shell + responsive nav + API client + auth/login + role gating.
2. Quick Add command bar (search + tiles) — unlocks every create flow.
3. Today dashboard (KPIs + schedule rail + attention column).
4. Clients → Pets → **Pet timeline** (the core record).
5. Consultation composer (the riskiest flow: atomic stock deduction).
6. Appointments, Vaccinations/Deworming, Inventory, Reports.
7. Settings/Users/Storage (admin).
8. Loading/empty/error states, print stylesheet, a11y pass (focus, labels, 44px targets, contrast).

---

## 8. Definition of done

- Pixel-faithful to `KIV Clinic.dc.html` across desktop and mobile.
- Every screen wired to a real API action with loading/empty/error states.
- Role gating correct; manager never sees delete/admin actions.
- Every mutation sends a `requestId`; duplicate submits don't double-write.
- No new hues, fonts, or shadow styles beyond the token set above.
- A first-time, non-technical user can complete: find a client → open pet → start a consultation →
  prescribe → save, **without instruction**.

---

### Reference files
- `KIV Clinic.dc.html` — interactive hi-fi prototype (visual source of truth; open in a browser).
- `docs/API-CONTRACT.md` — actions, envelope, error codes, idempotency.
- `docs/DATA-MODEL.md` — every tab + column.
- `docs/PRD.md` / `PRD.md` — business rules and the function→data matrix.
- `docs/ARCHITECTURE.md` — transport, CORS (text/plain), free-tier limits, security posture.
