# API Contract — KIV Clinic Apps Script Web App

Single endpoint. `GET` for health only; everything else is `POST`.
**Base URL:** _(filled after deployment)_ → `WEB_APP_URL`.

## Transport
- **POST**, `Content-Type: text/plain` (avoids CORS preflight), body = JSON **string**.
- Response = JSON returned as text via `ContentService` (`application/json` mime where honored).

## Request envelope
```json
{
  "action": "domain.verb",
  "token": "<HMAC session token, omit for login/ping/bootstrap>",
  "requestId": "<client-generated UUID for idempotency on mutations>",
  "payload": { }
}
```

## Response envelope
```json
// success
{ "ok": true, "data": { }, "meta": { "schema_version": 1 } }
// error
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "human readable", "fields": { } } }
```

## Error codes (stable)
`AUTH_REQUIRED` · `AUTH_INVALID` · `AUTH_LOCKED` · `FORBIDDEN` (role) · `VALIDATION_ERROR` ·
`NOT_FOUND` · `CONFLICT` (unique/duplicate) · `FK_VIOLATION` · `OUT_OF_STOCK` · `STORAGE_FULL` ·
`RATE_LIMITED` · `INTERNAL`. Never leak internals; full detail logged + audited server-side.

## Auth
| action | role | payload | returns |
|---|---|---|---|
| `auth.bootstrapAdmin` | none + `BOOTSTRAP_ADMIN_TOKEN` | identifier, identifier_type, display_name | first admin; one-time |
| `auth.login` | none | identifier, password | token, role, must_reset |
| `auth.logout` | any | — | revokes jti |
| `auth.changePassword` | any | old, new | — |
| `users.create` | admin | identifier, type, display_name, role | **generated password (once)** |
| `users.list` / `users.update` / `users.disable` | admin | … | managers blocked |

## Domain actions (map to PRD function→data matrix)
All list actions support `{ limit, cursor, filters, search }` and exclude soft-deleted rows.
Deletes require **administrator**.

| action | role | notes |
|---|---|---|
| `clients.create/update/list/get/delete` | mgr+/admin-del | unique mobile; delete=admin |
| `pets.create/update/list/get/delete` | mgr+/admin-del | FK client; `pets.byClient` |
| `petWeights.add/list` | mgr+ | history |
| `appointments.create/update/reschedule/cancel/list` | mgr+/admin-del | `list` active=last 7d; `archiveList` |
| `appointments.followupsToday` | mgr+ | derived |
| `consultations.create` | mgr+ | + line items + **atomic FEFO stock deduction** (idempotent) |
| `consultations.byPet` | mgr+ | latest 3 |
| `consultations.prescriptionDoc` | mgr+ | optional PDF → Drive |
| `vaccinations.create/list/byPet` | mgr+ | auto due_date from vaccine_types |
| `vaccinations.dueList/overdueList` | mgr+ | derived |
| `dewormings.create/byPet/dueList` | mgr+ | q3m, pets >6mo |
| `medicines.create/update/list/delete` | mgr+/admin-del | flags computed; `lowStock`, `expiring`, `inventoryValue` |
| `suppliers.create/update/list/delete` | mgr+/admin-del | |
| `documents.upload` | mgr+ | base64 → Drive; links pet (+consultation) |
| `documents.byPet/byConsultation/list` | mgr+ | |
| `documents.delete` | **admin** | hard-delete Drive blob + tombstone |
| `storage.usage` | admin | %, alert if ≥ threshold |
| `dashboard.kpis` | mgr+ | all KPI cards (derived) |
| `dashboard.widgets` | mgr+ | today appts, follow-ups, vacc due, inventory/expiry alerts |
| `reports.daily` | mgr+ | daily report aggregates |
| `reminders.all` | mgr+ | appt/vacc/followup/deworming (derived); optional email |
| `settings.get/update` | admin | clinic_info |
| `ping` (GET) | none | `{ok:true, schema_version}` |

## Idempotency
Mutations include `requestId`; the server records processed ids (short retention) and returns the prior
result on retry. Stock deduction additionally guards via `consultation_medicines.deducted`.

## Versioning
`meta.schema_version` returned on every response. Breaking changes bump it; migrations run server-side.
