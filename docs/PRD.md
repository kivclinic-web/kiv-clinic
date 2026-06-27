# PRD Analysis — Veterinary Clinic Management System (KIV Clinic)

> Source of truth for *business* requirements is `/PRD.md` (repo root). This file is the
> **technical interpretation**: entities, relationships, rules, derived metrics, assumptions, and the
> function→data coverage matrix that guarantees every app function has a data path. Production-ready.

## 1. Scope summary
Cloud veterinary clinic management: clients, pets, medical records, appointments, consultations,
vaccinations, dewormings, inventory, suppliers, reports, dashboards, document storage. Two app logins:
**Administrator** (full) and **Manager / Semi-Admin** (operational, no user-management/settings, no deletes).
Clinic "clients" (pet owners) are **data, not logins**.

## 2. Entities → tables (see DATA-MODEL.md for columns)
| Entity | Tab | Notes |
|---|---|---|
| Clients | `clients` | unique mobile; 1→N pets |
| Pets | `pets` | belongs to 1 client; DOB canonical (age derived) |
| Weight history | `pet_weights` | 1 pet → N rows |
| Appointments | `appointments` | OPD/Surgery/Grooming/FollowUp; active view = last 1 week |
| Consultations | `consultations` | 1 appt → 0..1; latest 3 shown per pet |
| Prescription lines | `consultation_medicines` | drives stock deduction (idempotent) |
| Vaccinations | `vaccinations` | auto due date from `vaccine_types` |
| Vaccine catalog | `vaccine_types` | seed: Anti Rabies, DHPPIL 7/9-in-1, KC, CCV, TRICAT |
| Dewormings | `dewormings` | every 3 months for pets >6 months |
| Inventory | `medicines` | per-batch stock; low<3, expiry<6mo, value=qty×purchase |
| Suppliers | `suppliers` | 1→N medicines |
| Medical documents | `medical_documents` | Drive files; hard-delete by admin only |
| App users | `auth_users` | administrator / manager |
| Clinic settings | `clinic_info` | single-row config |
| Audit trail | `audit_log` | all mutations, deletes, auth events |
| System meta | `_meta` | schema_version, migrations, counters |

## 3. Relationship graph
```
clients 1───N pets 1───N { pet_weights, vaccinations, dewormings, appointments,
                            consultations, medical_documents }
appointments 1───0..1 consultations 1───N consultation_medicines N───1 medicines N───1 suppliers
consultations 1───N medical_documents (also pets 1───N medical_documents)
vaccinations N───1 vaccine_types
auth_users (administrator|manager)  → audit_log
consultation (follow_up) ──generates──> appointments(type=FollowUp, followup_of=consultation_id)
```

## 4. Business rules (enforced server-side)
- Unique client mobile (locked uniqueness check before insert/update).
- One pet → one client (FK existence required).
- Follow-up interval ∈ {5 days, 1 week} only.
- Active appointments view = rolling **last 7 days**; older = archived (derived by date).
- Pet history shows **latest 3 consultations**.
- Prescribing medicines **deducts stock** (atomic + idempotent; never below 0 → error).
- Inventory value = Σ(quantity × purchase_price) over non-deleted, non-expired rows.
- Expiry < 6 months → Red flag; quantity < 3 → Yellow flag (computed, surfaced to UI).
- **Only Administrator can delete** any saved data (managers blocked at the data layer).
- Medical documents: **permanent delete by Administrator only** (Drive blob removed, metadata tombstoned; unrecoverable).
- Deworming reminder every 3 months for pets older than 6 months (derived from DOB + last deworming).
- Vaccination auto due date from `vaccine_types.default_interval_days`; overdue = due_date < today & not administered.

## 5. Derived (NOT stored — computed in Apps Script)
- **Dashboard KPIs:** today's/completed/pending appointments, follow-ups today, vaccinations due, overdue
  vaccinations, low-stock count, expiring count, current inventory value.
