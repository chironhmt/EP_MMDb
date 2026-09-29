from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import json
import os

app = Flask(__name__)
CORS(app)

DB_PATH = "Eunpyeong_Myeloma Center_Database.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Create chemo_lines table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_lines (
        line_id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    # Create chemo_cycles table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_cycles (
        cycle_id INTEGER PRIMARY KEY AUTOINCREMENT,
        line_id INTEGER,
        cycle_number TEXT,
        start_date TEXT,
        cycle_length_days INTEGER DEFAULT 28,
        FOREIGN KEY (line_id) REFERENCES chemo_lines(line_id)
    )
    ''')

    # Create chemo_cycle_agents table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_cycle_agents (
        cycle_agent_id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_id INTEGER,
        agent_class TEXT,
        agent_name TEXT,
        dose TEXT,
        dosing_days TEXT,
        schedule_order INTEGER,
        FOREIGN KEY (cycle_id) REFERENCES chemo_cycles(cycle_id)
    )
    ''')

    # Create chemo_cycle_agent_day_overrides table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chemo_cycle_agent_day_overrides (
        override_id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_agent_id INTEGER,
        origin_day INTEGER,
        is_deleted BOOLEAN DEFAULT 0,
        moved_to_day INTEGER,
        override_dose TEXT,
        FOREIGN KEY (cycle_agent_id) REFERENCES chemo_cycle_agents(cycle_agent_id)
    )
    ''')
    conn.commit()
    conn.close()

init_db()

CHEMO_LINE_FIELDS = [
    "line_number", "regimen", "custom_regimen",
    "date_first_response", "depth_first_response",
    "date_best_response", "depth_best_response",
    "disease_progression", "date_progression", "end_of_tx_date",
    "cessation_reason", "custom_cessation_reason",
    "progression_type", "toxicity_specify", "toxicity_grade"
]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def serialize_chemo_line(conn, line_row):
    line = dict(line_row)
    try:
        line['refractory_agents'] = json.loads(line.get('refractory_agents') or '{}')
    except (TypeError, ValueError):
        line['refractory_agents'] = {}

    cursor = conn.cursor()
    cursor.execute('SELECT * FROM chemo_cycles WHERE line_id = ? ORDER BY cycle_id', (line['line_id'],))
    cycles = []
    for cycle_row in cursor.fetchall():
        cycle = dict(cycle_row)
        agent_cursor = conn.cursor()
        agent_cursor.execute(
            'SELECT * FROM chemo_cycle_agents WHERE cycle_id = ? ORDER BY schedule_order, cycle_agent_id',
            (cycle['cycle_id'],)
        )
        agents = []
        for agent_row in agent_cursor.fetchall():
            agent = dict(agent_row)
            override_cursor = conn.cursor()
            override_cursor.execute(
                'SELECT * FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = ? ORDER BY origin_day',
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
    cursor.execute('SELECT cycle_id FROM chemo_cycles WHERE line_id = ?', (line_id,))
    old_cycle_ids = [row[0] for row in cursor.fetchall()]
    for cycle_id in old_cycle_ids:
        cursor.execute('SELECT cycle_agent_id FROM chemo_cycle_agents WHERE cycle_id = ?', (cycle_id,))
        old_agent_ids = [row[0] for row in cursor.fetchall()]
        for agent_id in old_agent_ids:
            cursor.execute('DELETE FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = ?', (agent_id,))
        cursor.execute('DELETE FROM chemo_cycle_agents WHERE cycle_id = ?', (cycle_id,))
    cursor.execute('DELETE FROM chemo_cycles WHERE line_id = ?', (line_id,))

    for cycle in cycles or []:
        cursor.execute(
            'INSERT INTO chemo_cycles (line_id, cycle_number, start_date, cycle_length_days) VALUES (?, ?, ?, ?)',
            (line_id, cycle.get('cycle_number'), cycle.get('start_date'), cycle.get('cycle_length_days'))
        )
        cycle_id = cursor.lastrowid
        for order, agent in enumerate(cycle.get('agents') or [], start=1):
            cursor.execute(
                '''INSERT INTO chemo_cycle_agents
                   (cycle_id, agent_class, agent_name, dose, dosing_days, schedule_order)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (cycle_id, agent.get('agent_class'), agent.get('agent_name'),
                 agent.get('dose'), agent.get('dosing_days'), agent.get('schedule_order', order))
            )
            cycle_agent_id = cursor.lastrowid
            for override in agent.get('day_overrides') or []:
                cursor.execute(
                    '''INSERT INTO chemo_cycle_agent_day_overrides
                       (cycle_agent_id, origin_day, is_deleted, moved_to_day, override_dose)
                       VALUES (?, ?, ?, ?, ?)''',
                    (cycle_agent_id, override.get('origin_day'),
                     1 if override.get('is_deleted') else 0,
                     override.get('moved_to_day'), override.get('override_dose'))
                )


