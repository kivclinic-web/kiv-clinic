# Fresh-User Field Study — KIV Clinic

A first-use walkthrough of the live product from the perspective of a brand-new clinic operator who
has never seen the app, makes mistakes, gets interrupted, and expects it to behave like good software
they already use. Findings are grounded in the real frontend code and checked against `docs/PRD.md`.
This is a *journey/discoverability/lifecycle* audit — it does not re-list the screen-level items already
covered in `docs/UX-AUDIT.md` / `docs/PERF-AUDIT.md`, though a few still-broken blockers are re-flagged
where they kill a journey.

---

## 1. Prioritized findings

### B1 — A new pet's record can never be corrected (no Edit pet anywhere). **BLOCKER**
- **Where:** `forms.js:31` (`PetForm` *supports* edit mode), but the only callers are "Add pet"
  (`screens-people.js:49`, `:68`) which pass no `initial`. Nothing in the app ever calls
  `openForm('pet', { initial: … })`. The pet record screen (`PetTimeline`, `screens-people.js:107-141`)
  has buttons for *Record weight, New consultation, Vaccinate, Upload* — **no Edit and no Delete.**
- **User's view:** "I typed the breed wrong / picked the wrong sex / entered the wrong date of birth
  when I registered this dog. How do I fix it?" There is no path. The record is frozen at creation.
- **Why it matters:** `date_of_birth` is *canonical* — it drives displayed age, the ">6 months"
  deworming rule, and vaccine scheduling (PRD §4, §7.1). A one-character DOB slip permanently corrupts
  every age/reminder calculation for that patient, with no recovery short of editing the Sheet by hand.
- **Fix:** Add an "Edit" button to the pet record header that calls
  `openForm('pet', { initial: pet })` (the form already handles it). Backend `pets.update` already exists.

### B2 — Deleting a client with pets is a guaranteed dead-end (no pet delete, no reassign). **BLOCKER**
- **Where:** `screens-people.js:57` confirm body literally says *"Remove {name}? Delete or reassign
  their pets first."* Backend enforces it: `Domain_Clients.js:69-70` throws `CONFLICT` if any pet exists.
  But the UI offers **neither** a pet-delete (`pets.delete` exists in the backend, unused in the UI) **nor**
  a pet-reassign (no "change owner" affordance; `PetForm` only exposes owner on *create*, `forms.js:44`).
- **User's view:** "This client was entered twice / left the practice. Delete them." → error toast
  "Delete or reassign the client's pets first" → and there is no button anywhere to do either. Stuck.
- **Why it matters:** Duplicate clients are the single most common data-entry mistake in a clinic
  front desk. The app instructs the user to do something it makes impossible.
- **Fix:** Expose pet delete (admin) on the pet record, and add an owner field to `PetForm` edit mode
  (reassign) so the cascade the message describes is actually performable.

### B3 — A saved consultation can't be edited or deleted, even after a wrong prescription. **BLOCKER**
- **Where:** `Consultation` composer is create-only (`screens-clinical.js:12-98`). The pet timeline
  renders consultations read-only (`screens-people.js:95`, `:131-136`). No edit/delete control exists,
  although `consultations.delete` exists in the backend (route list) and `consultations.get` is unused.
- **User's view:** "I picked the wrong medicine / typed the wrong dose / saved on the wrong pet."
  Saving also **deducts stock** (FEFO, `screens-clinical.js:45`). There is no undo and no correction —
  the wrong record and the wrong stock deduction are both permanent from the UI.
- **Why it matters:** Clinical records are legal/medical documents; an uncorrectable typo in a diagnosis
  or an unreversible erroneous stock deduction is a serious operational and inventory-integrity gap.
- **Fix:** Add admin-only "Correct / void" on a consultation that calls `consultations.delete`
  (which should re-credit deducted stock) and/or an edit path; at minimum surface a void that reverses stock.

