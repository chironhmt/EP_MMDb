# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HemaCDS 2.0 is a clinical data management tool for the Multiple Myeloma Center at Eunpyeong St. Mary's Hospital. It is a set of HTML/CSS/JS pages, one per clinical domain, served by a small Flask app that also provides the API, backed by PostgreSQL (locally and on Vercel). There is no build step, no package manager, no bundler, and no automated test suite.

## Running the app

Set `POSTGRES_URL` (or `DATABASE_URL`) to a PostgreSQL connection string, then start the server (installs `requirements.txt` — `flask`, `psycopg2-binary` — and launches the app, opening the Dashboard (`/`) in the browser):

```
EP_MMDb.bat
```

`EP_MMDb.bat` refuses to start when neither variable is set; there is no local fallback database. It runs `python app.py`, which serves on `http://127.0.0.1:5001`. **Pages must be loaded through this server, not opened directly via `file://`** — they reference assets and the API by absolute path (`/static/...`, `/api/...`), and `app.js` fetches the reference JSON files, none of which works under `file://`.

Project layout:
- `templates/` — one Jinja2 template per page, rendered by Flask (`render_template`). Every page `{% extends "base.html" %}`, which owns the `<!DOCTYPE>`/`<head>` boilerplate (meta tags, Google Fonts `Outfit`, `styles.css`) and exposes blocks `title`, `stylesheet` (Add/Edit Patient override it empty — they use their own inline stylesheet, not `styles.css`), `head` (page `<style>`) and `body`. `_macros.html` holds `app_header(back_link=True)`, the standard top bar ("Eunpyeong St. Mary's Myeloma Center Database" + "Back to Dashboard"); Add/Edit Patient and Baseline/Imaging keep their own, differently styled headers. Since templates are parsed by Jinja, a literal `{{`, `{%` or `{#` in inline JS/CSS must be wrapped in `{% raw %}…{% endraw %}`.
- `static/` — `styles.css`, `app.js` and the three reference JSON files, served at `/static/<file>`. In templates, reference them with `{{ static_url('styles.css') }}` — it appends a `?v=<file mtime>` cache-buster, so there's no version number to bump by hand. From JS (e.g. `app.js`'s `fetch`) use the absolute path `/static/...`, since pages live at paths like `/edit-patient`. `date-input.js` (loaded by Chemotherapy, Add/Edit Patient, Transplant, CD34+ Collection, GVHD and Imaging) turns every `<input type="date">` on the page — including ones rendered later — into a typeable `yyyy-mm-dd` text field with auto-hyphens, paste normalisation and a calendar-icon picker; `.value` stays `yyyy-mm-dd`, so page code is unchanged — but page JS must not look date fields up by `input[type="date"]` once it has run (Transplant's `initDateInputs()` also matches `input.date-text-input`). Engraftment and Radiotherapy still use the older `custom-date-format` overlay on native date inputs.
- `app.py` — page routes (`PAGES` dict: URL path → template) and the `/api/...` routes. `db.py` — PostgreSQL connection/schema.

Page URLs: `/` (Dashboard), `/add-new-patient`, `/edit-patient?upn=<id>`, `/baseline-characteristics`, `/chemotherapy?upn=<id>`, `/cd34-collection`, `/transplant`, `/gvhd`, `/radiotherapy`, `/imaging`, `/engraftment`. The old file names (`/Dashboard.html`, `/Edit_Patient.html?upn=...`, ...) 301-redirect to these, keeping the query string. Links between pages use these paths, not `.html` file names; a new page needs a template extending `base.html` and a `PAGES` entry in `app.py`. Only files under `static/` are served — project-root files (`app.py`, `db.py`, ...) are not reachable over HTTP.

There is no linter, formatter, or test runner configured for this repo.

### Deploying to Vercel

The frontend (static HTML/CSS/JS/JSON) can be deployed to Vercel as-is — Vercel serves everything at the project root directly. The backend is the same single Flask app (`app.py`) locally and on Vercel, and both talk to PostgreSQL through `db.py` using `POSTGRES_URL`/`DATABASE_URL`. Routes in `app.py` use psycopg2's `%s` placeholders and `RETURNING` for inserted ids; `db.Connection` is a thin psycopg2 wrapper whose `execute` returns the cursor and whose `with` block closes the connection. Put schema changes in `db.init_db()` — it only runs `CREATE TABLE IF NOT EXISTS`, so new columns on an existing table need a separate `ALTER TABLE`. `api/index.py` is only a shim that imports `app` for Vercel.

To deploy:
1. Provision a Postgres database (e.g. Vercel Postgres from the project's Storage tab) and set its connection string as the `POSTGRES_URL` (or `DATABASE_URL`) env var on the Vercel project. The app creates its tables automatically on first request (`db.init_db()`).
2. `vercel.json` rewrites every request to `api/index.py` (which imports `app.py`'s Flask app, so Flask does the routing from there). Vercel checks the filesystem before applying rewrites, so existing files such as `/static/styles.css` are served directly by its CDN; page paths and `/api/*` fall through to Flask.
3. Pages and API are always same-origin, so the frontend calls `/api/...` directly — no API base URL or CORS setup.

This is a clinical database handling real patient data — hosting it on a public cloud platform has security/compliance implications (access control, encryption, data residency) beyond what this repo enforces on its own; that's a decision for whoever owns the deployment, not something to default into.

## Architecture

### Page-per-domain frontend

Each clinical workflow is an independent page template in `templates/` (inline or page-specific `<script>`, sharing `base.html` and `static/styles.css`):

- `Add_New_Patient.html` / `Edit_Patient.html` — patient demographics & diagnosis intake, talk to the Flask API (`/api/patients`).
- `Baseline_Charateristics.html`, `Chemotherapy.html` (+ `static/app.js`), `CD34+_Collection.html`, `Transplant.html`, `GVHD.html`, `Radiotherapy.html`, `Imaging.html`, `Engraftment.html` — per-domain clinical forms.
- `Dashboard.html` — patient list/overview, reads from the Flask API.

Pages navigate each other via plain `window.location.href` (e.g. Dashboard → `/add-new-patient`, `/edit-patient?upn=<id>`), not client-side routing.

### Data persistence is split and inconsistent — check before assuming

- **Patients** (`Add_New_Patient.html`, `Edit_Patient.html`, `Dashboard.html`) persist through the Flask API into PostgreSQL.
- **Chemotherapy** (`Chemotherapy.html` + `app.js`) persists through the Flask API into the `chemo_lines` / `chemo_cycles` / `chemo_cycle_agents` / `chemo_cycle_agent_day_overrides` tables. One page load edits exactly one treatment line; the page is opened as `/chemotherapy?upn=<UPN>` (Dashboard's "CHEMOTHERAPY" button in the Treatment History section) and appends `&line_id=<id>` after the first save. On load it resumes the patient's most recent saved line, or starts blank if there is none. Any SUBMIT button saves the whole line — the line-level fields, every cycle, every agent schedule, and every calendar day-override — as a single POST/PUT; the server replaces that line's cycle tree wholesale rather than diffing it.
- **Other domains** (e.g. `Transplant.html`) currently persist via `localStorage` (e.g. key `hemaCDS_transplant_data`) rather than the API, and some pages don't persist at all yet.
- `Eunpyeong_Myeloma_Center_Database_Schema.md` documents the full *intended* relational schema (patients, chemo_lines/cycles/agents, cd34_collections, transplant_records, gvhd_assessments, radiotherapy_records, imaging_studies) with an ERD and DDL. **This describes the target design, not necessarily what `app.py` actually implements** — the live server wires up `/api/patients` (GET/POST/PUT) against a table called `eunpyeong_mm_patients` (using a narrower/older field list than the schema doc's `patients` table) plus the `/api/chemo/...` endpoints above; the CD34, transplant, GVHD, radiotherapy and imaging tables in the schema doc have no endpoints and no tables yet. Always verify against `app.py` / `db.py` directly rather than trusting the schema doc when working on backend/API code. `Eunpyeong_Myeloma_Center_Database_Schema_Current.md` documents the schema as currently implemented.

### Chemotherapy cycle planner (`static/app.js`)

Drives `Chemotherapy.html`'s cycle-builder UI. On load it fetches three reference JSON files and builds in-memory lookup structures:

- `Eunpyeong_Myeloma_Center_Chemo-agents.json` → grouped by `Class` into `groupedAgents` (drug class → agent list, each with dose/dosing-day info).
- `Eunpyeong_Myeloma_Center_Chemo-agents_Dosing.json` → `dosingDaysMap` (dosing code → human-readable schedule).
- `Eunpyeong_Myeloma_Center_Chemo-regimens.json` → `regimensData`, used to populate the regimen dropdown and to bulk-apply a preset regimen's agents/cycles (destructive — prompts for confirmation since it replaces current cycles).

Cycles are held in an in-memory `cycles` array (`currentCycleId` tracks the active one), and `currentLineId` tracks the saved `chemo_lines` row the page is editing. `buildLinePayload()` flattens that in-memory state into the API's JSON shape and `applyLineData()`/`buildCycleFromRow()` rebuild it on load — the two are mirror images, so any new per-cycle or per-schedule field must be added to both or it will silently fail to persist. Note the asymmetry they handle: a dose/dosing-day value that isn't one of the agent's presets in `Eunpyeong_Myeloma_Center_Chemo-agents.json` is stored flat in the DB but must be split back into `dose: 'Others'` + `customDose` for the radio-button UI.

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

- `Eunpyeong_Myeloma_Center_Chemo-agents.json` — chemo agent catalog (class, name, abbreviation, dose options, dosing-day codes).
- `Eunpyeong_Myeloma_Center_Chemo-agents_Dosing.json` — dosing-day code → schedule text lookup.
- `Eunpyeong_Myeloma_Center_Chemo-regimens.json` — named regimen presets (agent + cycle composition) applied in bulk from the Chemotherapy page.
- `Eunpyeong_Myeloma_Center_Conditioning-agents.json`, `..._Conditioning-agents_Dosing.json`, `..._Conditioning-regimens.json` — the same three-file shape for the Transplant page's "2. Conditioning Regimen" section (fetched by the inline script in `templates/Transplant.html`). Dosing codes are day ranges relative to D0 (e.g. `D-4~-3` → `D-4, -3`), and a regimen is a flat `Agents` list with no cycles.
- `Eunpyeong_Myeloma_Center_GVHD-agents.json`, `..._GVHD-agents_Dosing.json`, `..._GVHD-regimens.json` — agent catalog, dosing codes and regimen presets for the Transplant page's "3. GVHD Prophylaxis" section. Codes such as `D-1~` → `From D-1` and `D+1/3/6` → `D+1, +3, +6` are resolved to their schedule text on load, and that text is what the page stores. A regimen is a flat `Agents` list like the conditioning one (the same agent may appear more than once, one entry per dose/day schedule); the default is picked by donor type (Sibling → `CsA + MTX`, otherwise `FK506 + MTX`).

These are static data files consumed client-side via `fetch`; editing them changes dropdown/preset content across the app without any code change.
