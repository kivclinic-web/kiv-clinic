# Data Model — KIV Clinic (Google Sheets as DB)

> One Spreadsheet = the database. One **tab = one table**. Header row (row 1, frozen) = schema.
> Access is **only** through the Apps Script Web App. See CONVENTIONS.md for the rules every tab obeys.
> Types are logical (Sheets stores loosely; Apps Script coerces/validates). `schema_version: 1`.

## Conventions applied to (almost) every tab
Standard columns present on all domain tabs unless noted:
`id` (UUID, PK) · `created_at` · `updated_at` (ISO-8601 UTC) · `created_by` (auth_users.id) ·
`updated_by` · `is_deleted` (bool) · `deleted_at` · `deleted_by`. Soft-delete is the default.

---

## System & auth tabs

### `_meta`  (single-row config / counters)
| col | type | notes |
|---|---|---|
| key | string | e.g. `schema_version`, `last_backup_at` |
| value | string | |
Used for schema version, migration bookkeeping, backup timestamps.

### `auth_users`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| identifier | string | email or mobile, **unique** |
| identifier_type | enum | `email` \| `mobile` |
| display_name | string | |
| role | enum | `administrator` \| `manager` |
| password_hash | string | salted + stretched SHA-256 (hex) |
| password_salt | string | per-user random (hex) |
| status | enum | `active` \| `disabled` |
| must_reset | bool | force change on first login |
| failed_attempts | int | for lockout |
| locked_until | datetime | rate-limit lockout |
| last_login_at | datetime | |
| + standard cols | | |
**Passwords never stored in plaintext.** Generated plaintext returned once to admin for delivery.

### `revoked_tokens`  (logout / revocation)
| col | type | notes |
|---|---|---|
| jti | string | token id (HMAC token claim) |
| user_id | uuid | |
| revoked_at | datetime | |
| expires_at | datetime | prune after expiry |

### `audit_log`  (append-only; never soft-deleted)
| col | type | notes |
|---|---|---|
| id | uuid | |
| ts | datetime | |
| actor_id | uuid | auth_users.id (or `system`) |
| actor_role | enum | |
| action | string | e.g. `client.create`, `medicine.deduct`, `document.delete`, `auth.login` |
| entity | string | tab name |
| entity_id | uuid | |
| details | json (string) | before/after or context |

### `clinic_info`  (single row, settings)
| col | type | notes |
|---|---|---|
| id | uuid | fixed singleton |
| clinic_name | string | |
| address | string | |
| phone | string | |
| email | string | |
| logo_file_id | string | Drive id |
| storage_warn_pct | int | default 85 |
| + updated_at/by | | |

---

## Domain tabs

### `clients`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| name | string | required |
| mobile | string | required, **unique** (normalized digits) |
| address | string | required |
| email | string | optional |
| notes | string | optional |
| + standard cols | | |

### `pets`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| client_id | uuid | FK → clients, required |
| name | string | required |
| species | enum | `dog`\|`cat`\|`other` (for vaccine schedules) |
| breed | string | required |
| sex | enum | `male`\|`female`\|`unknown` |
| date_of_birth | date | canonical for age/reminders |
| age_text | string | as reported (optional) |
| color | string | optional |
| neutered | bool | optional |
| + standard cols | | |

### `pet_weights`
| col | type | notes |
|---|---|---|
| id | uuid | |
| pet_id | uuid | FK → pets |
| weight_kg | number | |
| recorded_at | datetime | |
| recorded_by | uuid | |
(no soft-delete needed; history append)

### `appointments`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| pet_id | uuid | FK → pets |
| client_id | uuid | FK → clients (denorm for fast lists) |
| type | enum | `OPD`\|`Surgery`\|`Grooming`\|`FollowUp` |
| status | enum | `scheduled`\|`completed`\|`cancelled`\|`rescheduled`\|`no_show` |
| scheduled_at | datetime | drives "today"/"last 7d" |
| reason | string | |
| is_followup | bool | |
| followup_of | uuid | consultation_id or appointment_id |
| followup_interval | enum | `5d`\|`1w`\|null |
| rescheduled_from | uuid | optional link |
| + standard cols | | |

