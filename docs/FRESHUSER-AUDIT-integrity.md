# Multi-User Integrity, Session & Privacy Audit — KIV Clinic

Scope: how the app behaves under **real concurrent, multi-device, all-day clinic use** — not the single-careful-user happy path. Grounded in `apps-script/` and `frontend/assets/`. No login was performed; this is a code-and-design audit.

Severity legend: **BLOCKER** (data loss / corruption / auth bypass in normal use) · **MAJOR** (loss/leak under realistic concurrency) · **MINOR** (degraded trust / latent risk).

---

## 1. Prioritized findings

### F1 — Most mutations run WITHOUT the script lock → silent lost updates (last-write-wins clobber) — **BLOCKER**
**Evidence.** `CONVENTIONS.md` and `Db.js:3` state *"every write under LockService."* In reality only ~8 handlers wrap `withLock_`: `clientsCreate/Update/Delete`, `consultationsCreate_`, `uploadDocument_`, `deleteDocument_`, `bootstrapAdmin_`, `createUser_`, and the login throttle update. **Every other mutation calls `update_`/`insert_` with no lock:** `petsUpdate_` (`Domain_Clients.js:98`), `appointmentsUpdate_/Reschedule_/Cancel_` (`Domain_Appointments.js:22,36,48`), `vaccinationsCreate_`/`dewormingsCreate_`, `medicinesCreate_/Update_/Delete_` (`Domain_Inventory.js:7,25,54`), `suppliers*`, `changePassword_` (`Auth.js:176`), `updateUser_` (`Auth.js:244`), `settingsUpdate_` (`Domain_Reports.js:194`). `update_` (`Db.js:150-166`) is a **full-row read-modify-write**: it reads the entire existing row into memory, patches the named fields, then `setValues` the *whole* row back.
**Sequence.** Front-desk A opens pet "Rex" and changes the breed; Vet B opens the same pet and changes the date-of-birth. Both load the row, both patch their one field against their in-memory copy, both write the whole row back. The second `setValues` overwrites the first writer's field with the stale value it read. One staff member's edit silently vanishes; nobody is told.
**Impact.** Arbitrary lost edits across pets, appointments, inventory, users, settings — invisible, no error, no audit of the clobber. Violates the system's own stated invariant.
**Fix.** Wrap every domain `create/update/delete` handler in `withLock_` exactly as `clientsUpdate_` already does. The lock is global and cheap relative to the Sheet round-trip; the consistency win dwarfs the serialization cost. (Tradeoff: writes serialize app-wide — acceptable for a single-clinic workload, and already true for clients/consultations.)

### F2 — Stock atomicity is defeated by unlocked inventory edits → wrong/negative stock — **BLOCKER**
**Evidence.** `consultationsCreate_` correctly pre-checks and deducts FEFO **under** `withLock_` (`Domain_Consultations.js:16,83-95`). But `medicinesUpdate_` (`Domain_Inventory.js:25`) writes `quantity` with **no lock at all**. A lock only excludes other lock-holders; a non-locking writer races straight through it.
**Sequence.** Batch X has qty 10. Vet B starts a consultation that needs 8 (takes the lock, reads 10). Simultaneously the owner restocks via Inventory: `medicines.update {quantity: 60}` (no lock) reads 10, writes 60. The consultation, still inside its lock, writes `10 − 8 = 2`. The 50-unit restock is destroyed; stock now reads 2. Reverse interleaving can drive stock **negative** or double-count a deduction. The "atomic, never-negative, FEFO" guarantee in `CONVENTIONS.md` does not hold.
**Impact.** Corrupted inventory counts, lost restocks, inventory-value report (`inventoryValue_`) wrong, dispensing blocked or over-dispensed. Direct financial/medical-safety impact.
**Fix.** Put `medicinesCreate_/Update_/Delete_` under `withLock_` (F1). Then every reader-writer of `medicines.quantity` shares the same mutex and the FEFO invariant becomes real.