@app.route('/api/chemo/patient/<upn>/lines', methods=['GET'])
def list_chemo_lines(upn):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT line_id, line_number, regimen, custom_regimen FROM chemo_lines WHERE upn = ? ORDER BY line_id',
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
        placeholders = ", ".join(["?"] * (len(CHEMO_LINE_FIELDS) + 2))
        cursor.execute(
            f'INSERT INTO chemo_lines ({columns}) VALUES ({placeholders})',
            values + [upn, json.dumps(data.get('refractory_agents') or {})]
        )
        line_id = cursor.lastrowid
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
        cursor.execute('SELECT * FROM chemo_lines WHERE line_id = ?', (line_id,))
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
        cursor.execute('SELECT line_id FROM chemo_lines WHERE line_id = ?', (line_id,))
        if not cursor.fetchone():
            return jsonify({"error": "Chemo line not found"}), 404
        values = [data.get(f) for f in CHEMO_LINE_FIELDS]
        set_clause = ", ".join([f'{f} = ?' for f in CHEMO_LINE_FIELDS] + ["refractory_agents = ?"])
        cursor.execute(
            f'UPDATE chemo_lines SET {set_clause} WHERE line_id = ?',
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

    # Extract fields based on mapping
    fields = [
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

    values = [data.get(field, "") for field in fields]

    placeholders = ", ".join(["?"] * len(fields))
    columns = ", ".join([f'"{f}"' for f in fields])

    query = f"INSERT INTO eunpyeong_mm_patients ({columns}) VALUES ({placeholders})"

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(query, values)
        conn.commit()
    except sqlite3.OperationalError as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500
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

    fields = [
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

    values = [data.get(field, "") for field in fields]
    values.append(upn)

    set_clause = ", ".join([f'"{f}" = ?' for f in fields])
    query = f"UPDATE eunpyeong_mm_patients SET {set_clause} WHERE upn = ?"

    try:
        conn = sqlite3.connect(DB_PATH)
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
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM eunpyeong_mm_patients WHERE upn = ?', (upn,))
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
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM eunpyeong_mm_patients')
        rows = cursor.fetchall()
        patients = []
        for row in rows:
            p = dict(row)
            # Map vital_status to string: 0 -> Alive, 1 -> Deceased
            p['vital_status'] = 'Deceased' if p.get('vital_status') == 1 else 'Alive'
            # Map database column 'date_last_follow-up' to 'last_followup_date' for frontend
            p['last_followup_date'] = p.pop('date_last_follow-up', '') or ''
            patients.append(p)
        return jsonify(patients), 200
    except Exception as e:
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        if 'conn' in locals():
            conn.close()

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)

@app.route('/')
def index():
    return send_from_directory('.', 'Chemotherapy.html')

if __name__ == '__main__':
    print("Starting Eunpyeong Myeloma Center Database API Server on port 5001...")
    print("Note: Port 5001 is used because Port 5000 is often reserved by AirPlay Receiver on macOS.")
    
    # Open Chemotherapy.html in the default web browser via localhost
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        import webbrowser
        webbrowser.open("http://127.0.0.1:5001/Chemotherapy.html")

    app.run(debug=True, port=5001)

