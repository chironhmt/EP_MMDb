# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HemaCDS 2.0 is a clinical data management tool for the Multiple Myeloma Center at Eunpyeong St. Mary's Hospital. It is a set of static HTML/CSS/JS pages, one per clinical domain, plus a small Flask+SQLite backend for patient records. There is no build step, no package manager, no bundler, and no automated test suite.

## Running the app

Start the backend (installs `flask`/`flask-cors` and launches the API server, opening `Chemotherapy.html` in the browser):

```
Chemotherapy.bat
```

This runs `python Eunpyeong_Myeloma_Center_Server.py`, which serves on `http://127.0.0.1:5001` and serves every file in the project root as a static asset (`GET /<filename>`). **Pages must be loaded through this server, not opened directly via `file://`** — `Chemotherapy.html`/`app.js` fetch JSON reference data (`Eunpyeong_Myeloma_Center_Agents.json`, `_Drug_Dosing.json`, `_Regimens.json`) which fails under `file://` due to CORS.

There is no linter, formatter, or test runner configured for this repo.

### Deploying to Vercel

The frontend (static HTML/CSS/JS/JSON) can be deployed to Vercel as-is — Vercel serves everything at the project root directly. The Flask+SQLite backend cannot: Vercel's Python functions are stateless serverless invocations with no persistent/writable disk, so a single on-disk SQLite file doesn't survive between requests. `api/index.py` is a separate, Postgres-backed port of `Eunpyeong_Myeloma_Center_Server.py` used only on Vercel; `Eunpyeong_Myeloma_Center_Server.py` + `Chemotherapy.bat` keep using SQLite for local development, unchanged. The two backends are **not** shared code — a change to one endpoint (new field, new table, new business logic) has to be made in both files or they'll silently drift apart.

