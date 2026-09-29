"""
Database layer shared by local development and the Vercel deployment.

The backend is picked from the environment:
    - POSTGRES_URL (or DATABASE_URL) set  -> PostgreSQL via psycopg2 (Vercel, or a local
      run pointed at the hosted database, e.g. migrate_to_postgres.py)
    - otherwise                           -> the local SQLite file next to this module

Queries in app.py are written once, SQLite-style with `?` placeholders; connect() returns a
thin wrapper that rewrites them to psycopg2's `%s` when talking to Postgres. Rows come back
as mapping-like objects on both backends (sqlite3.Row / RealDictRow), so `row['col']` and
`dict(row)` work the same everywhere. Inserted ids are read with `RETURNING`, which SQLite
supports since 3.35.
"""

import os
import sqlite3

DATABASE_URL = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
IS_POSTGRES = bool(DATABASE_URL)

SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "Eunpyeong_Myeloma Center_Database.db")

CHEMO_LINE_FIELDS = [
    "line_number", "regimen", "custom_regimen",
    "date_first_response", "depth_first_response",
    "date_best_response", "depth_best_response",
    "disease_progression", "date_progression", "end_of_tx_date",
    "cessation_reason", "custom_cessation_reason",
    "progression_type", "toxicity_specify", "toxicity_grade"
]

# Patient columns the /api/patients endpoints read and write.
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


class Connection:
    """Wraps a sqlite3 / psycopg2 connection so app code can use one SQL dialect."""

    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
        if IS_POSTGRES:
            sql = sql.replace("?", "%s")
        cursor = self.raw.cursor()
        cursor.execute(sql, params)
        return cursor

    def commit(self):
        self.raw.commit()

    def close(self):
        self.raw.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def connect():
    if IS_POSTGRES:
        import psycopg2
        import psycopg2.extras
        raw = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        raw = sqlite3.connect(SQLITE_PATH)
        raw.row_factory = sqlite3.Row
    return Connection(raw)


def init_db():
    # Only the auto-increment primary key differs between the two dialects.
    pk = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    patient_columns = ",\n        ".join(f'"{f}" TEXT' for f in PATIENT_FIELDS if f != "upn")
    statements = [
        f'''
        CREATE TABLE IF NOT EXISTS chemo_lines (
            line_id {pk},
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
        )''',
        f'''
        CREATE TABLE IF NOT EXISTS chemo_cycles (
            cycle_id {pk},
            line_id INTEGER REFERENCES chemo_lines(line_id),
            cycle_number TEXT,
            start_date TEXT,
            cycle_length_days INTEGER DEFAULT 28
        )''',
        f'''
        CREATE TABLE IF NOT EXISTS chemo_cycle_agents (
            cycle_agent_id {pk},
            cycle_id INTEGER REFERENCES chemo_cycles(cycle_id),
            agent_class TEXT,
            agent_name TEXT,
            dose TEXT,
            dosing_days TEXT,
            schedule_order INTEGER
        )''',
        f'''
        CREATE TABLE IF NOT EXISTS chemo_cycle_agent_day_overrides (
            override_id {pk},
            cycle_agent_id INTEGER REFERENCES chemo_cycle_agents(cycle_agent_id),
            origin_day INTEGER,
            is_deleted BOOLEAN DEFAULT FALSE,
            moved_to_day INTEGER,
            override_dose TEXT
        )''',
        # The local SQLite file already has this table (with extra legacy columns such as
        # diagnosis_date / heavy_chain / created_at that no route uses), so this only takes
        # effect on a fresh database.
        f'''
        CREATE TABLE IF NOT EXISTS eunpyeong_mm_patients (
            id {pk},
            upn VARCHAR(8) UNIQUE,
            vital_status INTEGER,
            "date_last_follow-up" DATE,
            {patient_columns}
        )''',
    ]
    with connect() as conn:
        for statement in statements:
            conn.execute(statement)
        conn.commit()