### B4 — No printable prescription or shareable record — a core promise, absent in the UI. **MAJOR**
- **Where:** PRD §8 lists *"Printable prescription → consultations, consultation_medicines, clinic_info →
  (optional) Drive PDF"* and the API contract has `consultations.prescriptionDoc`. The UI never calls it.
  The only print button in the app is on **Reports** and runs `window.print()` over the dashboard KPIs
  (`screens-ops.js:67`). There is no print/share on a consultation, on the pet record, or anywhere a
  prescription lives. Tellingly, the document-type list includes *"Scanned Prescription"*
  (`forms.js:245`) — implying staff hand-write Rx and scan them back in, contradicting the digital promise.
- **User's view:** "I finished the consultation; now I hand the owner their prescription / medical
  summary." There is nothing to print or send. They fall back to paper.
- **Why it matters:** Producing a prescription/visit summary for the pet owner is table-stakes for any
  clinic tool; the data exists but the user can't get it out.
- **Fix:** Add "Print prescription" on the saved consultation / pet timeline entry that renders a clean
  print view (CSS `@media print` already exists, `styles.css:297`) or calls `prescriptionDoc` to make a Drive PDF.

### B5 — A locked-out / forgotten-password user has no recovery, and admins can't reset a password. **MAJOR**
- **Where:** `Login` (`app.js:29-65`) offers only Sign in (and a forced first-login reset). There is no
  "Forgot password" link. The admin Users panel (`screens-ops.js:98-108`) offers only Enable/Disable —
  **no "reset password."** There is no `users.delete`/reset in the route list either.
- **User's view:** A manager forgets their password → the login screen gives them nothing, and the
  administrator has no button to issue a new one. The account is effectively bricked.
- **Why it matters:** Staff forget passwords weekly. With email being free infra (PRD §7.4), a reset is
  feasible — its absence forces hand-editing the Sheet/Script.
