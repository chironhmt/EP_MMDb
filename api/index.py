"""
Vercel serverless entry point for the Eunpyeong Myeloma Center Database API.

This is a Postgres-backed port of Eunpyeong_Myeloma_Center_Server.py, the SQLite/Flask
server used for local development (via Chemotherapy.bat). Vercel's Python functions are
stateless and have no writable/persistent local disk, so SQLite (a single on-disk file)
cannot be used there -- this file talks to a hosted Postgres database instead (e.g. Vercel
Postgres / Neon), configured entirely through the POSTGRES_URL / DATABASE_URL env var.

Deployed shape: vercel.json rewrites every /api/* request to this one function, and Flask's
own router dispatches to the matching route below exactly as it does locally. Static files
(Chemotherapy.html, app.js, styles.css, the reference JSON files, ...) are NOT served from
here -- Vercel serves everything at the project root directly as static assets, so the
serve_static()/index() routes from the local server are intentionally not ported.

Local development is unaffected: Eunpyeong_Myeloma_Center_Server.py + Chemotherapy.bat keep
using SQLite exactly as before. This file only runs on Vercel.
"""

import json
import os

import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DATABASE_URL = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")

CHEMO_LINE_FIELDS = [
    "line_number", "regimen", "custom_regimen",
    "date_first_response", "depth_first_response",
    "date_best_response", "depth_best_response",
    "disease_progression", "date_progression", "end_of_tx_date",
    "cessation_reason", "custom_cessation_reason",
    "progression_type", "toxicity_specify", "toxicity_grade"
]

# Same set of patient fields the local /api/patients endpoints read and write
# (Eunpyeong_Myeloma_Center_Server.py's `fields` list) -- kept in sync by hand since this is
# a separate deployment target rather than a shared import.
PATIENT_FIELDS = [
    "upn", "name", "date_birth", "sex", "date_dx",
    "chain_heavy", "chain_light", "hg_dx", "b2mg_dx",
    "bun_dx", "cr_dx", "tp_dx", "alb_dx", "osetlytic_dx",
    "height_dx", "bwt_dx", "dp_dx", "hyperca_dx", "renal_dx", "anemia_dx",
    "paraskeletal_dx", "emd_dx", "tb_dx", "ast_dx", "alt_dx",
    "ca_dx", "ldh_dx", "ig_g_dx", "ig_a_dx", "ig_m_dx", "ig_d_dx", "ig_e_dx",
    "kappa_dx", "lambda_dx", "serum_m_dx", "urine_m_dx",
    "hbsag_dx", "hbsab_dx", "hbcab_dx", "anti_hcv_dx", "hiv_dx",
    "cellularity_dx", "plasma-cell_dx", "cytogenetics_dx",
    "IGH:FGFR3_dx", "IGH:CCND1_dx", "IGH:MAF_dx", "IGH:MAFB_dx",
    "TP53_dx", "CKS1B_dx", "RB1_dx", "CDKN2C_dx",
    "stage_ds", "stage_iss", "stage_r-iss", "stage-r2-iss"
]


