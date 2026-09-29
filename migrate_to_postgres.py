"""
One-time migration: copy the local SQLite database into the Postgres database used by the
Vercel deployment.

This talks to a real, presumably remote Postgres instance and writes real patient records to
it -- run it deliberately, not as part of any automated workflow. It is NOT invoked by
Chemotherapy.bat or by Vercel itself.

Usage:
    1. Provision a Postgres database (e.g. Vercel Postgres from the Vercel dashboard) and
       copy its connection string.
    2. pip install psycopg2-binary  (already in requirements.txt, but this script can also
       run outside the project's normal environment)
    3. Set the connection string and run:

         set POSTGRES_URL=postgres://...   (PowerShell: $env:POSTGRES_URL = "postgres://...")
         python migrate_to_postgres.py

    On Vercel itself, the same variable (POSTGRES_URL, or DATABASE_URL) must be set as a
    Project -> Settings -> Environment Variables entry so the app can connect at runtime.

What it does:
    - Creates the Postgres schema (same tables app.py creates on first request, via db.init_db).
    - Copies every row from the local eunpyeong_mm_patients table, mapping only the columns
      the API actually reads/writes (see db.py's PATIENT_FIELDS) -- unused legacy
      columns in the local table (diagnosis_date, heavy_chain, created_at, ...) are skipped.
    - Copies chemo_lines / chemo_cycles / chemo_cycle_agents / chemo_cycle_agent_day_overrides
      if any exist locally, preserving the line/cycle/agent relationships (Postgres assigns
      new ids via SERIAL, so old ids are remapped, not reused).
    - Is safe to re-run against an EMPTY Postgres database, but does not de-duplicate --
      running it twice against a database that already has data will insert everything again.
"""

import os
import sqlite3

import psycopg2
import psycopg2.extras

from db import IS_POSTGRES, init_db, PATIENT_FIELDS

SQLITE_DB_PATH = "Eunpyeong_Myeloma Center_Database.db"


def get_postgres_conn():
    url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "Set POSTGRES_URL (or DATABASE_URL) to the target Postgres connection string before running this script."
        )
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)


def migrate_patients(sqlite_conn, pg_conn):
    sqlite_conn.row_factory = sqlite3.Row
    rows = sqlite_conn.execute("SELECT * FROM eunpyeong_mm_patients").fetchall()
    pg_cursor = pg_conn.cursor()
    count = 0
    for row in rows:
        row = dict(row)
        values = [row.get(f, "") or "" for f in PATIENT_FIELDS]
        placeholders = ", ".join(["%s"] * len(PATIENT_FIELDS))
        columns = ", ".join([f'"{f}"' for f in PATIENT_FIELDS])
        pg_cursor.execute(
            f'INSERT INTO eunpyeong_mm_patients ({columns}, vital_status, "date_last_follow-up") '
            f'VALUES ({placeholders}, %s, %s)',
            values + [row.get("vital_status"), row.get("date_last_follow-up")]
        )
        count += 1
    pg_conn.commit()
    print(f"Migrated {count} patient(s).")


def migrate_chemo(sqlite_conn, pg_conn):
    sqlite_conn.row_factory = sqlite3.Row
    lines = sqlite_conn.execute("SELECT * FROM chemo_lines ORDER BY line_id").fetchall()
    if not lines:
        print("No chemo lines to migrate.")
        return
    pg_cursor = pg_conn.cursor()
    line_field_names = [
        "upn", "line_number", "regimen", "custom_regimen",
        "date_first_response", "depth_first_response",
        "date_best_response", "depth_best_response",
        "disease_progression", "date_progression", "end_of_tx_date",
        "cessation_reason", "custom_cessation_reason",
        "progression_type", "toxicity_specify", "toxicity_grade", "refractory_agents"
    ]
    line_count = cycle_count = agent_count = override_count = 0
    for line in lines:
        line = dict(line)
        values = [line.get(f) for f in line_field_names]
        columns = ", ".join(line_field_names)
        placeholders = ", ".join(["%s"] * len(line_field_names))
        pg_cursor.execute(
            f'INSERT INTO chemo_lines ({columns}) VALUES ({placeholders}) RETURNING line_id',
            values
        )
        new_line_id = pg_cursor.fetchone()['line_id']
        line_count += 1

        cycles = sqlite_conn.execute(
            "SELECT * FROM chemo_cycles WHERE line_id = ? ORDER BY cycle_id", (line['line_id'],)
        ).fetchall()
        for cycle in cycles:
            cycle = dict(cycle)
            pg_cursor.execute(
                'INSERT INTO chemo_cycles (line_id, cycle_number, start_date, cycle_length_days) '
                'VALUES (%s, %s, %s, %s) RETURNING cycle_id',
                (new_line_id, cycle.get('cycle_number'), cycle.get('start_date'), cycle.get('cycle_length_days'))
            )
            new_cycle_id = pg_cursor.fetchone()['cycle_id']
            cycle_count += 1

            agents = sqlite_conn.execute(
                "SELECT * FROM chemo_cycle_agents WHERE cycle_id = ? ORDER BY schedule_order, cycle_agent_id",
                (cycle['cycle_id'],)
            ).fetchall()
            for agent in agents:
                agent = dict(agent)
                pg_cursor.execute(
                    'INSERT INTO chemo_cycle_agents (cycle_id, agent_class, agent_name, dose, dosing_days, schedule_order) '
                    'VALUES (%s, %s, %s, %s, %s, %s) RETURNING cycle_agent_id',
                    (new_cycle_id, agent.get('agent_class'), agent.get('agent_name'),
                     agent.get('dose'), agent.get('dosing_days'), agent.get('schedule_order'))
                )
                new_agent_id = pg_cursor.fetchone()['cycle_agent_id']
                agent_count += 1

                overrides = sqlite_conn.execute(
                    "SELECT * FROM chemo_cycle_agent_day_overrides WHERE cycle_agent_id = ? ORDER BY origin_day",
                    (agent['cycle_agent_id'],)
                ).fetchall()
                for ov in overrides:
                    ov = dict(ov)
                    pg_cursor.execute(
                        'INSERT INTO chemo_cycle_agent_day_overrides '
                        '(cycle_agent_id, origin_day, is_deleted, moved_to_day, override_dose) '
                        'VALUES (%s, %s, %s, %s, %s)',
                        (new_agent_id, ov.get('origin_day'), bool(ov.get('is_deleted')),
                         ov.get('moved_to_day'), ov.get('override_dose'))
                    )
                    override_count += 1
    pg_conn.commit()
    print(f"Migrated {line_count} chemo line(s), {cycle_count} cycle(s), "
          f"{agent_count} agent schedule(s), {override_count} day override(s).")


def main():
    if not os.path.exists(SQLITE_DB_PATH):
        raise SystemExit(f"Local SQLite database not found at: {SQLITE_DB_PATH}")

    pg_conn = get_postgres_conn()
    # db.init_db() targets whichever backend db.py picked at import time -- make sure that
    # is Postgres, or it would just re-run the schema against the local SQLite file.
    assert IS_POSTGRES
    sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)

    print("Creating Postgres schema (if not already present)...")
    init_db()

    print("Migrating patients...")
    migrate_patients(sqlite_conn, pg_conn)

    print("Migrating chemotherapy lines...")
    migrate_chemo(sqlite_conn, pg_conn)

    sqlite_conn.close()
    pg_conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
