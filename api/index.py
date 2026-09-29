"""
Vercel serverless entry point. vercel.json rewrites every /api/* request here; the actual
app (routes, database access) lives in the project-root app.py, shared with local
development. On Vercel, db.py picks Postgres because POSTGRES_URL / DATABASE_URL is set.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402,F401
