# Data-Layer Conventions (production rules — do not violate)

These are the rules every backend change must follow. They exist so future features can't introduce
infra-caused bugs. CLAUDE.md points here; re-read before editing the data layer.

## Identity & schema
- **PK = UUID** (`Utilities.getUuid()`). Never use row numbers as identity (rows shift on sort/delete).
- **Read by header name**, never by fixed column index. A central **schema registry** (in `apps-script/`)
  defines every tab's columns; code maps header→index at runtime so column reordering can't break anything.
- Adding/removing columns or tabs = a **migration** (see below), bumping `schema_version`.

## Timestamps, deletes, integrity
- Every domain row carries `created_at/by`, `updated_at/by` (ISO-8601 UTC).
- **Soft delete by default** (`is_deleted/deleted_at/deleted_by`); reads filter out deleted rows.
  Exception: `medical_documents` admin **hard-delete** removes the Drive blob (PRD: unrecoverable) and
  tombstones the row. `audit_log` is append-only (never deleted).
- **Foreign keys**: validate referenced row exists (and not deleted) before insert/update.
- **Unique constraints** (client mobile, user identifier): enforced in code under a lock.

## Writes: atomicity, concurrency, idempotency
- **Every write path acquires `LockService.getScriptLock()`** (Sheets has no transactions). Keep critical
  sections short; release in `finally`.
- **Idempotency**: mutating requests accept a client `requestId`; processed ids are recorded so retries
  don't double-apply (critical for stock deduction — `consultation_medicines.deducted` + requestId).
- Stock deduction: atomic, **FEFO** (earliest expiry first), never allows quantity < 0 (→ typed error).

## Validation & errors
- **All validation server-side** (client validation is UX only). Coerce/validate types, enums, required
  fields, formats (mobile, email, dates) before any write.
- **Uniform error envelope** with stable `code`s (see API-CONTRACT.md). Never leak stack traces/internals
  to the client. Log full detail server-side.

## Auth & security
- Passwords: per-user random salt + **key-stretched SHA-256** (many iterations via `Utilities.computeDigest`).
  Plaintext never stored; shown once for delivery.
- Sessions: **HMAC-signed token** (secret in Script Properties) carrying `sub, role, jti, exp`. Verify
  signature + expiry + revocation list on every authed call.
- **RBAC**: role checks server-side. **Deletes = Administrator only.** Managers blocked from user mgmt,
  settings, and all deletes.
- **Login throttling**: increment `failed_attempts`, lock via `locked_until` after N fails.
- Secrets/IDs only in **Script Properties**, never in code or the repo.

## Performance (Apps Script / Sheets limits)
- **Batch I/O**: read a tab once via `getDataRange().getValues()`; write via batched `setValues()`. No
  per-row reads/writes in loops (6-min execution cap, quota).
- Cache reference/seed data (`vaccine_types`, `clinic_info`) in `CacheService`.
- **Pagination** on list endpoints (`limit`/`offset`/`cursor`); never dump whole tabs to the client.
- Derived metrics (KPIs/reports/flags) computed on read; consider short-TTL cache for the dashboard.

## Migrations & versioning
- Schema changes go through numbered migration functions; `_meta.schema_version` tracks the applied version.
- Migrations are **idempotent** and **forward-only**; run under lock; record in `audit_log`.

## Backups & monitoring
- **Scheduled backup**: time-driven trigger copies the Spreadsheet into Drive `Backups/` daily; prune old.
- **Storage monitoring**: compute Drive usage; when ≥ `clinic_info.storage_warn_pct`, surface alert (and
  optional admin email).
- **Observability**: structured `console`/Stackdriver logging with a request id; mutations recorded in `audit_log`.

## API style
- Single Web App endpoint, `doPost` with `action` routing (+ a GET `ping` health check).
- `POST` body `Content-Type: text/plain` (JSON string) to avoid CORS preflight; responses JSON-in-text.
- Versioned, **idempotent deployments** via clasp; keep a rollback deployment id.

## Testing / verification
- Apps Script **test functions** cover: auth (create→login→verify, lockout), CRUD per entity, unique/FK
  enforcement, stock deduction idempotency, document upload/hard-delete, derived KPIs.
- See ARCHITECTURE.md "Verification" and the plan's verification section for the end-to-end checks.
