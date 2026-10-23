"""
PostgreSQL database layer, shared by local development and the Vercel deployment.

The connection string comes from POSTGRES_URL (or DATABASE_URL); there is no fallback
database, so the app refuses to start a request without one. Rows come back as
RealDictRow, so `row['col']` and `dict(row)` both work. Inserted ids are read with
`RETURNING`.
"""

import os

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")

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
    """Wraps a psycopg2 connection with a connection-level `execute` that returns the cursor,
    and closes it on `with` exit (psycopg2's own context manager only ends the transaction)."""

    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
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
    if not DATABASE_URL:
        raise RuntimeError("POSTGRES_URL (or DATABASE_URL) is not set; the app needs a PostgreSQL connection string.")
    raw = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return Connection(raw)


def init_db():
    patient_columns = ",\n        ".join(f'"{f}" TEXT' for f in PATIENT_FIELDS if f != "upn")
    statements = [
        '''
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
        )''',
        '''
        CREATE TABLE IF NOT EXISTS chemo_cycles (
            cycle_id SERIAL PRIMARY KEY,
            line_id INTEGER REFERENCES chemo_lines(line_id),
            cycle_number TEXT,
            start_date TEXT,
            cycle_length_days INTEGER DEFAULT 28
        )''',
        '''
        CREATE TABLE IF NOT EXISTS chemo_cycle_agents (
            cycle_agent_id SERIAL PRIMARY KEY,
            cycle_id INTEGER REFERENCES chemo_cycles(cycle_id),
            agent_class TEXT,
            agent_name TEXT,
            dose TEXT,
            dosing_days TEXT,
            schedule_order INTEGER
        )''',
        '''
        CREATE TABLE IF NOT EXISTS chemo_cycle_agent_day_overrides (
            override_id SERIAL PRIMARY KEY,
            cycle_agent_id INTEGER REFERENCES chemo_cycle_agents(cycle_agent_id),
            origin_day INTEGER,
            is_deleted BOOLEAN DEFAULT FALSE,
            moved_to_day INTEGER,
            override_dose TEXT
        )''',
        f'''
        CREATE TABLE IF NOT EXISTS eunpyeong_mm_patients (
            id SERIAL PRIMARY KEY,
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