### F3 — Idempotency layer is effectively dead; a lost response double-applies consultations & stock — **MAJOR**
**Evidence.** `route_` caches a mutation's result keyed by `requestId` *after* success (`Code.js:109-119`). The client generates a **fresh** `uuid()` on every `api()` call (`api.js:49`) and **never reuses a requestId** across a user resubmit or retry (confirmed: no caller passes `requestId`; `grep` shows only `mutating: true`). There is no automatic client retry, so the cache is only ever hit by an identical replay that never occurs.
**Sequence.** Vet saves a consultation that deducts stock. The server commits, but the response is lost on a flaky clinic Wi-Fi. `api()` throws `NETWORK`, the form clears `busy` (`screens-clinical.js:56`), the vet clicks **Save** again → **new requestId** → a *second* consultation row and a *second* FEFO deduction. The "idempotent (cached briefly)" promise in `Code.js:4` protects nothing here. Separately, two near-simultaneous submits with the same id would also both run, because the cache is written only after the first completes (reserve-after, not reserve-before).
**Impact.** Duplicate medical records and **double stock deduction** precisely on the bad-network conditions the mechanism was built for.
**Fix.** (a) Generate the `requestId` once **at the form/submit layer** and reuse it for the lifetime of that submission (including manual retries) so replays dedup. (b) Make idempotency *reserve-before-run*: under the lock, `put` a "pending" marker for the key before executing, so a concurrent duplicate sees it. (c) Disable the Save button until the request resolves (it currently re-enables on error).

### F4 — Login throttling is bypassable by concurrency (lost-update on the failure counter) — **MAJOR**
**Evidence.** `login_` reads the user **outside** any lock (`Auth.js:137`), computes `attempts = failed_attempts + 1` from that stale read (`:147`), and only takes the lock for the write (`:153`). The lock serializes the writes but each carries its own stale `attempts`.
**Sequence.** Attacker fires 20 wrong guesses **in parallel**. All 20 read `failed_attempts = 0`, all compute `1`, all write `1`. The counter never climbs to `MAX_FAILED_ATTEMPTS (5)`, so `locked_until` is never set. With `HASH_ITERATIONS` lowered to 2500 (`Config.js:15`, ~1s) and no IP-level limit possible on Apps Script, this is a practical online brute-force channel against the clinic's only accounts.
**Impact.** The advertised lockout (`MAX_FAILED_ATTEMPTS`/`LOCKOUT_MS`) silently fails to protect accounts under concurrent attack.
**Fix.** Do the read-increment-write of `failed_attempts` **entirely inside one `withLock_`** (read fresh under the lock, then patch). It serializes only failed logins, which is acceptable.

### F5 — A disabled/fired employee keeps full access for up to 8 hours — **MAJOR**
**Evidence.** `verifyToken_` checks signature, `exp`, and the revoked set — but **never** re-checks the user's `status` or whether the account still exists (`Auth.js:81-94`). `updateUser_` setting `status:'disabled'` (`Auth.js:244`) does **not** revoke that user's live tokens, and there is no per-user token version/epoch. `login_` checks `status==='disabled'` (`:141`) but that only blocks *new* logins.
**Sequence.** Owner fires a manager at 10am and flips them to *disabled*. The manager's phone still holds a token issued at 9am (TTL 8h, `Config.js:17`). Until ~5pm they can still read every client/pet, edit records, dispense stock, and upload/list documents.
**Impact.** No effective off-boarding; a just-revoked insider retains write access to medical and inventory data for hours.
**Fix.** Add a `token_epoch` (integer) column to `auth_users`; embed it in the token claims at issue; in `verifyToken_` reload the user and reject if `status==='disabled'` or `claims.token_epoch !== user.token_epoch`. Bump `token_epoch` on disable/role-change/password-change. Costs one cached user read on the auth path (the user row is already small).

### F6 — Changing a password does not invalidate other sessions — **MAJOR**
**Evidence.** `changePassword_` updates the hash but issues no revocation and bumps no epoch (`Auth.js:176-189`). Tokens are stateless HMACs unaffected by hash changes.
**Sequence.** A manager realizes a shared tablet was left logged in (or a token was phished) and changes their password from another device. The old token keeps working until its 8h `exp`. The password change gives a false sense of containment.
**Impact.** Compromised sessions survive the one action users take to stop them.
**Fix.** Same `token_epoch` mechanism as F5 — bump it inside `changePassword_` so all prior tokens for that user are rejected immediately.