- **Dashboard widgets & Daily Report:** all aggregations over the tabs above.
- **Red/Yellow highlights, "latest 1 week", "latest 3", storage usage %** — query/compute on demand.
- **Reminders** (appointment/vaccination/follow-up/deworming): derived from due-date queries; surfaced in UI
  and (optionally) emailed via MailApp. WhatsApp = future, out of free infra.

## 6. File storage (Google Drive)
- ~4,000 medical documents within the 15 GB free quota → ~3.75 MB/doc budget (X-rays may be large → monitor).
- Per-pet subfolders under a private `Medical Documents` root; metadata + `drive_file_id` in `medical_documents`.
- Storage-usage % shown to Admin; threshold alert when nearing capacity (configurable in `clinic_info`).

## 7. Assumptions (made per PRD; flagged for confirmation)
1. **Pet age** stored as `date_of_birth` (canonical) so age, ">6 months" deworming, and reminders stay correct
   over time; a free-text `age_text` captures what the owner reported. *(PRD lists "Age".)*
2. **Inventory = per-batch rows** (batch_number + expiry per row); stock deduction picks earliest-expiry batch
   (FEFO). Low-stock/expiry computed per row; grouping by `name_normalized` for alphabetical display.
3. **Reminders/notifications** are in-app + optional **email**; **no WhatsApp/SMS** (not free → would break
   "free forever"). Mobile is supported as an identifier/contact only.
4. **App roles = Administrator, Manager** only. Credential delivery to a created user is **email (free)** or
   **manual copy** for mobile; automated SMS is out of infra.
5. **Deletes** for normal records are admin-only **soft deletes** (preserve integrity); **documents** are
   admin-only **hard deletes** (Drive blob removed) per the "cannot be recovered" rule.
6. **Species** added to `pets` (dog/cat/…) — needed because vaccine schedules differ; defaults allowed.
7. **Archival** of >1-week appointments is by date filter (no physical move) initially; if the spreadsheet
   approaches cell limits, an archive-spreadsheet migration is the documented next step.

## 8. Function → data coverage matrix (every function has a data path)
| App function | Reads | Writes | Notes |
|---|---|---|---|
| Login / session | auth_users | audit_log, (revoked_tokens) | rate-limited, lockout |
| User management (admin) | auth_users | auth_users, audit_log | admin only |
| Add/search client | clients | clients, audit_log | unique mobile |
| Add/edit pet, view pets of client | pets, clients | pets, audit_log | FK to client |
| Record weight | pet_weights | pet_weights | history |
| Create/edit/reschedule/cancel appt | appointments, pets, clients | appointments, audit_log | active=7d |
| Auto follow-up | consultations/appointments | appointments | interval 5d/1w |
| Consultation + prescription | consultations, medicines, pets | consultations, consultation_medicines, medicines(stock−), audit_log | atomic+idempotent |
| Printable prescription | consultations, consultation_medicines, clinic_info | (optional) Drive PDF, medical_documents | |
| Vaccination record + due date | vaccinations, vaccine_types, pets | vaccinations, audit_log | auto due |
| Deworming record + reminder | dewormings, pets | dewormings, audit_log | >6mo, q3mo |
| Inventory CRUD | medicines, suppliers | medicines, audit_log | flags computed |
| Suppliers CRUD | suppliers | suppliers, audit_log | |
| Upload/list/delete document | medical_documents, pets, consultations | Drive, medical_documents, audit_log | hard-delete admin only |
| Storage usage + alert | Drive, clinic_info | (alert) | threshold |
| Dashboard KPIs / Daily Report | all tabs | — | derived |
| Reminders | appointments, vaccinations, dewormings, consultations | (optional email) | derived |
| Settings / clinic info | clinic_info | clinic_info, audit_log | admin only |

This matrix is the contract: if a future function appears, it must map onto these tabs/columns or the
schema is extended via a migration (see CONVENTIONS.md → schema versioning).
