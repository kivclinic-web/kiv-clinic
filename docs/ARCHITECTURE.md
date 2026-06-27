# Architecture — KIV Clinic (free-forever stack)

## Topology
```
Browser (GitHub Pages static SPA)
        │  HTTPS POST (text/plain JSON) + Bearer-style token
        ▼
Google Apps Script Web App  ──── the ONLY gateway to data ────┐
  - doPost(action router) + doGet(ping)                       │
  - auth (hash/verify, HMAC tokens, RBAC, throttling)         │
  - data layer (schema registry, CRUD, LockService, idemp.)   │
  - file service (Drive upload/list/delete)                   │
  - migrations, backups, storage monitor, audit               │
        │ owner-privilege access                              │
        ▼                                                     ▼
Google Spreadsheet (DB, private)                Google Drive (files, private)
  one tab per table                               Medical Documents / Backups / Assets
```
- Single Google account: **kivclinic@gmail.com** owns the Sheet, Drive, and Apps Script project.
- Web App deployed **Execute as: owner**, **Access: anyone** (so GitHub Pages can call it). Google's
  access control is *not* the security boundary — **our token auth + RBAC is**. The Sheet/Drive are
  **never shared publicly**.

## Data flow (example: prescribe medicines)
1. Client POSTs `{action:"consultation.create", token, requestId, payload}`.
2. Web App verifies token + role, validates payload.
3. Acquires script lock → creates consultation + line items → FEFO stock deduction (idempotent via
   requestId/deducted) → writes audit_log → releases lock.
4. Returns uniform success envelope. Dashboard KPIs recompute on next read.

## CORS approach
Apps Script Web Apps don't emit full CORS headers for arbitrary cross-origin calls. We avoid preflight by
sending **simple requests**: `POST` with `Content-Type: text/plain` carrying a JSON string; the response is
JSON returned as text (`ContentService`). The frontend parses it. Documented in API-CONTRACT.md.

## Backend code & deployment
- Source in repo under `apps-script/` (`.js` + `appsscript.json`), managed by **clasp**.
- `clasp login` (user OAuth) → `clasp push` → deploy as versioned Web App. Keep the previous deployment id
  for rollback. Secrets/IDs in **Script Properties** (set once, never committed).

## Free-tier limits (designed around)
| Resource | Limit (consumer) | Mitigation |
|---|---|---|
| Apps Script execution | 6 min/run, ~30 concurrent | batch I/O, short locked sections |
| Apps Script triggers/day | ~20 triggers, time quotas | one daily backup + monitor trigger |
| Sheets size | 10,000,000 cells / spreadsheet | soft-delete, date archival, future archive sheet |
| Drive/Gmail storage | 15 GB shared | ~4000 docs budget, storage monitor + alert |
| MailApp | ~100 recipients/day | reminders are in-app first; email sparingly |
| URL Fetch / misc | daily quotas | n/a for core flows |
- **No WhatsApp/SMS** (paid) → reminders are in-app + optional email; WhatsApp is a future module.

## Security posture
- Private Sheet/Drive; owner-execution bridge; token auth + RBAC; admin-only deletes; salted/stretched
  password hashes; HMAC tokens with expiry + revocation; login throttling; full audit log.
- Veterinary (non-human) data → no HIPAA scope; still treat owner contact info as sensitive (least exposure).

## Backups & recovery
- Daily Spreadsheet copy into Drive `Backups/` (time-driven trigger); retain N copies. Manual restore =
  copy a backup over the live Sheet id (documented runbook). Drive files are the source of truth for documents.

## Verification (smoke + functional)
- `GET ?action=ping` → `{ok:true, schema_version}`.
- Bootstrap first admin → login → token → authed `client.create` → row appears; password cell is a hash.
- Upload base64 doc → file in Drive `Medical Documents/{pet}/`, metadata row created; admin hard-delete
  removes the blob and tombstones the row.
- Prescribe with a duplicate `requestId` twice → stock deducted exactly once.
- Dashboard KPIs return expected counts on seeded data.

## Environments
- Single production project initially. Optional: a separate `*-staging` Apps Script bound to a copy
  spreadsheet for testing migrations before prod (documented, not required for v1).