To deploy:
1. Provision a Postgres database (e.g. Vercel Postgres from the project's Storage tab) and set its connection string as the `POSTGRES_URL` (or `DATABASE_URL`) env var on the Vercel project. `api/index.py` creates its tables automatically on first request.
2. To bring over existing local data, set the same env var locally and run `python migrate_to_postgres.py` (see that file's docstring) — a one-off script, not invoked automatically by anything.
3. `vercel.json` rewrites every `/api/*` request to `api/index.py`, which does its own Flask-level routing from there, matching `Eunpyeong_Myeloma_Center_Server.py`'s routes.
4. The frontend picks its API base at runtime — `http://127.0.0.1:5001` on `localhost`/`127.0.0.1`, same-origin (`/api/...`) everywhere else — see `API_BASE` in `app.js`, `Add_New_Patient.html`, `Edit_Patient.html`, and `Dashboard.html`.

This is a clinical database handling real patient data — hosting it on a public cloud platform has security/compliance implications (access control, encryption, data residency) beyond what this repo enforces on its own; that's a decision for whoever owns the deployment, not something to default into.

## Architecture

### Page-per-domain frontend

Each clinical workflow is an independent, self-contained HTML file (inline or page-specific `<script>`, sharing `styles.css`):

- `Add_New_Patient.html` / `Edit_Patient.html` — patient demographics & diagnosis intake, talk to the Flask API (`/api/patients`).
- `Baseline_Charateristics.html`, `Chemotherapy.html` (+ `app.js`), `CD34+_Collection.html`, `Transplant.html`, `GVHD.html`, `Radiotherapy.html`, `Imaging.html`, `Engraftment.html` — per-domain clinical forms.
- `Dashboard.html` — patient list/overview, reads from the Flask API.

Pages navigate each other via plain `window.location.href` (e.g. Dashboard → `Add_New_Patient.html`, `Edit_Patient.html?upn=<id>`), not client-side routing.

### Data persistence is split and inconsistent — check before assuming

- **Patients** (`Add_New_Patient.html`, `Edit_Patient.html`, `Dashboard.html`) persist through the Flask API into SQLite.
- **Chemotherapy** (`Chemotherapy.html` + `app.js`) persists through the Flask API into the `chemo_lines` / `chemo_cycles` / `chemo_cycle_agents` / `chemo_cycle_agent_day_overrides` tables. One page load edits exactly one treatment line; the page is opened as `Chemotherapy.html?upn=<UPN>` (Dashboard's "CHEMOTHERAPY" button in the Treatment History section) and appends `&line_id=<id>` after the first save. On load it resumes the patient's most recent saved line, or starts blank if there is none. Any SUBMIT button saves the whole line — the line-level fields, every cycle, every agent schedule, and every calendar day-override — as a single POST/PUT; the server replaces that line's cycle tree wholesale rather than diffing it.
- **Other domains** (e.g. `Transplant.html`) currently persist via `localStorage` (e.g. key `hemaCDS_transplant_data`) rather than the API, and some pages don't persist at all yet.
- `Eunpyeong_Myeloma_Center_Database_Schema.md` documents the full *intended* relational schema (patients, chemo_lines/cycles/agents, cd34_collections, transplant_records, gvhd_assessments, radiotherapy_records, imaging_studies) with an ERD and DDL. **This describes the target design, not necessarily what `Eunpyeong_Myeloma_Center_Server.py` actually implements** — the live server wires up `/api/patients` (GET/POST/PUT) against a table called `eunpyeong_mm_patients` (using a narrower/older field list than the schema doc's `patients` table) plus the `/api/chemo/...` endpoints above; the CD34, transplant, GVHD, radiotherapy and imaging tables in the schema doc have no endpoints and no tables yet. Always verify against `Eunpyeong_Myeloma_Center_Server.py` directly rather than trusting the schema doc when working on backend/API code.
- The DB file itself has a space in its name: `Eunpyeong_Myeloma Center_Database.db` (note: no underscore between "Myeloma" and "Center").

### Chemotherapy cycle planner (`app.js`)

Drives `Chemotherapy.html`'s cycle-builder UI. On load it fetches three reference JSON files and builds in-memory lookup structures:

- `Eunpyeong_Myeloma_Center_Agents.json` → grouped by `Class` into `groupedAgents` (drug class → agent list, each with dose/dosing-day info).
- `Eunpyeong_Myeloma_Center_Drug_Dosing.json` → `dosingDaysMap` (dosing code → human-readable schedule).
- `Eunpyeong_Myeloma_Center_Regimens.json` → `regimensData`, used to populate the regimen dropdown and to bulk-apply a preset regimen's agents/cycles (destructive — prompts for confirmation since it replaces current cycles).

Cycles are held in an in-memory `cycles` array (`currentCycleId` tracks the active one), and `currentLineId` tracks the saved `chemo_lines` row the page is editing. `buildLinePayload()` flattens that in-memory state into the API's JSON shape and `applyLineData()`/`buildCycleFromRow()` rebuild it on load — the two are mirror images, so any new per-cycle or per-schedule field must be added to both or it will silently fail to persist. Note the asymmetry they handle: a dose/dosing-day value that isn't one of the agent's presets in `Eunpyeong_Myeloma_Center_Agents.json` is stored flat in the DB but must be split back into `dose: 'Others'` + `customDose` for the radio-button UI.

### UI design system — mandatory for any HTML/CSS work

`.agents/AGENTS.md` defines the design-consistency contract, using `Chemotherapy.html` + `styles.css` as the reference implementation. Key rules to follow when creating or editing pages:

- Google Fonts `Outfit` (300–700); default text color `var(--text-primary)`.
- Use the CSS variables defined in `styles.css` (`--bg-dark`, `--bg-panel`, `--bg-glass`, `--accent-primary`, `--text-primary`, `--text-secondary`, `--radius-lg/md/sm`, `--shadow-glass`, `--shadow-glow`, etc.) — don't hardcode colors.
- Layout: `.app-container` (flex row/column) → `.sidebar` + `.app-main`; `.app-header` for the glassmorphic top bar (`backdrop-filter: blur(12px)`).
- Components: `.card`/`.card-header`/`.card-body` for sections; `.custom-text-input`/`.custom-date-format` for form fields; `.btn-secondary` for action buttons with inline SVG icons (`stroke="currentColor"`).
- Input/output rows default to 4 columns per row, with labels placed left of their input, `align-items: flex-start` on the wrapping flex container to prevent layout shift when optional sub-fields appear.
- `select` placeholder state uses `color: #aaaaaa`, switching to `var(--text-primary)` once the user picks a value (via `onchange`).
- Label font-size `.92rem`; single-line labels get `margin-top: 0.45rem`, two-line (`<br>`-containing) labels get `margin-top: -0.1rem; line-height: 1.25`, to vertically align with the 2.1rem-tall input/select next to them.
- Global content max-width is `1120px` (`.content-area`, `.cycle-planner`, etc.).
- Forms include HIDE and SUBMIT action buttons placed appropriately.

### Reference/config JSON files

- `Eunpyeong_Myeloma_Center_Agents.json` — chemo agent catalog (class, name, abbreviation, dose options, dosing-day codes).
- `Eunpyeong_Myeloma_Center_Drug_Dosing.json` — dosing-day code → schedule text lookup.
- `Eunpyeong_Myeloma_Center_Regimens.json` — named regimen presets (agent + cycle composition) applied in bulk from the Chemotherapy page.

These are static data files consumed client-side via `fetch`; editing them changes dropdown/preset content across the app without any code change.