### F7 — Forced first-login password reset is trivially bypassed — **MAJOR**
**Evidence.** On login the client calls `setSession(d.token, …)` **before** checking `must_reset` (`app.js:37-38`), so a fully valid 8h token is already persisted to `localStorage`. The forced-reset screen is pure client UI. The server enforces `must_reset` on **no** endpoint — it is only *returned* by `login_` (`Auth.js:163`) and read by the client.
**Sequence.** Admin creates a manager; the system returns a one-time temp password (`Auth.js:213`). The manager logs in, sees "set a new password," and simply reloads the tab (or edits the hash). `getSession()` is now truthy so `authed` starts `true` (`app.js:219`) and the app drops them straight into the dashboard with their **temporary** password still active. They can operate indefinitely on the shared/known temp credential.
**Impact.** The temp password handed out at provisioning effectively becomes a permanent credential; no real forced rotation.
**Fix.** Enforce server-side: store `must_reset` and reject every non-`auth.*` action for a `must_reset` user (or issue a restricted "reset-only" token from `login_` when `must_reset` is true, exchanged for a full token only by `changePassword_`).

### F8 — Soft-delete cascades nothing → orphans, dangling FKs, vanishing stock — **MAJOR**
**Evidence.** `petsDelete_` (`Domain_Clients.js:164`), `medicinesDelete_`, `vaccinationsDelete_`, `appointmentsDelete_` just `softDelete_` the row with **no child handling**. `findById_`/`findBy_` exclude deleted rows (`Db.js:81`), but children store the parent id directly. `clientsDelete_` blocks on children via `findBy_('pets',…)` (`Domain_Clients.js:69`) — which **only sees non-deleted pets**, so a client whose pets were previously soft-deleted passes the check.
**Sequence(s).** (a) Admin soft-deletes pet "Bella." Her consultations, vaccinations, appointments, and medical_documents remain, still pointing at a pet that no longer appears in any list; `enrichAppt_` renders `pet_name: null` for a still-"scheduled" appointment (`Domain_Appointments.js:120`). (b) A medicine batch with `quantity > 0` is soft-deleted — its stock silently disappears from `inventoryValue_`/low-stock, but `consultation_medicines` rows still reference it. (c) Soft-delete a pet, then its owner: the pet check passes and the client is deleted, stranding the pet record under a deleted owner.
**Impact.** Medical history detaches from its patient; inventory totals shift with no audit of *why*; reports drift. None of it surfaces to the user.
**Fix.** On delete, either block when live children exist (extend the `clientsDelete_` pattern, but query **including** the relevant child tabs) or cascade the soft-delete to children under the same lock and write an audit entry per cascaded row. At minimum, make the client→pet guard count soft-deleted pets too.

### F9 — Document upload: no idempotency + pre-lock quota check → duplicate Drive files & double-counted storage — **MAJOR**
**Evidence.** `documents.upload` is declared `idempotent:false` (`Code.js:70`), and the storage-quota check runs **before** `withLock_` (`Files.js:43` vs `:49`). `storageUsedBytes_` sums `medical_documents.size_bytes` (`Files.js:15-18`).
**Sequence.** A 4 MB X-ray upload times out client-side after the server already wrote the Drive file + metadata row. The user retries → a **second** identical Drive blob and metadata row, and storage is counted twice. Two concurrent uploads can both pass the pre-lock quota check and both exceed the 15 GB cap.
**Impact.** Duplicate medical files, inflated/under-enforced storage accounting, quota drift on the free tier.
**Fix.** Move the quota check inside the lock; honor a client-supplied `requestId` to dedup (set `idempotent` back on, or check for an existing row with the same `(pet_id, file_name, size_bytes, requestId)` under the lock before creating the blob).