- **Fix:** Add an admin "Reset password" action on each user (regenerate one-time password, same UX as
  `UserForm`'s copy-once box) and/or an email-based reset using `MailApp`.

### B6 — First contact is a brick wall: no sign-up, no first-run setup, no guidance. **MAJOR**
- **Where:** Unauthenticated surface is *only* the login card (`app.js:50-64`). The first administrator
  is created out-of-band by running `setup()` in the Apps Script editor and POSTing
  `auth.bootstrapAdmin` with a bootstrap token (`Setup.js:16-18`) — entirely invisible to a clinic owner.
- **User's view:** A clinic owner opens the URL for the first time and sees a password box with no
  "Create account", no "Get started", no link to setup instructions. Dead-end before they ever get in.
- **Why it matters:** The product can't be adopted by its intended buyer without a developer. There's no
  bridge from "I found the app" to "I have an admin login."
- **Fix:** Document the bootstrap clearly *in the login screen footer* ("First time? See setup guide"),
  or add a guarded first-run admin-creation screen that consumes the bootstrap token from the UI.

### B7 — Zero-data first screen drops the user into a blank tool with no "do this first." **MAJOR**
- **Where:** `Dashboard` (`app.js:165-203`). With no data the hero reads "You have 0 appointments today
  — 0 follow-ups and 0 vaccinations due," KPIs are all 0, and each widget shows a generic empty state
  ("No appointments today", "All clear", "Nothing due"). There is no setup checklist, no "Add your first
  client", no tour, no sample data.
- **User's view:** A freshly-provisioned admin lands here and has no idea the intended first move is
  Clients → Add client → Add pet. Nothing points the way.
- **Why it matters:** Onboarding momentum is lost at the exact moment a new user needs direction.
- **Fix:** When KPIs/lists are all empty, replace the hero with a short "Get started" checklist linking to
  Add client / Add pet / Set clinic info / Add a medicine. Cheap, no infra.

### B8 — Registering a brand-new walk-in (owner + pet) can't be done in one flow; the obvious entry point dead-ends. **MAJOR**
- **Where:** Quick Add shows both "Add client" and "Add pet" tiles (`app.js:76,79`). The natural instinct
  for "a new pet just walked in" is "Add pet." But `PetForm`'s owner select (`forms.js:44`) has only
  existing owners + "— Select owner —"; there is **no inline "＋ New owner."** So a first-timer must
  cancel, Add client, save (the client form just closes — `forms.js:16` — it does *not* offer "add a pet
  for this owner now"), then re-open Quick Add → Add pet → find the owner. The single smooth path
  (Clients → tap client → "Add pet", which prefills `client_id`, `screens-people.js:49`) is invisible from
  where a new user starts.
- **User's view:** The most common daily task — register a new owner *and* their animal — takes ~8
  steps across two separate modals, and the most discoverable starting point ("Add pet") leads to a
  dropdown that doesn't contain the owner they're trying to add.
- **Why it matters:** This is the #1 front-desk workflow; it should be one continuous flow.
- **Fix:** After saving a client, offer "Add a pet for {name}" (chain into `openForm('pet', {client_id})`).
  Add an inline "＋ New owner" option to the pet form's owner select.

### B9 — Clicking "Consultations" in the nav opens a blank form, not a list (label≠behavior). **MAJOR**
- **Where:** Nav item `['consultations','Consultations',…]` (`app.js:69`) routes to the `Consultation`
  *composer* (`app.js:233`), which is a blank "new visit" form. There is no consultations list/history
  screen anywhere; past consultations are reachable only inside an individual pet's timeline.
- **User's view:** A user clicks a noun-labelled section expecting "the consultations" (a list of visits)
  and instead gets an empty data-entry form with a "— Select pet —" dropdown. Confusing, and there's no
  way to browse "what visits happened today/this week" except pet by pet.
- **Why it matters:** Breaks the mental model that nav sections are *places* (lists) you visit, and hides
  any cross-patient view of clinical activity a clinic would want at day's end.
- **Fix:** Make "Consultations" a list (recent consultations across pets, with the composer behind a
  "New consultation" button), consistent with every other section.

### B10 — The "Reminders" bell does nothing useful; reminders are passive and easy to miss. **MAJOR**
- **Where:** Topbar bell (`app.js:137`) just calls `go('today')` — no list, no count badge. PRD §5/§8
  promise reminders (appointment/vaccination/follow-up/deworming) "surfaced in UI and optionally emailed."
  In practice they're static cards on the dashboard that the user must remember to open and read; there's
  no badge, no notification feed, and no evidence of `reminders.all`/email being wired to anything proactive.
- **User's view:** "Tell me what's due today." The bell looks like a notification center but is a no-op
  re-route; nothing ever nudges the user, so overdue vaccinations/dewormings are missed unless someone
  thinks to check the dashboard.
- **Why it matters:** "Remind me of what's due" is a primary reason a clinic buys this kind of tool;
  PRD promises it, the UI under-delivers.
- **Fix:** Give the bell a real dropdown/panel listing items from `reminders.all` with an unread count
  badge; optionally enable the (free) `MailApp` daily digest the PRD already contemplates.

### M1 — Booked appointments can't be corrected except by cancelling (no edit of pet/type/reason). **MAJOR**
- **Where:** `ApptActions` (`screens-clinical.js:131-153`) only sends `reschedule` (time), `complete`,
  `cancel`. Backend `appointments.update` accepts general fields, but the UI sends only `{status}`
  (`:139`). The pet, type (OPD/Surgery/Grooming), and reason of a booked appointment are uneditable.
- **User's view:** "I booked this as Grooming but it's actually a Surgery / I picked the wrong pet."
  Only option is cancel + rebook. Annoying and loses the original record.
- **Fix:** Let the actions sheet edit type/reason/pet via `appointments.update`.

### M2 — No way to record a deworming from the pet record (inconsistent with vaccinate). **MINOR**
- **Where:** Pet record header has "Vaccinate" and "Upload" but no "Deworm" (`screens-people.js:128`),
  even though `PetReminders` shows "Deworming due" right there (`screens-people.js:149`). To record a
  deworming you must leave to the Vaccinations section and re-pick the pet (`screens-clinical.js:162`).
- **Why it matters:** The reminder says it's due, on the very screen where you'd act, with no action.
- **Fix:** Add a "Deworm" button next to "Vaccinate" → `openForm('deworming', { pet_id })`.

### M3 — Medicines and suppliers can be created and edited but never deleted/retired in the UI. **MINOR**
- **Where:** Inventory rows open the edit form (`screens-ops.js:34`); suppliers cards open edit
  (`screens-ops.js:49`). Neither edit modal nor any list offers Delete, though `medicines.delete` and
  `suppliers.delete` exist in the backend. A mistyped batch or a one-off test medicine lingers forever
  (and counts toward inventory value / low-stock noise).
- **Fix:** Add admin-only Delete in the medicine and supplier edit modals.

### M4 — "Pets" empty state has no action button, unlike "Clients" (inconsistent first step). **MINOR**
- **Where:** Clients empty state includes an "Add client" action (`screens-people.js:30`); the Pets empty
  state is text only — "Add your first patient." with no button (`screens-people.js:71`). A new user on
  the Pets tab sees the suggestion but no button to act on it (the "Add pet" button is in the header, but
  the empty-state copy invites a click that isn't there).
- **Fix:** Mirror the Clients empty state with an "Add pet" action.

### M5 — Managers see "Settings" denied only *after* clicking; and the nav hides it inconsistently. **MINOR**
- **Where:** Desktop sidebar filters Settings out for non-admins (`app.js:121`), but the mobile "More"
  sheet builds from `allNav` which includes the *filtered* ops nav, so it's consistent there. However a
  manager who deep-links `#/settings` gets an "Administrators only" empty state (`screens-ops.js:76`)
  rather than being redirected — fine, but there's no hint elsewhere about *who* to ask for admin actions.
- **Fix:** Low priority; consider a "contact your administrator" line on the denied state.

---

## 2. Lifecycle matrix (✓ present & discoverable · ⚠ present but buried/partial · ✗ missing in UI)

| Record type   | Create | Find (list/search)      | View            | Edit/Correct        | Remove                         |
|---------------|--------|-------------------------|-----------------|---------------------|--------------------------------|
| Clients       | ✓      | ✓ (list + search)       | ✓ (detail modal)| ✓                   | ⚠ admin, but **dead-ends if pets exist (B2)** |
| Pets          | ✓      | ✓ (list + search)       | ✓ (timeline)    | ✗ **no edit (B1)**  | ✗ no UI delete (B1/B2)         |
| Weights       | ✓      | ✓ (on pet record)       | ✓ (sparkline/timeline) | ✗            | ✗                              |
| Appointments  | ✓      | ✓ (7-day + archived)    | ✓               | ⚠ time only; **not pet/type/reason (M1)** | ✓ Cancel (soft)  |
| Consultations | ✓      | ⚠ only via a pet's timeline; **no list (B9)** | ✓ inline | ✗ **(B3)** | ✗ **(B3)**             |
| Vaccinations  | ✓      | ✓ (due list)            | ✓ (timeline)    | ✗                   | ✗ (backend has delete; no UI)  |
| Dewormings    | ⚠ not from pet record (M2) | ✓ (due list) | ✓ (timeline) | ✗               | ✗                              |
| Medicines     | ✓      | ✓ (tabs + Quick Add)    | ✓ (row→edit)    | ✓                   | ✗ **(M3)**                     |
| Suppliers     | ✓      | ✓ (tab)                 | ✓ (card→edit)   | ✓                   | ✗ **(M3)**                     |
| Documents     | ✓      | ✓ (pet timeline)        | ✓ (open link)   | ✗ (no title edit)   | ✓ admin hard-delete            |
| Staff users   | ✓      | ✓ (Settings)            | ✓               | ⚠ enable/disable only; **no password reset (B5)** | ✗ no delete (disable only) |
| Clinic info   | n/a (seeded) | ✓ (Settings)      | ✓               | ✓                   | n/a                            |

The cluster of ✗ in **Edit** and **Remove** for Pets, Consultations, Vaccinations, Dewormings is the
headline structural gap: the app is strong at *create* and *view* but weak at *correct* and *remove* —
exactly the operations a real, mistake-making front desk needs most.

---

## 3. Journey-by-journey notes

**1. First contact & onboarding.** Public surface is a bare login card (`app.js:50`) — no sign-up, no
forgot-password, no setup link (B6). The very first admin must be bootstrapped from the Apps Script editor
(`Setup.js`), invisible to a clinic owner. A newly-created *staff* member's first experience is good:
one-time password is shown once with a copy button (`forms.js:205-209`), and first login forces a password
reset (`app.js:38,42-49`) landing on Today — that part is solid. But the empty Today dashboard offers no
"do this first" guidance (B7).

**2. Register a customer + animal.** Smooth path exists (Clients → client → "Add pet" prefilled,
`screens-people.js:49`) but is undiscoverable from the instinctive "Add pet" tile, which dead-ends on an
owner dropdown lacking the new owner (B8). Creating a client doesn't chain into adding their pet. ~8 steps
for the most common task.

**3. Full lifecycle.** See matrix. Create/view are well covered; edit/remove have blockers for pets (B1),
client cascade (B2), consultations (B3), and gaps for vaccinations/dewormings/medicines/suppliers.

**4. Mistakes & destructive actions.** Confirmations exist where they matter (client delete, appointment
cancel, document hard-delete all use `ConfirmDialog` with danger styling — good). But the *recovery* story
fails: the client-delete confirm tells the user to "delete or reassign pets first" with no UI to do either
(B2); consultations/prescriptions can't be voided despite deducting stock (B3); there is no undo anywhere.
Error toasts for blocked deletes are sticky and readable (`core.js:50`) — the messaging is fine; it's the
*missing next action* that dead-ends people.

**5. A real shift across devices.** Responsive nav is reasonable: bottom nav (`app.js:70`) plus a "More"
sheet exposing all sections (`app.js:146-149`), and a floating quick-add FAB (`app.js:145`). Every function
is reachable on phone. SWR caching paints last-known data instantly on a second device (`core.js:176-196`),
and a forced cold-start warm-up keeps Apps Script responsive (`app.js:15-22`) — genuinely good for an
all-day clinic. No device-only assumptions found that block a journey.

**6. Clinic expectations.** Reminders are passive and the bell is a no-op (B10); there is no printable
prescription / record-sharing despite the PRD promising it (B4); no email nudges are wired to the UI. These
are the biggest gaps between what PRD.md promises and what a user experiences.

**7. Wayfinding & consistency.** Mostly coherent (consistent headers, Quick Add, sync/freshness labels).
The sharp inconsistencies: "Consultations" nav opens a *form* not a *list* (B9); you can Vaccinate but not
Deworm from the pet record (M2); Pets empty state lacks the action button Clients has (M4); and edit/delete
affordances appear for some record types (clients, medicines, suppliers) but silently vanish for others
(pets, consultations, vaccinations), so the user can't form a reliable rule for "can I fix this here?"

---

## Top 3 to fix first
1. **B1** — add Edit (and admin Delete) to the pet record; a wrong DOB silently corrupts age/reminders forever.
2. **B2** — make the client-delete cascade real (pet delete + reassign) so the instruction the app gives is possible.
3. **B3 / B4** — let a saved consultation be corrected/voided (with stock re-credit) and add a printable prescription.
