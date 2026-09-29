# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HemaCDS 2.0 is a clinical data management tool for the Multiple Myeloma Center at Eunpyeong St. Mary's Hospital. It is a set of HTML/CSS/JS pages, one per clinical domain, served by a small Flask app that also provides the API (SQLite locally, Postgres on Vercel). There is no build step, no package manager, no bundler, and no automated test suite.

## Running the app

Start the server (installs `flask` and launches the app, opening `/chemotherapy` in the browser):

```
Chemotherapy.bat
```

This runs `python app.py`, which serves on `http://127.0.0.1:5001`. **Pages must be loaded through this server, not opened directly via `file://`** — they reference assets and the API by absolute path (`/static/...`, `/api/...`), and `app.js` fetches the reference JSON files, none of which works under `file://`.

Project layout:
- `templates/` — one HTML file per page, rendered by Flask (`render_template`). They are currently plain HTML with no Jinja syntax; don't introduce `{{`/`{%`/`{#` in inline JS by accident.
- `static/` — `styles.css`, `app.js` and the three reference JSON files, served at `/static/<file>`. Reference them by absolute path (`/static/styles.css`), since pages live at paths like `/edit-patient`.
- `app.py` — page routes (`PAGES` dict: URL path → template) and the `/api/...` routes. `db.py` — database connection/schema.

Page URLs: `/` (Dashboard), `/add-new-patient`, `/edit-patient?upn=<id>`, `/baseline-characteristics`, `/chemotherapy?upn=<id>`, `/cd34-collection`, `/transplant`, `/gvhd`, `/radiotherapy`, `/imaging`, `/engraftment`. The old file names (`/Dashboard.html`, `/Edit_Patient.html?upn=...`, ...) 301-redirect to these, keeping the query string. Links between pages use these paths, not `.html` file names; a new page needs a `PAGES` entry in `app.py`. Only files under `static/` are served — project-root files (`app.py`, the `.db`, ...) are not reachable over HTTP.

There is no linter, formatter, or test runner configured for this repo.

### Deploying to Vercel

The frontend (static HTML/CSS/JS/JSON) can be deployed to Vercel as-is — Vercel serves everything at the project root directly. The backend is a single Flask app (`app.py`) used in both places; only the database differs. Vercel's Python functions are stateless serverless invocations with no persistent/writable disk, so a single on-disk SQLite file doesn't survive between requests — there the app talks to Postgres instead. `db.py` makes that choice from the environment: Postgres when `POSTGRES_URL`/`DATABASE_URL` is set, otherwise the local SQLite file. Routes in `app.py` write SQL once, SQLite-style (`?` placeholders, `RETURNING` for inserted ids); `db.Connection.execute` rewrites placeholders to `%s` for psycopg2. Keep new SQL portable across both dialects, and put schema changes in `db.init_db()`. `api/index.py` is only a shim that imports `app` for Vercel.

The local SQLite `eunpyeong_mm_patients` table predates `db.init_db()` and carries extra legacy columns (`diagnosis_date`, `heavy_chain`, `created_at`, ...) that no route reads or writes; `init_db()`'s `CREATE TABLE IF NOT EXISTS` leaves it as-is, so a fresh database (e.g. Postgres) gets the narrower column set. `psycopg2` is imported lazily, so local runs only need `flask`.