### F10 — Medical documents are write-only in-app, and the only stored access path is an unguarded Drive URL — **MAJOR (trust) / latent privacy BLOCKER**
**Evidence.** There is **no** `documents.serve`/download/proxy route in `ROUTES` (`Code.js:69-74`). `uploadDocument_` stores `file_url = file.getUrl()` and `publicDoc_` returns that raw Drive URL to **any authenticated user**, manager included (`Files.js:56,77-80`). The upload never calls `setSharing`, so the blob stays private to the clinic Google account.
**Sequence.** Staff upload lab reports/X-rays. Later anyone tries to open one: the app only has a `drive.google.com` URL that requires being signed into the **clinic's** Google account, which staff are not (the whole architecture exists so they never touch Google directly — `ARCHITECTURE.md:21`). The document is effectively unretrievable through the app. The obvious "fix" a developer reaches for — `setSharing(ANYONE_WITH_LINK)` — would make **every** medical document world-readable by URL, with no RBAC and no audit, and those URLs are already handed to every manager and live in `localStorage`/network logs.
**Impact.** Today: uploaded medical records can't be viewed in-app (broken feature, lost clinical value). The moment link-sharing is added to "fix" it, all medical files leak to anyone with a forwarded link.
**Fix.** Add an admin/manager-gated `documents.serve` action that fetches the blob server-side (`DriveApp.getFileById(...).getBlob()`), enforces RBAC, writes an access audit, and returns base64 (or a short-lived signed proxy). Keep Drive private; **never** link-share. Stop returning `file_url` to the client.

### F11 — Single global lock + long lock holds → `RATE_LIMITED` stalls under burst — **MINOR/MAJOR**
**Evidence.** One app-wide `LockService.getScriptLock()` (`Db.js:56`) with a 25s acquire timeout (`Config.js:22`). `consultationsCreate_` holds it across *many* sequential Sheet writes — insert consultation, then per line a `consultation_medicines` insert + FEFO `update_` + a second `update_` to flip `deducted` + audit writes (`Domain_Consultations.js:48-58`). Each `insert_`/`update_` is its own Sheet round-trip. Builds on `PERF-AUDIT.md`; the concurrency angle is the *lock-hold duration*, not just cold start.
**Sequence.** Two vets save multi-line consultations at the same time while the front desk creates a client. With F1 applied (correctly), all serialize behind one lock; a consultation that touches a dozen rows can hold it for seconds, and a third writer that waits >25s gets `RATE_LIMITED` ("System busy"). 
**Impact.** Occasional spurious busy errors during the morning rush.
**Fix.** Shrink lock-hold: batch the `consultation_medicines` writes, and drop the redundant second `update_` that only flips `deducted:true` (set it in the initial insert after a successful deduction, or omit the flag). Keep audit writes outside the critical section where correctness allows. Platform-unavoidable part: Apps Script has exactly one script lock; design cost is how long each handler holds it.

### F12 — New-user credential handoff has no secure delivery and a permanent temp password — **MINOR (compounds F7)**
**Evidence.** `createUser_` returns the generated plaintext password once in the API response (`Auth.js:213-214`, "Deliver securely; shown only once"). There is no email/secure-channel delivery in code; `PRD.md:78` assumes email delivery that isn't implemented. Combined with F7 (`must_reset` unenforced), the temp password never has to change.
**Impact.** The admin must hand the temp password over by hand/chat; because rotation isn't enforced, it commonly stays the live credential.
**Fix.** Implement F7 server-side enforcement so the temp password is single-use, and (optionally, within free infra) send it via `MailApp` to the new user's email identifier rather than surfacing it to the admin.

---

## 2. Concurrency / Integrity scenario table