### `consultations`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| pet_id | uuid | FK → pets |
| client_id | uuid | denorm |
| appointment_id | uuid | FK → appointments (optional) |
| consult_date | datetime | for "latest 3" |
| diagnosis | string | |
| treatment | string | |
| clinical_notes | string | |
| follow_up_recommendation | string | |
| follow_up_interval | enum | `5d`\|`1w`\|null → generates appointment |
| prescription_file_id | string | optional generated PDF in Drive |
| + standard cols | | |

### `consultation_medicines`  (prescription line items → stock deduction)
| col | type | notes |
|---|---|---|
| id | uuid | |
| consultation_id | uuid | FK → consultations |
| medicine_id | uuid | FK → medicines (batch chosen FEFO) |
| medicine_name | string | snapshot at prescribe time |
| quantity | int | deducted from stock |
| dosage | string | |
| instructions | string | |
| deducted | bool | idempotency guard (never double-deduct) |
| created_at | datetime | |

### `vaccinations`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| pet_id | uuid | FK → pets |
| vaccine_type_id | uuid | FK → vaccine_types |
| vaccine_name | string | snapshot |
| date_administered | date | |
| due_date | date | auto = administered + interval |
| batch_number | string | optional |
| administered_by | uuid | |
| notes | string | |
| + standard cols | | |
(status administered/due/overdue is **derived**, not stored)

### `vaccine_types`  (seed/reference)
| col | type | notes |
|---|---|---|
| id | uuid | |
| name | string | Anti Rabies, DHPPIL (7-in-1), DHPPIL (9-in-1), KC, CCV, TRICAT |
| default_interval_days | int | for auto due date |
| species | string | applicability (optional) |
| is_active | bool | |

### `dewormings`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| pet_id | uuid | FK → pets |
| date_administered | date | |
| next_due | date | = administered + 3 months |
| product | string | optional |
| administered_by | uuid | |
| + standard cols | | |

### `medicines`  (inventory, per-batch stock)
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| name | string | required |
| name_normalized | string | lowercase for sort/group |
| batch_number | string | |
| quantity | int | current stock (≥0) |
| unit | string | optional (tablet/ml) |
| purchase_price | number | for inventory value |
| selling_price | number | |
| supplier_id | uuid | FK → suppliers |
| expiry_date | date | <6mo ⇒ Red (derived) |
| reorder_threshold | int | default 3 (<3 ⇒ Yellow) |
| + standard cols | | |

### `suppliers`
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| name | string | required |
| contact_person | string | optional |
| mobile | string | |
| email | string | optional |
| address | string | |
| + standard cols | | |

### `medical_documents`  (Drive-backed)
| col | type | notes |
|---|---|---|
| id | uuid | PK |
| pet_id | uuid | FK → pets (always set) |
| consultation_id | uuid | FK → consultations (optional; for history view) |
| doc_type | enum | `Scanned Prescription`\|`Lab Report`\|`X-Ray`\|`Diagnostic Report`\|`Other` |
| title | string | |
| drive_file_id | string | Drive id (cleared on hard-delete) |
| file_url | string | webViewLink |
| file_name | string | |
| mime_type | string | |
| size_bytes | int | for storage accounting |
| uploaded_by | uuid | |
| uploaded_at | datetime | |
| is_deleted | bool | hard-delete tombstone (Drive blob removed) |
| deleted_at / deleted_by | | admin only |

---

## Google Drive structure (private; owner = kivclinic@gmail.com)
```
KIV Clinic/                      (root folder id → Script Property DRIVE_ROOT_FOLDER_ID)
├── Medical Documents/           (DOCS_FOLDER_ID)
│   └── {petId}__{petName}/      (per-pet subfolder, created on first upload)
├── Prescriptions/               (optional generated PDFs)
├── Clinic Assets/               (logo, etc.)
└── Backups/                     (scheduled spreadsheet copies)
```

## Script Properties (config/secrets — never hardcoded)
`SPREADSHEET_ID`, `DRIVE_ROOT_FOLDER_ID`, `DOCS_FOLDER_ID`, `PRESCRIPTIONS_FOLDER_ID`,
`BACKUPS_FOLDER_ID`, `TOKEN_SECRET` (HMAC), `BOOTSTRAP_ADMIN_TOKEN` (one-time first-admin creation),
`SCHEMA_VERSION`.

## Seed data
- `vaccine_types`: the 6 PRD vaccines with default intervals (Anti Rabies 365d, DHPPIL annual, etc. — confirm).
- `clinic_info`: one row.
- First **Administrator**: created via one-time bootstrap (see API-CONTRACT.md), password delivered to user.
