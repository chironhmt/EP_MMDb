"""
Eunpyeong Myeloma Center Database API -- the single Flask app for every environment.

    Local:  Chemotherapy.bat -> `python app.py` (SQLite, port 5001)
    Vercel: api/index.py imports `app` from here (Postgres via POSTGRES_URL). vercel.json
            sends every request that isn't an existing file to this app, so /static/* is
            served by Vercel's CDN and pages + /api/* come here.

Pages are templates/*.html rendered through the PAGES routes below; styles.css, app.js and
the reference JSON files live in static/ and are served at /static/<file>.

Which database is used is decided in db.py from the environment, not here.
"""

import json
import os

from flask import Flask, request, jsonify, redirect, render_template, url_for
from werkzeug.exceptions import HTTPException

import db
from db import CHEMO_LINE_FIELDS, PATIENT_FIELDS

app = Flask(__name__)

# URL path -> template. Query strings (?upn=, &line_id=) are read by each page's own JS.
PAGES = {
    '/': 'Dashboard.html',
    '/add-new-patient': 'Add_New_Patient.html',
    '/edit-patient': 'Edit_Patient.html',
    '/baseline-characteristics': 'Baseline_Charateristics.html',
    '/chemotherapy': 'Chemotherapy.html',
    '/cd34-collection': 'CD34+_Collection.html',
    '/transplant': 'Transplant.html',
    '/gvhd': 'GVHD.html',
    '/radiotherapy': 'Radiotherapy.html',
    '/imaging': 'Imaging.html',
    '/engraftment': 'Engraftment.html',
}
LEGACY_PAGE_URLS = {template: path for path, template in PAGES.items()}


@app.context_processor
def _template_helpers():
    def static_url(filename):
        # Cache-busting URL for a file in static/: the ?v= changes whenever the file does,
        # so browsers never keep a stale styles.css / app.js after an edit.
        mtime = int(os.path.getmtime(os.path.join(app.static_folder, filename)))
        return url_for('static', filename=filename, v=mtime)
    return {'static_url': static_url}


def _page_view(template):
    return lambda: render_template(template)


for _path, _template in PAGES.items():
    app.add_url_rule(_path, endpoint=_template, view_func=_page_view(_template))


@app.route('/<legacy_name>.html')
def legacy_page(legacy_name):
    # Old bookmarks / links from before the pages moved into templates/ (e.g.
    # Edit_Patient.html?upn=...) -- send them to the new path, keeping the query string.
    path = LEGACY_PAGE_URLS.get(f'{legacy_name}.html')
    if not path:
        return jsonify({"error": "Page not found"}), 404
    query = request.query_string.decode()
    return redirect(f'{path}?{query}' if query else path, code=301)

_initialized = False


@app.before_request
def _ensure_initialized():
    # CREATE TABLE IF NOT EXISTS is idempotent, but only pay for it once per process
    # (once per warm function instance on Vercel).
    global _initialized
    if not _initialized:
        db.init_db()
        _initialized = True


@app.errorhandler(Exception)
def _handle_error(e):
    if isinstance(e, HTTPException):
        return e
    return jsonify({"error": f"Server error: {str(e)}"}), 500


def serialize_chemo_line(conn, line_row):
    line = dict(line_row)
    try:
        line['refractory_agents'] = json.loads(line.get('refractory_agents') or '{}')
    except (TypeError, ValueError):
        line['refractory_agents'] = {}

    cycles = []
    for cycle_row in conn.execute(
        'SELECT * FROM chemo_cycles WHERE line_id = ? ORDER BY cycle_id', (line['line_id'],)
    ).fetchall():
        cycle = dict(cycle_row)
        agents = []
        for agent_row in conn.execute(
            'SELECT * FROM chemo_cycle_agents WHERE cycle_id = ? ORDER BY schedule_order, cycle_agent_id',
            (cycle['cycle_id'],)
        ).fetchall():
            agent = dict(agent_row)
            agent['day_overrides'] = [dict(r) for r in conn.execute(
                'SELECT * FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = ? ORDER BY origin_day',
                (agent['cycle_agent_id'],)
            ).fetchall()]
            agents.append(agent)
        cycle['agents'] = agents
        cycles.append(cycle)
    line['cycles'] = cycles
    return line