| # | Scenario | Expected | Actual | Verdict |
|---|----------|----------|--------|---------|
| A | Two staff edit different fields of the same pet/appointment simultaneously | Both edits merge (or one is told to retry) | Full-row write-back clobbers the other field; silent loss (`Db.js:150-166`, no lock) | **FAIL (F1)** |
| B | Consultation deduction races a manual restock of the same medicine | Atomic, consistent stock | Unlocked `medicinesUpdate_` races the locked deduction; restock lost / stock can go negative | **FAIL (F2)** |
| C | Lost response on consultation save, user retries | Exactly-once (idempotent) | New `requestId` → duplicate consultation + double deduction | **FAIL (F3)** |
| D | 20 parallel wrong password guesses | Lockout after 5 | Counter lost-updates; lockout never trips | **FAIL (F4)** |
| E | Two concurrent submits with the *same* requestId | Second deduped | Cache written only after first completes; both run | **FAIL (F3)** |
| F | Soft-delete a pet that has consultations/appointments | Children handled or delete blocked | Orphans + dangling FKs; null pet_name on live appts | **FAIL (F8)** |
| G | Delete a client whose pets were already soft-deleted | Blocked (children exist) | Passes (`findBy_` hides deleted pets); orphaned pet | **FAIL (F8)** |
| H | Retry/concurrent document upload | One file, quota counted once | Duplicate Drive blob; quota double-counted / cap escapable | **FAIL (F9)** |
| I | Two devices read stock 10, both dispense 8 | Second blocked (insufficient) | With F2 unfixed, both can deduct → negative | **FAIL (F2)** |
| J | Idempotent client/consultation create under correct lock | Serialized, consistent | Correct *when* the handler locks (clients, consults do) | PASS (where locked) |

## 3. Permissions matrix (role × sensitive capability)

| Capability / data | administrator | manager | Should be? | Notes |
|---|---|---|---|---|
| Create/edit clients, pets, appts, vacc, consults | ✅ | ✅ | ✅ | Operational; intended (`PRD.md:10`) |
| **Delete** any record (soft) | ✅ | ❌ (`requireAdmin_`) | ✅ correct | All `*Delete_` gate on admin |
| Hard-delete medical document | ✅ | ❌ | ✅ correct | `deleteDocument_` admin-gated (`Files.js:85`) |
| User management (create/list/update) | ✅ | ❌ | ✅ correct | `requireAdmin_` (`Auth.js:209,236,245`) |
| Settings / clinic info **write** | ✅ | ❌ | ✅ correct | `settingsUpdate_` admin (`Domain_Reports.js:195`) |
| Settings / clinic info **read** | ✅ | ✅ | ⚠️ acceptable | `settingsGet_` is `requireAuth_` only; non-sensitive |
| Storage usage view | ✅ | ❌ | ✅ correct | `storageUsage_` admin (`Files.js:21`) |
| Edit inventory & **prices** | ✅ | ✅ | ⚠️ review | Managers can rewrite `purchase/selling_price`, unlocked (F1/F2); confirm intended |
| List / read **medical document metadata + Drive URL** | ✅ | ✅ | ⚠️ risk | `documentsByPet_`/`publicDoc_` return raw `file_url` to managers; no proxy/RBAC on the blob (F10) |
| Operate with **disabled** account (live token) | ✅ until exp | ✅ until exp | ❌ should be revoked | `verifyToken_` ignores status (F5) |
| Operate after **password change** (old token) | ✅ until exp | ✅ until exp | ❌ should be revoked | No epoch/revocation (F6) |
| Operate on **temp password** without resetting | ✅ | ✅ | ❌ should be forced | `must_reset` client-only, reload bypass (F7) |

---

## Top fixes, in order
1. **Lock every mutation** (F1, F2) — wrap all domain `create/update/delete` in `withLock_`. Single highest-value change; restores the stated write invariant and real stock atomicity.
2. **Token epoch column** (F5, F6) — reject tokens on disable / password-change / role-change; check user status in `verifyToken_`.
3. **Real idempotency** (F3, F9) — reuse one `requestId` per submission, reserve-before-run under the lock, disable Save until resolved.
4. **Server-enforce `must_reset`** (F7, F12) — reset-only token until password changed.
5. **Lock-scoped failure counter** (F4) — read-increment-write of `failed_attempts` inside one lock.
6. **Cascade/guard deletes** (F8) and **document serve endpoint, never link-share** (F10).