def get_db():
    if not DATABASE_URL:
        raise RuntimeError(
            "POSTGRES_URL (or DATABASE_URL) is not set. Provision a Postgres database "
            "(e.g. Vercel Postgres) and add its connection string as an env var on this project."
        )
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_lines (
        line_id SERIAL PRIMARY KEY,
        upn TEXT,
        line_number TEXT,
        regimen TEXT,
        custom_regimen TEXT,
        date_first_response TEXT,
        depth_first_response TEXT DEFAULT 'SD',
        date_best_response TEXT,
        depth_best_response TEXT DEFAULT 'SD',
        disease_progression TEXT DEFAULT 'No',
        date_progression TEXT,
        end_of_tx_date TEXT,
        cessation_reason TEXT DEFAULT 'Completed',
        custom_cessation_reason TEXT,
        progression_type TEXT,
        toxicity_specify TEXT,
        toxicity_grade TEXT,
        refractory_agents TEXT
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_cycles (
        cycle_id SERIAL PRIMARY KEY,
        line_id INTEGER REFERENCES chemo_lines(line_id),
        cycle_number TEXT,
        start_date TEXT,
        cycle_length_days INTEGER DEFAULT 28
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_cycle_agents (
        cycle_agent_id SERIAL PRIMARY KEY,
        cycle_id INTEGER REFERENCES chemo_cycles(cycle_id),
        agent_class TEXT,
        agent_name TEXT,
        dose TEXT,
        dosing_days TEXT,
        schedule_order INTEGER
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_cycle_agent_day_overrides (
        override_id SERIAL PRIMARY KEY,
        cycle_agent_id INTEGER REFERENCES chemo_cycle_agents(cycle_agent_id),
        origin_day INTEGER,
        is_deleted BOOLEAN DEFAULT FALSE,
        moved_to_day INTEGER,
        override_dose TEXT
    )
    ''')
    # Fresh schema for the fields the API actually reads/writes -- deliberately drops the
    # unused legacy duplicate columns (diagnosis_date, heavy_chain, light_chain,
    # hg_diagnosis, b2microglobulin_diagnosis, osteolytic_diagnosis, age_diagnosis,
    # created_at, updated_at) that the local SQLite table still carries from an earlier
    # schema iteration but that no route in either server ever reads or writes.
    patient_columns = ",\n        ".join(f'"{f}" TEXT' for f in PATIENT_FIELDS if f != "upn")
    cursor.execute(f'''
    CREATE TABLE IF NOT EXISTS eunpyeong_mm_patients (
        id SERIAL PRIMARY KEY,
        upn VARCHAR(8) UNIQUE,
        vital_status INTEGER,
        "date_last_follow-up" DATE,
        {patient_columns}
    )
    ''')
    conn.commit()
    cursor.close()
    conn.close()


_initialized = False


def ensure_initialized():
    # CREATE TABLE IF NOT EXISTS is idempotent, but only pay for it once per warm function
    # instance rather than on every invocation.
    global _initialized
    if not _initialized:
        init_db()
        _initialized = True


def serialize_chemo_line(conn, line):
    line = dict(line)
    try:
        line['refractory_agents'] = json.loads(line.get('refractory_agents') or '{}')
    except (TypeError, ValueError):
        line['refractory_agents'] = {}

    cursor = conn.cursor()
    cursor.execute('SELECT * FROM chemo_cycles WHERE line_id = %s ORDER BY cycle_id', (line['line_id'],))
    cycles = []
    for cycle_row in cursor.fetchall():
        cycle = dict(cycle_row)
        agent_cursor = conn.cursor()
        agent_cursor.execute(
            'SELECT * FROM chemo_cycle_agents WHERE cycle_id = %s ORDER BY schedule_order, cycle_agent_id',
            (cycle['cycle_id'],)
        )
        agents = []
        for agent_row in agent_cursor.fetchall():
            agent = dict(agent_row)
            override_cursor = conn.cursor()
            override_cursor.execute(
                'SELECT * FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = %s ORDER BY origin_day',
                (agent['cycle_agent_id'],)
            )
            agent['day_overrides'] = [dict(r) for r in override_cursor.fetchall()]
            agents.append(agent)
        cycle['agents'] = agents
        cycles.append(cycle)
    line['cycles'] = cycles
    return line


def write_chemo_cycles(conn, line_id, cycles):
    cursor = conn.cursor()
    cursor.execute('SELECT cycle_id FROM chemo_cycles WHERE line_id = %s', (line_id,))
    old_cycle_ids = [row['cycle_id'] for row in cursor.fetchall()]
    for cycle_id in old_cycle_ids:
        cursor.execute('SELECT cycle_agent_id FROM chemo_cycle_agents WHERE cycle_id = %s', (cycle_id,))
        old_agent_ids = [row['cycle_agent_id'] for row in cursor.fetchall()]
        for agent_id in old_agent_ids:
            cursor.execute('DELETE FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = %s', (agent_id,))
        cursor.execute('DELETE FROM chemo_cycle_agents WHERE cycle_id = %s', (cycle_id,))
    cursor.execute('DELETE FROM chemo_cycles WHERE line_id = %s', (line_id,))

    for cycle in cycles or []:
        cursor.execute(
            'INSERT INTO chemo_cycles (line_id, cycle_number, start_date, cycle_length_days) '
            'VALUES (%s, %s, %s, %s) RETURNING cycle_id',
            (line_id, cycle.get('cycle_number'), cycle.get('start_date'), cycle.get('cycle_length_days'))
        )
        cycle_id = cursor.fetchone()['cycle_id']
        for order, agent in enumerate(cycle.get('agents') or [], start=1):
            cursor.execute(
                '''INSERT INTO chemo_cycle_agents
                   (cycle_id, agent_class, agent_name, dose, dosing_days, schedule_order)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING cycle_agent_id''',
                (cycle_id, agent.get('agent_class'), agent.get('agent_name'),
                 agent.get('dose'), agent.get('dosing_days'), agent.get('schedule_order', order))
            )
            cycle_agent_id = cursor.fetchone()['cycle_agent_id']
            for override in agent.get('day_overrides') or []:
                cursor.execute(
                    '''INSERT INTO chemo_cycle_agent_day_overrides
                       (cycle_agent_id, origin_day, is_deleted, moved_to_day, override_dose)
                       VALUES (%s, %s, %s, %s, %s)''',
                    (cycle_agent_id, override.get('origin_day'),
                     bool(override.get('is_deleted')),
                     override.get('moved_to_day'), override.get('override_dose'))
                )


@app.before_request
def _before_request():
    ensure_initialized()


@app.route('/api/chemo/patient/<upn>/lines', methods=['GET'])
def list_chemo_lines(upn):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT line_id, line_number, regimen, custom_regimen FROM chemo_lines '
            'WHERE upn = %s ORDER BY line_id',
            (upn,)
        )
        rows = [dict(r) for r in cursor.fetchall()]
        return jsonify(rows), 200
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@app.route('/api/chemo/patient/<upn>/lines', methods=['POST'])
def create_chemo_line(upn):
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    try:
        conn = get_db()
        cursor = conn.cursor()
        values = [data.get(f) for f in CHEMO_LINE_FIELDS]
        columns = ", ".join(CHEMO_LINE_FIELDS + ["upn", "refractory_agents"])
        placeholders = ", ".join(["%s"] * (len(CHEMO_LINE_FIELDS) + 2))
        cursor.execute(
            f'INSERT INTO chemo_lines ({columns}) VALUES ({placeholders}) RETURNING line_id',
            values + [upn, json.dumps(data.get('refractory_agents') or {})]
        )
        line_id = cursor.fetchone()['line_id']
        write_chemo_cycles(conn, line_id, data.get('cycles'))
        conn.commit()
        return jsonify({"line_id": line_id}), 201
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@app.route('/api/chemo/lines/<int:line_id>', methods=['GET'])
def get_chemo_line(line_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM chemo_lines WHERE line_id = %s', (line_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Chemo line not found"}), 404
        return jsonify(serialize_chemo_line(conn, row)), 200
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@app.route('/api/chemo/lines/<int:line_id>', methods=['PUT'])
def update_chemo_line(line_id):
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT line_id FROM chemo_lines WHERE line_id = %s', (line_id,))
        if not cursor.fetchone():
            return jsonify({"error": "Chemo line not found"}), 404
        values = [data.get(f) for f in CHEMO_LINE_FIELDS]
        set_clause = ", ".join([f'{f} = %s' for f in CHEMO_LINE_FIELDS] + ["refractory_agents = %s"])
        cursor.execute(
            f'UPDATE chemo_lines SET {set_clause} WHERE line_id = %s',
            values + [json.dumps(data.get('refractory_agents') or {}), line_id]
        )
        write_chemo_cycles(conn, line_id, data.get('cycles'))
        conn.commit()
        return jsonify({"message": "Chemo line updated successfully"}), 200
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@app.route('/api/patients', methods=['POST'])
def add_patient():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    values = [data.get(field, "") for field in PATIENT_FIELDS]
    placeholders = ", ".join(["%s"] * len(PATIENT_FIELDS))
    columns = ", ".join([f'"{f}"' for f in PATIENT_FIELDS])
    query = f"INSERT INTO eunpyeong_mm_patients ({columns}) VALUES ({placeholders})"

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(query, values)
        conn.commit()
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()

    return jsonify({"message": "Patient added successfully"}), 201


@app.route('/api/patients/<upn>', methods=['PUT'])
def update_patient(upn):
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    values = [data.get(field, "") for field in PATIENT_FIELDS]
    values.append(upn)
    set_clause = ", ".join([f'"{f}" = %s' for f in PATIENT_FIELDS])
    query = f"UPDATE eunpyeong_mm_patients SET {set_clause} WHERE upn = %s"

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(query, values)
        if cursor.rowcount == 0:
            return jsonify({"error": "Patient not found"}), 404
        conn.commit()
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()

    return jsonify({"message": "Patient updated successfully"}), 200


@app.route('/api/patients/<upn>', methods=['GET'])
def get_patient(upn):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM eunpyeong_mm_patients WHERE upn = %s', (upn,))
        row = cursor.fetchone()
        if row:
            return jsonify(dict(row)), 200
        else:
            return jsonify({"error": "Patient not found"}), 404
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()


@app.route('/api/patients', methods=['GET'])
def get_patients():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM eunpyeong_mm_patients')
        rows = cursor.fetchall()
        patients = []
        for row in rows:
            p = dict(row)
            # Map vital_status to string: 0 -> Alive, 1 -> Deceased
            p['vital_status'] = 'Deceased' if p.get('vital_status') == 1 else 'Alive'
            # Map database column 'date_last_follow-up' to 'last_followup_date' for frontend
            date_val = p.pop('date_last_follow-up', '') or ''
            p['last_followup_date'] = date_val.isoformat() if hasattr(date_val, 'isoformat') else date_val
            patients.append(p)
        return jsonify(patients), 200
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()