def write_chemo_cycles(conn, line_id, cycles):
    old_cycle_ids = [row['cycle_id'] for row in conn.execute(
        'SELECT cycle_id FROM chemo_cycles WHERE line_id = ?', (line_id,)
    ).fetchall()]
    for cycle_id in old_cycle_ids:
        old_agent_ids = [row['cycle_agent_id'] for row in conn.execute(
            'SELECT cycle_agent_id FROM chemo_cycle_agents WHERE cycle_id = ?', (cycle_id,)
        ).fetchall()]
        for agent_id in old_agent_ids:
            conn.execute('DELETE FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = ?', (agent_id,))
        conn.execute('DELETE FROM chemo_cycle_agents WHERE cycle_id = ?', (cycle_id,))
    conn.execute('DELETE FROM chemo_cycles WHERE line_id = ?', (line_id,))

    for cycle in cycles or []:
        cycle_id = conn.execute(
            'INSERT INTO chemo_cycles (line_id, cycle_number, start_date, cycle_length_days) '
            'VALUES (?, ?, ?, ?) RETURNING cycle_id',
            (line_id, cycle.get('cycle_number'), cycle.get('start_date'), cycle.get('cycle_length_days'))
        ).fetchone()['cycle_id']
        for order, agent in enumerate(cycle.get('agents') or [], start=1):
            cycle_agent_id = conn.execute(
                '''INSERT INTO chemo_cycle_agents
                   (cycle_id, agent_class, agent_name, dose, dosing_days, schedule_order)
                   VALUES (?, ?, ?, ?, ?, ?) RETURNING cycle_agent_id''',
                (cycle_id, agent.get('agent_class'), agent.get('agent_name'),
                 agent.get('dose'), agent.get('dosing_days'), agent.get('schedule_order', order))
            ).fetchone()['cycle_agent_id']
            for override in agent.get('day_overrides') or []:
                conn.execute(
                    '''INSERT INTO chemo_cycle_agent_day_overrides
                       (cycle_agent_id, origin_day, is_deleted, moved_to_day, override_dose)
                       VALUES (?, ?, ?, ?, ?)''',
                    (cycle_agent_id, override.get('origin_day'),
                     bool(override.get('is_deleted')),
                     override.get('moved_to_day'), override.get('override_dose'))
                )


@app.route('/api/chemo/patient/<upn>/lines', methods=['GET'])
def list_chemo_lines(upn):
    with db.connect() as conn:
        rows = conn.execute(
            'SELECT line_id, line_number, regimen, custom_regimen FROM chemo_lines '
            'WHERE upn = ? ORDER BY line_id',
            (upn,)
        ).fetchall()
        return jsonify([dict(r) for r in rows]), 200


@app.route('/api/chemo/patient/<upn>/lines', methods=['POST'])
def create_chemo_line(upn):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400
    with db.connect() as conn:
        values = [data.get(f) for f in CHEMO_LINE_FIELDS]
        columns = ", ".join(CHEMO_LINE_FIELDS + ["upn", "refractory_agents"])
        placeholders = ", ".join(["?"] * (len(CHEMO_LINE_FIELDS) + 2))
        line_id = conn.execute(
            f'INSERT INTO chemo_lines ({columns}) VALUES ({placeholders}) RETURNING line_id',
            values + [upn, json.dumps(data.get('refractory_agents') or {})]
        ).fetchone()['line_id']
        write_chemo_cycles(conn, line_id, data.get('cycles'))
        conn.commit()
        return jsonify({"line_id": line_id}), 201


