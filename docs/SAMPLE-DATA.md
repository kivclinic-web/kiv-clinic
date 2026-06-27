# Sample / Seed Data — what to KEEP vs REPLACE

This catalogues what is currently in the live database so the clinic knows what is **demo data**
(safe to delete before real use) versus **reference/system data** (keep). Seeded by
`scripts/seed-demo.mjs` and `scripts/seed-*` helpers.

## ❌ DEMO data — REPLACE/DELETE before going live
All of the following are fictional, created only to make the UI render richly during the build.
They can be soft-deleted in-app (Administrator) or purged via `scripts/purge-demo.mjs` (to be added).

| Type | Rows (demo) | Notes |
|---|---|---|
| Clients | Aisha Khan, Rohan Mehta, Priya Sharma | fictional owners + mobiles |
| Pets | Mochi (Shiba), Simba (Maine Coon), Bruno (Labrador) | linked to the demo clients |
| Suppliers | VetPharma Co., BioVet Labs | fictional |
| Medicines | Carprofen 75mg, Amoxicillin 250mg, Meloxicam 1.5mg/ml | demo batches/prices; Amoxicillin=low stock, Meloxicam=low+expiring |
| Appointments | 4 appointments dated "today" (OPD/Grooming/OPD/Surgery) | regenerate as real bookings |
| Vaccinations | Bruno (overdue), Simba (due soon), Mochi (upcoming) | demo due-date spread |
| Dewormings | Bruno (overdue) | demo |
| Consultations | 1 for Mochi (prescribed Carprofen ×7 → stock deducted) | demo; also created the Rx line item |

> Any **additional** sample rows created later while building screens will be appended to this table.

## ✅ KEEP — reference / system data
| Type | Rows | Notes |
|---|---|---|
| `vaccine_types` | Anti Rabies, DHPPIL (7-in-1), DHPPIL (9-in-1), KC, CCV, TRICAT | **Keep**, but **REVIEW the default intervals** — all seeded at 365 days as placeholders; set real schedules. |
| `clinic_info` | single row ("KIV Clinic") | Keep; edit real clinic name/address/phone/email in Settings. |
| `_meta` | schema_version=1 | system; keep |
| `auth_users` | the first administrator | **Keep** (but change its password and add real staff users). |

## How to reset to a clean production state
1. In-app (Administrator): delete demo clients/pets/medicines/etc. (soft delete).
2. Or run `scripts/purge-demo.mjs` (soft-deletes the demo rows by their known names) — to be added.
3. Edit `clinic_info` (Settings) and `vaccine_types` intervals to real values.
4. Change the admin password; create real manager/staff accounts.

_Last updated as the build progressed; keep this in sync whenever sample data is added or removed._
