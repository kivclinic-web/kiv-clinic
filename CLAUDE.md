# Project Rules — kiv-clinic

These rules are mandatory and must never be broken in this working directory.

## Git identity — single account only
- The ONLY git identity allowed for this project is the **kivclinic-web** GitHub account:
  - `user.name = kivclinic-web`
  - `user.email = 297182821+kivclinic-web@users.noreply.github.com`
- Every commit must be authored AND committed by this identity.
- Never set, restore, or reference any other personal name or email as the git
  author/committer. A previous personal account was intentionally removed from this
  machine's git config and keychain — it must never be reintroduced anywhere
  (commits, config, files, branch names, messages, or comments).

## No Claude co-authorship
- No commit may credit Claude as a co-author.
- Never append a `Co-Authored-By: Claude ...` trailer to any commit message.
- Never add a "Generated with Claude Code" line to any commit or pull request body.

## Identity hygiene
- Do not write the previous account owner's name or email into any file, config,
  commit, log, or output.
- All work and attribution flows through the kivclinic-web account.

## Credentials
- Stored credentials for any prior GitHub login have been removed from the macOS
  keychain. Authentication for pushes uses the kivclinic-web account only.

---

# Product & Architecture

This is a **production-ready Veterinary Clinic Management System** built on a **free-forever** stack.
Business requirements live in `/PRD.md`; the technical interpretation and contracts live in `docs/`.
**Read the relevant `docs/` file before changing the data layer.**

- `docs/PRD.md` — entities, relationships, business rules, function→data coverage matrix, assumptions.
- `docs/DATA-MODEL.md` — the concrete Sheets schema (every tab + columns) and Drive layout.
- `docs/CONVENTIONS.md` — mandatory data-layer rules.
- `docs/ARCHITECTURE.md` — topology, CORS, limits, security, backups, verification.
- `docs/API-CONTRACT.md` — request/response envelope, error codes, action list.

## Infra constraints — never violate
- **Only** these services, all under **kivclinic@gmail.com**: GitHub Pages (frontend), Google Apps
  Script Web App (API), Google Sheets (DB), Google Drive (files). **No other infrastructure, ever**
  (it must run free forever). No paid services, no WhatsApp/SMS gateways (reminders = in-app + optional email).
- The Spreadsheet and Drive are **private** and **never shared publicly**. The Apps Script Web App is the
  **only** gateway to data; security is our **token auth + RBAC**, not Google sharing.

## Data-layer rules — never violate (full list in docs/CONVENTIONS.md)
- One tab = one table; **read by header name**, never by column index (use the schema registry).
- **UUID** primary keys; `created/updated/deleted` audit columns; **soft delete by default**
  (documents are the admin-only hard-delete exception).
- **Every write under `LockService`**; mutations are **idempotent** (`requestId`). Stock deduction is
  atomic, FEFO, never negative.
- **All validation server-side**; uniform error envelope; **deletes are Administrator-only**.
- Passwords **salted + stretched hashed** (never plaintext); HMAC tokens; login throttling; full `audit_log`.
- Secrets/IDs in **Script Properties** only — never hardcoded or committed.
- Schema changes go through **numbered migrations** (`_meta.schema_version`).
- Batch all Sheet I/O; paginate list endpoints; cache reference data.
- Production hygiene: scheduled **backups**, **storage monitoring**, structured logging, test functions.
