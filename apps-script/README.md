# KIV Clinic — Apps Script Backend (deploy runbook)

The backend is the **only** gateway to data (Google Sheets DB + Drive files). It's deployed as a single
Google Apps Script **Web App** under **kivclinic@gmail.com**. Code is managed with `clasp` (installed
locally as a devDependency — use `npx clasp`).

## One-time: steps that require YOU (Google auth — Claude cannot do these)
1. **Enable the Apps Script API** for the account: open
   <https://script.google.com/home/usersettings> while signed in as **kivclinic@gmail.com**, and turn
   **Google Apps Script API = ON**.
2. **Log clasp in:** in this repo run
   ```bash
   npx clasp login
   ```
   A browser opens — authorize with **kivclinic@gmail.com**. (Credentials are stored in `~/.clasprc.json`,
   which is gitignored.)

## Then (Claude can run these for you)
3. Create the script project + push code:
   ```bash
   npx clasp create --title "KIV Clinic API" --type webapp --rootDir apps-script
   npx clasp push -f
   ```
4. **Provision everything (run once):** open the editor and run `setup()`:
   ```bash
   npx clasp open-script
   ```
   In the editor: select the `setup` function → **Run** → **Authorize** the requested scopes
   (Sheets, Drive, Script, Mail). `setup()` creates the spreadsheet, all tabs, Drive folders, seed data,
   secrets, and a daily backup trigger. The execution log prints the **bootstrap_admin_token** — copy it.
5. **Deploy the Web App:**
   ```bash
   npx clasp deploy --description "v1"
   npx clasp list-deployments      # note the deployment id
   ```
   Web App URL = `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

## Create the first administrator
POST to the Web App URL (text/plain to avoid CORS preflight):
```bash
curl -sL -X POST "<WEB_APP_URL>" -H 'Content-Type: text/plain' \
  --data '{"action":"auth.bootstrapAdmin","payload":{"bootstrap_token":"<TOKEN_FROM_setup>","identifier":"admin@yourclinic.com","identifier_type":"email","display_name":"Clinic Admin"}}'
```
The response returns a **one-time generated password** — store it, then log in via `auth.login`.

## Verify
```bash
curl -sL "<WEB_APP_URL>?action=ping"     # {"ok":true,"data":{"pong":true,...}}
```
Or run the full server-side suite: in the editor run `runAllTests()` (use a fresh spreadsheet for the
complete auth path).

## Day-to-day
- Edit code locally → `npx clasp push -f` → `npx clasp deploy` (new version).
- Tail logs: `npx clasp tail-logs`. Secrets/IDs live in **Script Properties** (Project Settings), never in code.