To deploy:
1. Provision a Postgres database (e.g. Vercel Postgres from the project's Storage tab) and set its connection string as the `POSTGRES_URL` (or `DATABASE_URL`) env var on the Vercel project. The app creates its tables automatically on first request (`db.init_db()`).
2. To bring over existing local data, set the same env var locally and run `python migrate_to_postgres.py` (see that file's docstring) — a one-off script, not invoked automatically by anything.
3. `vercel.json` rewrites every request to `api/index.py` (which imports `app.py`'s Flask app, so Flask does the routing from there). Vercel checks the filesystem before applying rewrites, so existing files such as `/static/styles.css` are served directly by its CDN; page paths and `/api/*` fall through to Flask.
4. Pages and API are always same-origin, so the frontend calls `/api/...` directly — no API base URL or CORS setup.

This is a clinical database handling real patient data — hosting it on a public cloud platform has security/compliance implications (access control, encryption, data residency) beyond what this repo enforces on its own; that's a decision for whoever owns the deployment, not something to default into.

## Architecture

### Page-per-domain frontend

Each clinical workflow is an independent, self-contained HTML file in `templates/` (inline or page-specific `<script>`, sharing `static/styles.css`):

- `Add_New_Patient.html` / `Edit_Patient.html` — patient demographics & diagnosis intake, talk to the Flask API (`/api/patients`).
- `Baseline_Charateristics.html`, `Chemotherapy.html` (+ `static/app.js`), `CD34+_Collection.html`, `Transplant.html`, `GVHD.html`, `Radiotherapy.html`, `Imaging.html`, `Engraftment.html` — per-domain clinical forms.
- `Dashboard.html` — patient list/overview, reads from the Flask API.

Pages navigate each other via plain `window.location.href` (e.g. Dashboard → `/add-new-patient`, `/edit-patient?upn=<id>`), not client-side routing.

### Data persistence is split and inconsistent — check before assuming

- **Patients** (`Add_New_Patient.html`, `Edit_Patient.html`, `Dashboard.html`) persist through the Flask API into SQLite (Postgres on Vercel).
- **Chemotherapy** (`Chemotherapy.html` + `app.js`) persists through the Flask API into the `chemo_lines` / `chemo_cycles` / `chemo_cycle_agents` / `chemo_cycle_agent_day_overrides` tables. One page load edits exactly one treatment line; the page is opened as `/chemotherapy?upn=<UPN>` (Dashboard's "CHEMOTHERAPY" button in the Treatment History section) and appends `&line_id=<id>` after the first save. On load it resumes the patient's most recent saved line, or starts blank if there is none. Any SUBMIT button saves the whole line — the line-level fields, every cycle, every agent schedule, and every calendar day-override — as a single POST/PUT; the server replaces that line's cycle tree wholesale rather than diffing it.
- **Other domains** (e.g. `Transplant.html`) currently persist via `localStorage` (e.g. key `hemaCDS_transplant_data`) rather than the API, and some pages don't persist at all yet.
- `Eunpyeong_Myeloma_Center_Database_Schema.md` documents the full *intended* relational schema (patients, chemo_lines/cycles/agents, cd34_collections, transplant_records, gvhd_assessments, radiotherapy_records, imaging_studies) with an ERD and DDL. **This describes the target design, not necessarily what `app.py` actually implements** — the live server wires up `/api/patients` (GET/POST/PUT) against a table called `eunpyeong_mm_patients` (using a narrower/older field list than the schema doc's `patients` table) plus the `/api/chemo/...` endpoints above; the CD34, transplant, GVHD, radiotherapy and imaging tables in the schema doc have no endpoints and no tables yet. Always verify against `app.py` / `db.py` directly rather than trusting the schema doc when working on backend/API code.
- The DB file itself has a space in its name: `Eunpyeong_Myeloma Center_Database.db` (note: no underscore between "Myeloma" and "Center").

### Chemotherapy cycle planner (`static/app.js`)

Drives `Chemotherapy.html`'s cycle-builder UI. On load it fetches three reference JSON files and builds in-memory lookup structures:

- `Eunpyeong_Myeloma_Center_Agents.json` → grouped by `Class` into `groupedAgents` (drug class → agent list, each with dose/dosing-day info).
- `Eunpyeong_Myeloma_Center_Drug_Dosing.json` → `dosingDaysMap` (dosing code → human-readable schedule).
- `Eunpyeong_Myeloma_Center_Regimens.json` → `regimensData`, used to populate the regimen dropdown and to bulk-apply a preset regimen's agents/cycles (destructive — prompts for confirmation since it replaces current cycles).

Cycles are held in an in-memory `cycles` array (`currentCycleId` tracks the active one), and `currentLineId` tracks the saved `chemo_lines` row the page is editing. `buildLinePayload()` flattens that in-memory state into the API's JSON shape and `applyLineData()`/`buildCycleFromRow()` rebuild it on load — the two are mirror images, so any new per-cycle or per-schedule field must be added to both or it will silently fail to persist. Note the asymmetry they handle: a dose/dosing-day value that isn't one of the agent's presets in `Eunpyeong_Myeloma_Center_Agents.json` is stored flat in the DB but must be split back into `dose: 'Others'` + `customDose` for the radio-button UI.

### UI design system — mandatory for any HTML/CSS work

`.agents/AGENTS.md` defines the design-consistency contract, using `templates/Chemotherapy.html` + `static/styles.css` as the reference implementation. Key rules to follow when creating or editing pages:

- Google Fonts `Outfit` (300–700); default text color `var(--text-primary)`.
- Use the CSS variables defined in `styles.css` (`--bg-dark`, `--bg-panel`, `--bg-glass`, `--accent-primary`, `--text-primary`, `--text-secondary`, `--radius-lg/md/sm`, `--shadow-glass`, `--shadow-glow`, etc.) — don't hardcode colors.
- Layout: `.app-container` (flex row/column) → `.sidebar` + `.app-main`; `.app-header` for the glassmorphic top bar (`backdrop-filter: blur(12px)`).
- Components: `.card`/`.card-header`/`.card-body` for sections; `.custom-text-input`/`.custom-date-format` for form fields; `.btn-secondary` for action buttons with inline SVG icons (`stroke="currentColor"`).
- Input/output rows default to 4 columns per row, with labels placed left of their input, `align-items: flex-start` on the wrapping flex container to prevent layout shift when optional sub-fields appear.
- `select` placeholder state uses `color: #aaaaaa`, switching to `var(--text-primary)` once the user picks a value (via `onchange`).
- Label font-size `.92rem`; single-line labels get `margin-top: 0.45rem`, two-line (`<br>`-containing) labels get `margin-top: -0.1rem; line-height: 1.25`, to vertically align with the 2.1rem-tall input/select next to them.
- Global content max-width is `1120px` (`.content-area`, `.cycle-planner`, etc.).
- Forms include HIDE and SUBMIT action buttons placed appropriately.

### Reference/config JSON files (`static/`)

- `Eunpyeong_Myeloma_Center_Agents.json` — chemo agent catalog (class, name, abbreviation, dose options, dosing-day codes).
- `Eunpyeong_Myeloma_Center_Drug_Dosing.json` — dosing-day code → schedule text lookup.
- `Eunpyeong_Myeloma_Center_Regimens.json` — named regimen presets (agent + cycle composition) applied in bulk from the Chemotherapy page.

These are static data files consumed client-side via `fetch`; editing them changes dropdown/preset content across the app without any code change.