@app.route('/api/chemo/lines/<int:line_id>', methods=['GET'])
def get_chemo_line(line_id):
    with db.connect() as conn:
        row = conn.execute('SELECT * FROM chemo_lines WHERE line_id = ?', (line_id,)).fetchone()
        if not row:
            return jsonify({"error": "Chemo line not found"}), 404
        return jsonify(serialize_chemo_line(conn, row)), 200


@app.route('/api/chemo/lines/<int:line_id>', methods=['PUT'])
def update_chemo_line(line_id):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400
    with db.connect() as conn:
        if not conn.execute('SELECT line_id FROM chemo_lines WHERE line_id = ?', (line_id,)).fetchone():
            return jsonify({"error": "Chemo line not found"}), 404
        values = [data.get(f) for f in CHEMO_LINE_FIELDS]
        set_clause = ", ".join([f'{f} = ?' for f in CHEMO_LINE_FIELDS] + ["refractory_agents = ?"])
        conn.execute(
            f'UPDATE chemo_lines SET {set_clause} WHERE line_id = ?',
            values + [json.dumps(data.get('refractory_agents') or {}), line_id]
        )
        write_chemo_cycles(conn, line_id, data.get('cycles'))
        conn.commit()
        return jsonify({"message": "Chemo line updated successfully"}), 200


@app.route('/api/patients', methods=['POST'])
def add_patient():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400
    values = [data.get(field, "") for field in PATIENT_FIELDS]
    placeholders = ", ".join(["?"] * len(PATIENT_FIELDS))
    columns = ", ".join([f'"{f}"' for f in PATIENT_FIELDS])
    with db.connect() as conn:
        conn.execute(f"INSERT INTO eunpyeong_mm_patients ({columns}) VALUES ({placeholders})", values)
        conn.commit()
    return jsonify({"message": "Patient added successfully"}), 201


@app.route('/api/patients/<upn>', methods=['PUT'])
def update_patient(upn):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400
    values = [data.get(field, "") for field in PATIENT_FIELDS] + [upn]
    set_clause = ", ".join([f'"{f}" = ?' for f in PATIENT_FIELDS])
    with db.connect() as conn:
        cursor = conn.execute(f"UPDATE eunpyeong_mm_patients SET {set_clause} WHERE upn = ?", values)
        if cursor.rowcount == 0:
            return jsonify({"error": "Patient not found"}), 404
        conn.commit()
    return jsonify({"message": "Patient updated successfully"}), 200


@app.route('/api/patients/<upn>', methods=['GET'])
def get_patient(upn):
    with db.connect() as conn:
        row = conn.execute('SELECT * FROM eunpyeong_mm_patients WHERE upn = ?', (upn,)).fetchone()
    if not row:
        return jsonify({"error": "Patient not found"}), 404
    return jsonify(dict(row)), 200


@app.route('/api/patients', methods=['GET'])
def get_patients():
    with db.connect() as conn:
        rows = conn.execute('SELECT * FROM eunpyeong_mm_patients').fetchall()
    patients = []
    for row in rows:
        p = dict(row)
        # Map vital_status to string: 0 -> Alive, 1 -> Deceased
        p['vital_status'] = 'Deceased' if p.get('vital_status') == 1 else 'Alive'
        # Map database column 'date_last_follow-up' to 'last_followup_date' for frontend.
        # Postgres returns a DATE column as datetime.date; SQLite returns the stored text.
        date_val = p.pop('date_last_follow-up', '') or ''
        p['last_followup_date'] = date_val.isoformat() if hasattr(date_val, 'isoformat') else date_val
        patients.append(p)
    return jsonify(patients), 200


if __name__ == '__main__':
    print("Starting Eunpyeong Myeloma Center Database API Server on port 5001...")
    print("Note: Port 5001 is used because Port 5000 is often reserved by AirPlay Receiver on macOS.")

    # Open the Chemotherapy page in the default web browser via localhost
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        import webbrowser
        webbrowser.open("http://127.0.0.1:5001/chemotherapy")

    app.run(debug=True, port=5001)
